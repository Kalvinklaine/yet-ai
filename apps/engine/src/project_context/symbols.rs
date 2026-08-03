use std::time::{Duration, Instant};

use rusqlite::{params, Transaction};
use tree_sitter::{Language, Node, ParseOptions, Parser};

use super::inventory::{Entry, InventoryError};

const MAX_PARSE_BYTES: usize = 512 * 1024;
const MAX_SYMBOLS_PER_FILE: usize = 256;
const MAX_PARSE_TIME: Duration = Duration::from_millis(100);
const MAX_NAME_BYTES: usize = 256;

#[derive(Clone, Debug, PartialEq)]
pub struct Symbol {
    pub relative_path: String,
    pub language: String,
    pub name: String,
    pub kind: String,
    pub start_line: u64,
    pub start_column: u64,
    pub end_line: u64,
    pub end_column: u64,
    pub file_hash: String,
    pub source: String,
    pub confidence: f64,
}

pub(super) fn replace_generation(
    transaction: &Transaction<'_>,
    project_id: &str,
    generation: u64,
    entries: &[Entry],
) -> Result<Vec<Symbol>, InventoryError> {
    transaction
        .execute("DELETE FROM context_symbols", [])
        .map_err(|_| InventoryError::Unavailable)?;
    let mut symbols = Vec::new();
    for entry in entries {
        symbols.extend(extract(entry));
    }
    for symbol in &symbols {
        transaction.execute(
            "INSERT INTO context_symbols (project_id, generation, relative_path, language, name, kind, start_line, start_column, end_line, end_column, file_hash, source, confidence) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![project_id, generation, symbol.relative_path, symbol.language, symbol.name, symbol.kind, symbol.start_line, symbol.start_column, symbol.end_line, symbol.end_column, symbol.file_hash, symbol.source, symbol.confidence],
        ).map_err(|_| InventoryError::Unavailable)?;
    }
    Ok(symbols)
}

fn extract(entry: &Entry) -> Vec<Symbol> {
    let (Some(text), Some(file_hash), Some(language_name)) =
        (&entry.text, &entry.hash, entry.language)
    else {
        return Vec::new();
    };
    if text.len() > MAX_PARSE_BYTES {
        return Vec::new();
    }
    let language = match language_name {
        "rust" => tree_sitter_rust::LANGUAGE.into(),
        "javascript" => tree_sitter_javascript::LANGUAGE.into(),
        "typescript" if entry.path.ends_with(".tsx") => tree_sitter_typescript::LANGUAGE_TSX.into(),
        "typescript" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        _ => return Vec::new(),
    };
    extract_tree(text, &entry.path, language_name, file_hash, language)
}

fn extract_tree(
    text: &str,
    relative_path: &str,
    language_name: &str,
    file_hash: &str,
    language: Language,
) -> Vec<Symbol> {
    let started = Instant::now();
    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }
    let mut read = |offset: usize, _| &text.as_bytes()[offset..];
    let mut timed_out = |_: &tree_sitter::ParseState| started.elapsed() >= MAX_PARSE_TIME;
    let options = ParseOptions::new().progress_callback(&mut timed_out);
    let Some(tree) = parser.parse_with_options(&mut read, None, Some(options)) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if result.len() >= MAX_SYMBOLS_PER_FILE || started.elapsed() >= MAX_PARSE_TIME {
            break;
        }
        if let Some((name_node, kind)) = definition(node, language_name) {
            if let Some(symbol) = make_symbol(
                text,
                relative_path,
                language_name,
                file_hash,
                name_node,
                node,
                kind,
            ) {
                result.push(symbol);
            }
        }
        let mut cursor = node.walk();
        let mut children = node.children(&mut cursor).collect::<Vec<_>>();
        children.reverse();
        stack.extend(children);
    }
    result
}

fn definition<'a>(node: Node<'a>, language: &str) -> Option<(Node<'a>, &'static str)> {
    let kind = match (language, node.kind()) {
        ("rust", "function_item") | ("javascript" | "typescript", "function_declaration") => {
            "function"
        }
        ("rust", "struct_item") | ("javascript" | "typescript", "class_declaration") => "class",
        ("rust", "enum_item") => "enum",
        ("rust", "trait_item") | ("typescript", "interface_declaration") => "interface",
        ("rust", "type_item") | ("typescript", "type_alias_declaration") => "type",
        ("rust", "mod_item") => "module",
        ("rust", "const_item") => "constant",
        ("rust", "static_item") => "variable",
        ("javascript" | "typescript", "method_definition") => "method",
        ("javascript" | "typescript", "lexical_declaration")
        | ("javascript" | "typescript", "variable_declaration") => "variable",
        _ => return None,
    };
    node.child_by_field_name("name")
        .or_else(|| declaration_name(node))
        .map(|name| (name, kind))
}

fn declaration_name(node: Node<'_>) -> Option<Node<'_>> {
    let mut cursor = node.walk();
    let declarator = node
        .named_children(&mut cursor)
        .find(|child| child.kind() == "variable_declarator")?;
    declarator.child_by_field_name("name")
}

fn make_symbol(
    text: &str,
    relative_path: &str,
    language: &str,
    file_hash: &str,
    name_node: Node<'_>,
    definition_node: Node<'_>,
    kind: &str,
) -> Option<Symbol> {
    let name = name_node.utf8_text(text.as_bytes()).ok()?;
    if name.is_empty()
        || name.len() > MAX_NAME_BYTES
        || name.contains(['/', '\\', '\n', '\r'])
        || definition_node.start_byte() > definition_node.end_byte()
        || definition_node.end_byte() > text.len()
    {
        return None;
    }
    let start = definition_node.start_position();
    let end = definition_node.end_position();
    if end.row < start.row || (end.row == start.row && end.column < start.column) {
        return None;
    }
    Some(Symbol {
        relative_path: relative_path.to_string(),
        language: language.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        start_line: start.row as u64 + 1,
        start_column: start.column as u64,
        end_line: end.row as u64 + 1,
        end_column: end.column as u64,
        file_hash: file_hash.to_string(),
        source: "tree_sitter".to_string(),
        confidence: 0.9,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::ProductIdentity;
    use crate::project_context::{db, fts, load_status, rebuild};
    use crate::projects::{ProjectContext, ProjectRegistryRuntime};
    use crate::storage::resolve_storage_paths;

    async fn fixture(name: &str) -> (tempfile::TempDir, ProjectContext) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let paths = resolve_storage_paths(
            &ProductIdentity::load().unwrap(),
            &temp.path().join("project"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        let registry = ProjectRegistryRuntime::new(&paths);
        let project = registry.register(&root, Some(name)).await.unwrap();
        let context = registry
            .resolve_context(&paths, &project.project_id)
            .await
            .unwrap();
        (temp, context)
    }

    fn write(context: &ProjectContext, path: &str, content: impl AsRef<[u8]>) {
        let path = context.canonical_root().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn rows(context: &ProjectContext) -> Vec<Symbol> {
        let database = rusqlite::Connection::open(db::database_path(context)).unwrap();
        let mut statement = database
            .prepare("SELECT relative_path, language, name, kind, start_line, start_column, end_line, end_column, file_hash, source, confidence FROM context_symbols ORDER BY relative_path, start_line, start_column")
            .unwrap();
        statement
            .query_map([], |row| {
                Ok(Symbol {
                    relative_path: row.get(0)?,
                    language: row.get(1)?,
                    name: row.get(2)?,
                    kind: row.get(3)?,
                    start_line: row.get(4)?,
                    start_column: row.get(5)?,
                    end_line: row.get(6)?,
                    end_column: row.get(7)?,
                    file_hash: row.get(8)?,
                    source: row.get(9)?,
                    confidence: row.get(10)?,
                })
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[tokio::test]
    async fn project_context_symbols_extract_supported_bounded_metadata_and_boost_exact_name() {
        let (_temp, context) = fixture("Symbols").await;
        write(
            &context,
            "src/lib.rs",
            "pub struct ExactNeedle;\npub fn helper() {}\n",
        );
        write(
            &context,
            "src/client.ts",
            "export interface ClientShape {}\nexport function sendRequest() {}\n",
        );
        write(
            &context,
            "src/view.jsx",
            "export class ViewModel {}\nconst renderView = () => null;\n",
        );
        write(&context, "notes.py", "def unsupported_symbol(): pass\n");
        write(&context, "src/broken.ts", "export function unfinished( {\n");
        write(
            &context,
            "src/huge.rs",
            format!(
                "pub fn hidden_by_limit() {{}}\n{}",
                "x\n".repeat(MAX_PARSE_BYTES / 2)
            ),
        );
        write(
            &context,
            "docs/exact.txt",
            "ExactNeedle appears repeatedly but is not a definition. ExactNeedle.\n",
        );

        let built = rebuild(&context, 0, context.revision()).await.unwrap();
        let symbols = rows(&context);
        assert_eq!(
            load_status(&context).await.unwrap().counts.unwrap().symbols,
            symbols.len() as u64
        );
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "ExactNeedle" && symbol.kind == "class"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "ClientShape" && symbol.language == "typescript"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "ViewModel" && symbol.language == "javascript"));
        assert!(!symbols
            .iter()
            .any(|symbol| symbol.name == "unsupported_symbol"));
        assert!(!symbols
            .iter()
            .any(|symbol| symbol.name == "hidden_by_limit"));
        assert!(symbols.len() <= MAX_SYMBOLS_PER_FILE * 4);
        assert!(symbols.iter().all(|symbol| {
            !symbol.relative_path.starts_with('/')
                && symbol.start_line <= symbol.end_line
                && symbol.source == "tree_sitter"
                && symbol.confidence == 0.9
                && symbol.file_hash.starts_with("sha256:")
        }));

        let first = fts::query(&context, built.generation, "ExactNeedle", 8)
            .await
            .unwrap();
        let second = fts::query(&context, built.generation, "ExactNeedle", 8)
            .await
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(first[0].relative_path, "src/lib.rs");
        assert!(first[0]
            .symbol_name
            .as_deref()
            .unwrap()
            .contains("ExactNeedle"));
    }

    #[tokio::test]
    async fn project_context_symbols_replace_updates_deletes_and_isolate_projects() {
        let (_first_temp, first) = fixture("First symbols").await;
        let (_second_temp, second) = fixture("Second symbols").await;
        write(&first, "src/one.rs", "pub fn OldName() {}\n");
        write(&first, "src/delete.ts", "export class DeleteName {}\n");
        write(&second, "src/two.rs", "pub fn OtherProjectName() {}\n");
        let first_build = rebuild(&first, 0, first.revision()).await.unwrap();
        rebuild(&second, 0, second.revision()).await.unwrap();
        assert!(rows(&first).iter().any(|symbol| symbol.name == "OldName"));
        assert!(!rows(&first)
            .iter()
            .any(|symbol| symbol.name == "OtherProjectName"));
        assert!(rows(&second)
            .iter()
            .any(|symbol| symbol.name == "OtherProjectName"));

        write(&first, "src/one.rs", "pub fn NewName() {}\n");
        std::fs::remove_file(first.canonical_root().join("src/delete.ts")).unwrap();
        rebuild(&first, first_build.generation, first.revision())
            .await
            .unwrap();
        let symbols = rows(&first);
        assert!(symbols.iter().any(|symbol| symbol.name == "NewName"));
        assert!(!symbols.iter().any(|symbol| symbol.name == "OldName"));
        assert!(!symbols.iter().any(|symbol| symbol.name == "DeleteName"));
    }
}

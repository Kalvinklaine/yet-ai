use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Transaction};

use crate::projects::ProjectContext;

use super::chunking;
use super::db;
use super::inventory::{Entry, InventoryError};
use super::symbols::Symbol;

const MAX_QUERY_CHARS: usize = 256;
const MAX_QUERY_TERMS: usize = 16;
const MAX_RESULTS: usize = 32;
const MAX_PER_FILE: usize = 2;
const CANDIDATE_LIMIT: usize = 256;

#[derive(Clone, Debug, PartialEq)]
pub struct LexicalMatch {
    pub relative_path: String,
    pub language: Option<String>,
    pub symbol_name: Option<String>,
    pub start_line: u64,
    pub end_line: u64,
    pub file_hash: String,
    pub chunk_hash: String,
    pub content: String,
    pub score: f64,
}

pub(super) fn replace_generation(
    transaction: &Transaction<'_>,
    project_id: &str,
    generation: u64,
    entries: &[Entry],
    symbols: &[Symbol],
) -> Result<u64, InventoryError> {
    transaction
        .execute("DELETE FROM context_chunks_fts", [])
        .map_err(|_| InventoryError::Unavailable)?;
    transaction
        .execute("DELETE FROM context_chunks", [])
        .map_err(|_| InventoryError::Unavailable)?;
    let mut count = 0u64;
    for entry in entries {
        let (Some(text), Some(file_hash)) = (&entry.text, &entry.hash) else {
            continue;
        };
        for chunk in chunking::chunks(text) {
            let symbol_name = symbols
                .iter()
                .filter(|symbol| {
                    symbol.relative_path == entry.path
                        && symbol.start_line <= chunk.end_line
                        && symbol.end_line >= chunk.start_line
                })
                .map(|symbol| symbol.name.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let symbol_name = (!symbol_name.is_empty()).then_some(symbol_name);
            transaction.execute(
                "INSERT INTO context_chunks (project_id, generation, relative_path, language, symbol_name, start_line, end_line, file_hash, chunk_hash, content) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![project_id, generation, entry.path, entry.language, symbol_name, chunk.start_line, chunk.end_line, file_hash, chunk.hash, chunk.content],
            ).map_err(|_| InventoryError::Unavailable)?;
            let rowid = transaction.last_insert_rowid();
            let file_name = entry.path.rsplit('/').next().unwrap_or(&entry.path);
            transaction.execute(
                "INSERT INTO context_chunks_fts (rowid, project_id, generation, relative_path, file_name, language, symbol_name, content) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![rowid, project_id, generation, entry.path, file_name, entry.language, symbol_name, chunk.content],
            ).map_err(|_| InventoryError::Unavailable)?;
            count += 1;
        }
    }
    Ok(count)
}

pub async fn query(
    context: &ProjectContext,
    generation: u64,
    query: &str,
    limit: usize,
) -> Result<Vec<LexicalMatch>, InventoryError> {
    let terms = terms(query);
    if terms.is_empty() || generation == 0 || limit == 0 {
        return Ok(Vec::new());
    }
    let limit = limit.min(MAX_RESULTS);
    let expression = terms
        .iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");
    let database = db::open(context).await.map_err(InventoryError::from)?;
    let current: u64 = database.connection.query_row(
        "SELECT inventory_generation FROM context_metadata WHERE singleton = 1 AND build_state = 'ready'",
        [],
        |row| row.get(0),
    ).map_err(|_| InventoryError::Unavailable)?;
    if current != generation {
        return Err(InventoryError::Conflict);
    }
    let mut statement = database.connection.prepare(
        "SELECT c.relative_path, c.language, c.symbol_name, c.start_line, c.end_line, c.file_hash, c.chunk_hash, c.content, bm25(context_chunks_fts, 0.0, 0.0, 8.0, 12.0, 2.0, 4.0, 1.0) FROM context_chunks_fts JOIN context_chunks c ON c.chunk_id = context_chunks_fts.rowid WHERE context_chunks_fts MATCH ?1 AND context_chunks_fts.project_id = ?2 AND context_chunks_fts.generation = ?3 AND c.project_id = ?2 AND c.generation = ?3 LIMIT ?4"
    ).map_err(|_| InventoryError::Unavailable)?;
    let rows = statement
        .query_map(
            params![
                expression,
                context.project_id(),
                generation,
                CANDIDATE_LIMIT
            ],
            |row| {
                Ok(LexicalMatch {
                    relative_path: row.get(0)?,
                    language: row.get(1)?,
                    symbol_name: row.get(2)?,
                    start_line: row.get(3)?,
                    end_line: row.get(4)?,
                    file_hash: row.get(5)?,
                    chunk_hash: row.get(6)?,
                    content: row.get(7)?,
                    score: -row.get::<_, f64>(8)?,
                })
            },
        )
        .map_err(|_| InventoryError::Unavailable)?;
    let normalized_query = query.trim().to_ascii_lowercase();
    let mut candidates = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| InventoryError::Unavailable)?;
    for candidate in &mut candidates {
        candidate.score += boosts(
            &candidate.relative_path,
            candidate.symbol_name.as_deref(),
            &normalized_query,
            &terms,
        );
    }
    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then(left.relative_path.cmp(&right.relative_path))
            .then(left.start_line.cmp(&right.start_line))
            .then(left.chunk_hash.cmp(&right.chunk_hash))
    });
    let mut hashes = BTreeSet::new();
    let mut per_file = BTreeMap::<String, usize>::new();
    let mut result = Vec::new();
    for candidate in candidates {
        if hashes.contains(&candidate.chunk_hash)
            || per_file.get(&candidate.relative_path).copied().unwrap_or(0) >= MAX_PER_FILE
        {
            continue;
        }
        hashes.insert(candidate.chunk_hash.clone());
        *per_file.entry(candidate.relative_path.clone()).or_default() += 1;
        result.push(candidate);
        if result.len() == limit {
            break;
        }
    }
    Ok(result)
}

fn terms(value: &str) -> Vec<String> {
    let mut result = value
        .chars()
        .take(MAX_QUERY_CHARS)
        .map(|character| {
            if character.is_alphanumeric() || character == '_' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| {
            !term.is_empty()
                && !matches!(
                    term.as_str(),
                    "a" | "an" | "are" | "how" | "is" | "the" | "this" | "what" | "where"
                )
        })
        .take(MAX_QUERY_TERMS)
        .collect::<Vec<_>>();
    result.sort();
    result.dedup();
    result
}

fn boosts(path: &str, symbols: Option<&str>, query: &str, terms: &[String]) -> f64 {
    let path = path.to_ascii_lowercase();
    let name = path.rsplit('/').next().unwrap_or(&path);
    let mut score = 0.0;
    if path == query {
        score += 100.0;
    }
    if name == query {
        score += 80.0;
    }
    if symbols
        .into_iter()
        .flat_map(str::split_whitespace)
        .any(|symbol| symbol.eq_ignore_ascii_case(query))
    {
        score += 120.0;
    }
    score += terms
        .iter()
        .filter(|term| path.contains(term.as_str()))
        .count() as f64
        * 8.0;
    if name.starts_with("readme") {
        score += 3.0;
    }
    if path.starts_with("src/") || path.starts_with("app/") {
        score += 6.0;
    }
    if matches!(
        name,
        "cargo.toml" | "package.json" | "pyproject.toml" | "go.mod" | "pom.xml"
    ) {
        score += 4.0;
    }
    score
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::ProductIdentity;
    use crate::project_context::{load_status, rebuild};
    use crate::projects::ProjectRegistryRuntime;
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

    #[tokio::test]
    async fn project_context_fts_is_available_ranked_bounded_and_injection_safe() {
        let (_temp, context) = fixture("FTS ranking").await;
        write(
            &context,
            "src/auth.rs",
            "pub fn auth_implementation() { validate_session(); }\n",
        );
        write(
            &context,
            "docs/auth.md",
            "The auth implementation is documented here.\n",
        );
        write(
            &context,
            "src/other.rs",
            "auth implementation compatibility notes\n",
        );
        let built = rebuild(&context, 0, context.revision()).await.unwrap();
        let status = load_status(&context).await.unwrap();
        assert_eq!(status.counts.unwrap().chunks, 3);

        let first = query(&context, built.generation, "auth implementation", 99)
            .await
            .unwrap();
        let second = query(&context, built.generation, "auth implementation", 99)
            .await
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(first[0].relative_path, "src/auth.rs");
        assert!(first.len() <= MAX_RESULTS);
        assert!(query(
            &context,
            built.generation,
            "auth OR * NEAR(implementation) \" ; DROP TABLE context_chunks; --",
            8,
        )
        .await
        .is_ok());
        assert!(!query(&context, built.generation, "auth", 8)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            query(&context, built.generation + 1, "auth", 8)
                .await
                .unwrap_err(),
            InventoryError::Conflict
        );
    }

    #[tokio::test]
    async fn project_context_fts_rebuild_replaces_updated_and_deleted_files() {
        let (_temp, context) = fixture("FTS updates").await;
        write(&context, "src/auth.rs", "legacy_auth_marker\n");
        write(&context, "src/delete.rs", "delete_marker\n");
        write(&context, "src/copy.rs", "duplicate_marker\n");
        write(&context, "src/copy_two.rs", "duplicate_marker\n");
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        assert_eq!(
            query(&context, first.generation, "duplicate_marker", 8)
                .await
                .unwrap()
                .len(),
            1
        );

        write(&context, "src/auth.rs", "current_auth_marker\n");
        std::fs::remove_file(context.canonical_root().join("src/delete.rs")).unwrap();
        let second = rebuild(&context, first.generation, context.revision())
            .await
            .unwrap();
        assert!(query(&context, second.generation, "legacy_auth_marker", 8)
            .await
            .unwrap()
            .is_empty());
        assert!(query(&context, second.generation, "delete_marker", 8)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            query(&context, second.generation, "current_auth_marker", 8)
                .await
                .unwrap()[0]
                .relative_path,
            "src/auth.rs"
        );
    }

    #[tokio::test]
    async fn project_context_fts_excludes_unsafe_content_and_isolates_projects() {
        let (_first_temp, first) = fixture("First").await;
        let (_second_temp, second) = fixture("Second").await;
        write(&first, "safe.txt", "first_project_marker\n");
        write(&first, ".env", "secret_marker\n");
        write(&first, "binary.bin", b"binary_marker\0hidden");
        write(&second, "safe.txt", "second_project_marker\n");
        let first_build = rebuild(&first, 0, first.revision()).await.unwrap();
        let second_build = rebuild(&second, 0, second.revision()).await.unwrap();

        assert!(
            query(&first, first_build.generation, "first_project_marker", 8)
                .await
                .unwrap()
                .len()
                == 1
        );
        assert!(
            query(&first, first_build.generation, "second_project_marker", 8)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(query(&first, first_build.generation, "secret_marker", 8)
            .await
            .unwrap()
            .is_empty());
        assert!(query(&first, first_build.generation, "binary_marker", 8)
            .await
            .unwrap()
            .is_empty());
        assert!(
            query(&second, second_build.generation, "second_project_marker", 8)
                .await
                .unwrap()
                .len()
                == 1
        );
    }
}

use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use chrono::{SecondsFormat, Utc};
use ignore::WalkBuilder;
use rusqlite::TransactionBehavior;
use sha2::{Digest, Sha256};

use crate::projects::ProjectContext;

use super::db::{self, ContextDatabaseError};
use super::fts;
use super::policy;
use super::profile;

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum InventoryError {
    #[error("project context unavailable")]
    Unavailable,
    #[error("project context request conflicts with current state")]
    Conflict,
    #[error("project inventory resource limit reached")]
    ResourceLimit,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RebuildResult {
    pub generation: u64,
    pub eligible_files: u64,
    pub omitted_files: u64,
}

#[derive(Debug)]
pub(super) struct Entry {
    pub(super) path: String,
    bytes: u64,
    modified_ms: Option<u64>,
    pub(super) language: Option<&'static str>,
    pub(super) hash: Option<String>,
    pub(super) text: Option<String>,
    pub(super) disposition: &'static str,
    reason: &'static str,
}

#[derive(Debug)]
struct Candidate {
    path: PathBuf,
    relative: String,
    metadata: std::fs::Metadata,
    omission: Option<&'static str>,
}

pub async fn rebuild(
    context: &ProjectContext,
    expected_generation: u64,
    expected_revision: &str,
) -> Result<RebuildResult, InventoryError> {
    if expected_revision != context.revision() {
        return Err(InventoryError::Conflict);
    }
    let root = canonical_root(context.canonical_root())?;
    let identity = root_identity(&root)?;
    let entries = tokio::task::spawn_blocking(move || collect(&root))
        .await
        .map_err(|_| InventoryError::Unavailable)??;
    rebuild_sync(context, expected_generation, identity, entries)
}

fn rebuild_sync(
    context: &ProjectContext,
    expected_generation: u64,
    expected_root_identity: RootIdentity,
    entries: Vec<Entry>,
) -> Result<RebuildResult, InventoryError> {
    let root = canonical_root(context.canonical_root())?;
    let mut database = db::open_sync_for_rebuild(context).map_err(InventoryError::from)?;
    let transaction = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| InventoryError::Conflict)?;
    let current: u64 = transaction
        .query_row(
            "SELECT inventory_generation FROM context_metadata WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| InventoryError::Unavailable)?;
    if current != expected_generation {
        return Err(InventoryError::Conflict);
    }
    if canonical_root(context.canonical_root())? != root {
        return Err(InventoryError::Unavailable);
    }
    if root_identity(&root)? != expected_root_identity {
        return Err(InventoryError::Unavailable);
    }
    let generation = current
        .checked_add(1)
        .ok_or(InventoryError::ResourceLimit)?;
    let eligible = entries
        .iter()
        .filter(|entry| entry.disposition == "included")
        .count() as u64;
    let omitted = entries.len() as u64 - eligible;
    for entry in &entries {
        transaction
            .execute(
                "INSERT INTO inventory_entries (generation, relative_path, file_bytes, modified_unix_ms, language, content_hash, disposition, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                (generation, &entry.path, entry.bytes, entry.modified_ms, entry.language, &entry.hash, entry.disposition, entry.reason),
            )
            .map_err(|_| InventoryError::Unavailable)?;
    }
    let chunks = fts::replace_generation(&transaction, context.project_id(), generation, &entries)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let profile = profile::derive(context, generation, &entries, &now)?;
    let profile_json = serde_json::to_string(&profile).map_err(|_| InventoryError::Unavailable)?;
    transaction
        .execute(
            "INSERT INTO project_profiles (inventory_generation, project_revision, profile_id, profile_hash, profile_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (generation, context.revision(), &profile.profile_id, &profile.profile_hash, profile_json, &now),
        )
        .map_err(|_| InventoryError::Unavailable)?;
    transaction
        .execute(
            "UPDATE context_metadata SET inventory_generation = ?1, build_state = 'ready', profile_id = ?2, built_at = ?3, updated_at = ?3, eligible_files = ?4, indexed_files = ?4, omitted_files = ?5, chunks = ?6, symbols = 0, pending_changes = 0 WHERE singleton = 1 AND inventory_generation = ?7",
            (generation, &profile.profile_id, now, eligible, omitted, chunks, current),
        )
        .map_err(|_| InventoryError::Unavailable)?;
    transaction
        .commit()
        .map_err(|_| InventoryError::Unavailable)?;
    Ok(RebuildResult {
        generation,
        eligible_files: eligible,
        omitted_files: omitted,
    })
}

fn collect(root: &Path) -> Result<Vec<Entry>, InventoryError> {
    let started = Instant::now();
    let mut builder = WalkBuilder::new(root);
    builder
        .follow_links(false)
        .hidden(false)
        .parents(false)
        .git_ignore(true)
        .require_git(false)
        .git_global(false)
        .git_exclude(false)
        .add_custom_ignore_filename(".ignore")
        .max_depth(Some(policy::MAX_DEPTH))
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.path().is_dir()
                || policy::path_denial(entry.path(), true).is_none()
        });
    let mut candidates = Vec::new();
    let mut visited = 0usize;
    for result in builder.build() {
        if started.elapsed() > policy::MAX_SCAN_TIME {
            return Err(InventoryError::ResourceLimit);
        }
        let item = result.map_err(|_| InventoryError::Unavailable)?;
        if item.depth() == 0 {
            continue;
        }
        let path = item.path();
        let relative = relative_path(root, path)?;
        let metadata = std::fs::symlink_metadata(path).map_err(|_| InventoryError::Unavailable)?;
        if metadata.file_type().is_symlink() {
            candidates.push(Candidate {
                path: path.to_path_buf(),
                relative,
                metadata,
                omission: Some("symlink"),
            });
            continue;
        }
        if metadata.is_dir() {
            if let Some(reason) = policy::path_denial(path, true) {
                candidates.push(Candidate {
                    path: path.to_path_buf(),
                    relative,
                    metadata,
                    omission: Some(reason),
                });
            }
            continue;
        }
        visited += 1;
        if visited > policy::MAX_VISITED_FILES {
            return Err(InventoryError::ResourceLimit);
        }
        if !metadata.is_file() {
            candidates.push(Candidate {
                path: path.to_path_buf(),
                relative,
                metadata,
                omission: Some("unsupported_type"),
            });
        } else {
            let omission = policy::path_denial(path, false)
                .or_else(|| (metadata.len() > policy::MAX_FILE_BYTES).then_some("oversized"));
            candidates.push(Candidate {
                path: path.to_path_buf(),
                relative,
                metadata,
                omission,
            });
        }
    }
    candidates.sort_by(|left, right| left.relative.cmp(&right.relative));
    let mut entries = Vec::with_capacity(candidates.len());
    let mut total_bytes = 0u64;
    for candidate in candidates {
        if started.elapsed() > policy::MAX_SCAN_TIME {
            return Err(InventoryError::ResourceLimit);
        }
        if let Some(reason) = candidate.omission {
            let bytes = if candidate.metadata.is_dir() {
                0
            } else {
                candidate.metadata.len()
            };
            entries.push(omitted(candidate.relative, bytes, reason));
            continue;
        }
        total_bytes = total_bytes
            .checked_add(candidate.metadata.len())
            .ok_or(InventoryError::ResourceLimit)?;
        if total_bytes > policy::MAX_TOTAL_BYTES {
            return Err(InventoryError::ResourceLimit);
        }
        entries.push(read_entry(
            root,
            &candidate.path,
            candidate.relative,
            &candidate.metadata,
        )?);
    }
    Ok(entries)
}

fn read_entry(
    root: &Path,
    path: &Path,
    relative: String,
    before: &std::fs::Metadata,
) -> Result<Entry, InventoryError> {
    let canonical = path
        .canonicalize()
        .map_err(|_| InventoryError::Unavailable)?;
    if !canonical.starts_with(root) {
        return Ok(omitted(relative, before.len(), "outside_root"));
    }
    let mut file = File::open(path).map_err(|_| InventoryError::Unavailable)?;
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| InventoryError::Unavailable)?;
    let after = file.metadata().map_err(|_| InventoryError::Unavailable)?;
    if after.len() != before.len() || after.modified().ok() != before.modified().ok() {
        return Err(InventoryError::Conflict);
    }
    if policy::is_binary(&bytes[..bytes.len().min(8192)]) {
        return Ok(omitted(relative, before.len(), "binary"));
    }
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return Ok(omitted(relative, before.len(), "binary")),
    };
    Ok(Entry {
        path: relative,
        bytes: before.len(),
        modified_ms: modified_ms(before.modified().ok()),
        language: policy::language(path),
        hash: Some(format!("sha256:{:x}", Sha256::digest(text.as_bytes()))),
        text: Some(text),
        disposition: "included",
        reason: "profile_candidate",
    })
}

fn omitted(path: String, bytes: u64, reason: &'static str) -> Entry {
    Entry {
        path,
        bytes,
        modified_ms: None,
        language: None,
        hash: None,
        text: None,
        disposition: "omitted",
        reason,
    }
}

fn canonical_root(root: &Path) -> Result<PathBuf, InventoryError> {
    let canonical = root
        .canonicalize()
        .map_err(|_| InventoryError::Unavailable)?;
    if canonical != root || !canonical.is_dir() {
        return Err(InventoryError::Unavailable);
    }
    Ok(canonical)
}

#[cfg(unix)]
type RootIdentity = (u64, u64);

#[cfg(not(unix))]
type RootIdentity = (u64, Option<SystemTime>);

#[cfg(unix)]
fn root_identity(root: &Path) -> Result<RootIdentity, InventoryError> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::metadata(root).map_err(|_| InventoryError::Unavailable)?;
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn root_identity(root: &Path) -> Result<RootIdentity, InventoryError> {
    let metadata = std::fs::metadata(root).map_err(|_| InventoryError::Unavailable)?;
    Ok((metadata.len(), metadata.modified().ok()))
}

fn relative_path(root: &Path, path: &Path) -> Result<String, InventoryError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| InventoryError::Unavailable)?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => {
                let value = value.to_str().ok_or(InventoryError::Unavailable)?;
                if value.is_empty() || value.contains('\0') || value.contains('\\') {
                    return Err(InventoryError::Unavailable);
                }
                parts.push(value);
            }
            _ => return Err(InventoryError::Unavailable),
        }
    }
    if parts.is_empty() {
        return Err(InventoryError::Unavailable);
    }
    Ok(parts.join("/"))
}

fn modified_ms(value: Option<SystemTime>) -> Option<u64> {
    value?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

impl From<ContextDatabaseError> for InventoryError {
    fn from(error: ContextDatabaseError) -> Self {
        match error {
            ContextDatabaseError::ResourceLimit => Self::ResourceLimit,
            _ => Self::Unavailable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::ProductIdentity;
    use crate::projects::ProjectRegistryRuntime;
    use crate::storage::resolve_storage_paths;
    use std::process::Command;

    async fn fixture() -> (tempfile::TempDir, ProjectContext) {
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
        let project = registry.register(&root, Some("Inventory")).await.unwrap();
        let context = registry
            .resolve_context(&paths, &project.project_id)
            .await
            .unwrap();
        (temp, context)
    }

    fn rows(
        context: &ProjectContext,
        generation: u64,
    ) -> Vec<(String, String, String, Option<String>)> {
        let database = db::open_sync_for_rebuild(context).unwrap();
        let mut statement = database
            .connection
            .prepare("SELECT relative_path, disposition, reason, content_hash FROM inventory_entries WHERE generation = ?1 ORDER BY relative_path")
            .unwrap();
        statement
            .query_map([generation], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[tokio::test]
    async fn project_context_inventory_is_safe_ignored_and_deterministic() {
        let (_temp, context) = fixture().await;
        let root = context.canonical_root();
        std::fs::create_dir(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join(".github/workflows")).unwrap();
        std::fs::create_dir(root.join(".cargo")).unwrap();
        std::fs::create_dir_all(root.join(".git/info")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(root.join(".github/workflows/check.yml"), "name: check\n").unwrap();
        std::fs::write(root.join(".cargo/config.toml"), "[build]\n").unwrap();
        std::fs::write(root.join(".nvmrc"), "22\n").unwrap();
        std::fs::write(root.join(".env"), "TOKEN=ultra-private-value\n").unwrap();
        std::fs::write(root.join("exclude-proof.txt"), "kept").unwrap();
        std::fs::write(root.join(".git/info/exclude"), "exclude-proof.txt\n").unwrap();
        std::fs::write(root.join("ignored.txt"), "ignored value").unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(root.join("credentials.json"), "ultra-private-value").unwrap();
        std::fs::write(root.join("image.bin"), b"a\0b").unwrap();
        std::fs::write(
            root.join("large.txt"),
            vec![b'x'; policy::MAX_FILE_BYTES as usize + 1],
        )
        .unwrap();
        std::fs::create_dir(root.join("target")).unwrap();
        std::fs::write(root.join("target/generated.rs"), "generated").unwrap();
        #[cfg(unix)]
        {
            let outside = tempfile::NamedTempFile::new().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.join("escape.txt")).unwrap();
        }

        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        let first_rows = rows(&context, first.generation);
        assert!(first_rows
            .iter()
            .any(|row| row.0 == "src/main.rs" && row.1 == "included"));
        for path in [
            ".cargo/config.toml",
            ".github/workflows/check.yml",
            ".nvmrc",
            "exclude-proof.txt",
        ] {
            assert!(first_rows
                .iter()
                .any(|row| row.0 == path && row.1 == "included"));
        }
        assert!(!first_rows.iter().any(|row| row.0 == "ignored.txt"));
        assert!(!first_rows.iter().any(|row| row.0.starts_with(".git/")));
        assert!(!first_rows.iter().any(|row| row.0 == "target/generated.rs"));
        assert!(first_rows
            .iter()
            .any(|row| row.0 == ".env" && row.2 == "secret_like" && row.3.is_none()));
        assert!(first_rows
            .iter()
            .any(|row| row.0 == "credentials.json" && row.2 == "secret_like" && row.3.is_none()));
        assert!(first_rows
            .iter()
            .any(|row| row.0 == "image.bin" && row.2 == "binary"));
        assert!(first_rows
            .iter()
            .any(|row| row.0 == "large.txt" && row.2 == "oversized"));
        #[cfg(unix)]
        assert!(first_rows
            .iter()
            .any(|row| row.0 == "escape.txt" && row.2 == "symlink"));
        let database_bytes = std::fs::read(db::database_path(&context)).unwrap();
        assert!(!database_bytes
            .windows(19)
            .any(|value| value == b"ultra-private-value"));

        let second = rebuild(&context, first.generation, context.revision())
            .await
            .unwrap();
        let comparable = |values: Vec<(String, String, String, Option<String>)>| {
            values
                .into_iter()
                .map(|row| (row.0, row.1, row.2, row.3))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            comparable(first_rows),
            comparable(rows(&context, second.generation))
        );
    }

    #[tokio::test]
    async fn project_context_inventory_ignores_parent_rules_and_creation_order() {
        let (first_temp, first) = fixture().await;
        let (second_temp, second) = fixture().await;
        std::fs::write(first_temp.path().join(".gitignore"), "*.rs\n").unwrap();
        std::fs::write(first_temp.path().join(".ignore"), "*.toml\n").unwrap();
        std::fs::write(second_temp.path().join(".gitignore"), "*.txt\n").unwrap();
        std::fs::write(second_temp.path().join(".ignore"), "*.md\n").unwrap();

        for (context, paths) in [
            (&first, ["z.txt", "src/main.rs", ".cargo/config.toml"]),
            (&second, [".cargo/config.toml", "src/main.rs", "z.txt"]),
        ] {
            let root = context.canonical_root();
            for path in paths {
                let path = root.join(path);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, "same content\n").unwrap();
            }
        }

        let first_generation = rebuild(&first, 0, first.revision())
            .await
            .unwrap()
            .generation;
        let second_generation = rebuild(&second, 0, second.revision())
            .await
            .unwrap()
            .generation;
        let paths = |context: &ProjectContext, generation| rows(context, generation);
        assert_eq!(
            paths(&first, first_generation),
            paths(&second, second_generation)
        );
        assert_eq!(
            paths(&first, first_generation)
                .into_iter()
                .map(|row| row.0)
                .collect::<Vec<_>>(),
            [".cargo/config.toml", "src/main.rs", "z.txt"]
        );
    }

    #[test]
    fn project_context_inventory_ignores_global_gitignore() {
        const PROBE_ROOT: &str = "YET_AI_INVENTORY_GLOBAL_PROBE_ROOT";
        if let Some(root) = std::env::var_os(PROBE_ROOT) {
            let root = Path::new(&root).canonicalize().unwrap();
            let entries = collect(&root).unwrap();
            assert!(
                entries.iter().any(
                    |entry| entry.path == "global-proof.txt" && entry.disposition == "included"
                ),
                "{entries:?}"
            );
            return;
        }

        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("global-proof.txt"), "kept").unwrap();
        let excludes = temp.path().join("global-ignore");
        std::fs::write(&excludes, "global-proof.txt\n").unwrap();
        let config = temp.path().join("global-config");
        let excludes = excludes.to_string_lossy().replace('\\', "/");
        std::fs::write(&config, format!("[core]\nexcludesFile = \"{excludes}\"\n")).unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("project_context::inventory::tests::project_context_inventory_ignores_global_gitignore")
            .arg("--nocapture")
            .env(PROBE_ROOT, &root)
            .env("GIT_CONFIG_GLOBAL", config)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[tokio::test]
    async fn project_context_rebuild_reflects_ignore_changes_and_preserves_completed_generation_on_failure(
    ) {
        let (_temp, context) = fixture().await;
        let root = context.canonical_root();
        std::fs::write(root.join("keep.txt"), "keep").unwrap();
        std::fs::write(root.join("later.txt"), "later").unwrap();
        std::fs::write(root.join("git-later.txt"), "git later").unwrap();
        std::fs::write(root.join(".ignore"), "later.txt\n").unwrap();
        std::fs::write(root.join(".gitignore"), "git-later.txt\n").unwrap();
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        assert!(!rows(&context, first.generation)
            .iter()
            .any(|row| row.0 == "later.txt"));
        assert!(!rows(&context, first.generation)
            .iter()
            .any(|row| row.0 == "git-later.txt"));
        assert_eq!(
            rebuild(&context, 0, context.revision()).await.unwrap_err(),
            InventoryError::Conflict
        );
        assert_eq!(
            rebuild(&context, first.generation, "999")
                .await
                .unwrap_err(),
            InventoryError::Conflict
        );
        assert_eq!(rows(&context, first.generation).len(), 3);

        std::fs::write(root.join(".ignore"), "").unwrap();
        std::fs::write(root.join(".gitignore"), "").unwrap();
        let second = rebuild(&context, first.generation, context.revision())
            .await
            .unwrap();
        assert!(rows(&context, second.generation)
            .iter()
            .any(|row| row.0 == "later.txt"));
        assert!(rows(&context, second.generation)
            .iter()
            .any(|row| row.0 == "git-later.txt"));
    }

    #[tokio::test]
    async fn project_context_rebuild_keeps_projects_isolated() {
        let (temp, first) = fixture().await;
        std::fs::write(first.canonical_root().join("first.txt"), "first").unwrap();
        let paths = resolve_storage_paths(
            &ProductIdentity::load().unwrap(),
            &temp.path().join("other-project"),
            &temp.path().join("other-config"),
            &temp.path().join("other-cache"),
        );
        let root = temp.path().join("second-root");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("second.txt"), "second").unwrap();
        let registry = ProjectRegistryRuntime::new(&paths);
        let project = registry.register(&root, Some("Second")).await.unwrap();
        let second = registry
            .resolve_context(&paths, &project.project_id)
            .await
            .unwrap();
        rebuild(&first, 0, first.revision()).await.unwrap();
        rebuild(&second, 0, second.revision()).await.unwrap();
        assert_eq!(rows(&first, 1)[0].0, "first.txt");
        assert_eq!(rows(&second, 1)[0].0, "second.txt");
    }
}

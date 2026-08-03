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
use super::policy;

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
struct Entry {
    path: String,
    bytes: u64,
    modified_ms: Option<u64>,
    language: Option<&'static str>,
    hash: Option<String>,
    disposition: &'static str,
    reason: &'static str,
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
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    transaction
        .execute(
            "UPDATE context_metadata SET inventory_generation = ?1, build_state = 'ready', built_at = ?2, updated_at = ?2, eligible_files = ?3, indexed_files = ?3, omitted_files = ?4, chunks = 0, symbols = 0, pending_changes = 0 WHERE singleton = 1 AND inventory_generation = ?5",
            (generation, now, eligible, omitted, current),
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
        .git_ignore(true)
        .require_git(false)
        .git_global(false)
        .git_exclude(true)
        .add_custom_ignore_filename(".ignore")
        .max_depth(Some(policy::MAX_DEPTH))
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.path().is_dir()
                || policy::path_denial(entry.path(), true).is_none()
        });
    let mut entries = Vec::new();
    let mut visited = 0usize;
    let mut total_bytes = 0u64;
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
            entries.push(omitted(relative, metadata.len(), "symlink"));
            continue;
        }
        if metadata.is_dir() {
            if let Some(reason) = policy::path_denial(path, true) {
                entries.push(omitted(relative, 0, reason));
            }
            continue;
        }
        visited += 1;
        if visited > policy::MAX_VISITED_FILES {
            return Err(InventoryError::ResourceLimit);
        }
        if !metadata.is_file() {
            entries.push(omitted(relative, metadata.len(), "unsupported_type"));
            continue;
        }
        if let Some(reason) = policy::path_denial(path, false) {
            entries.push(omitted(relative, metadata.len(), reason));
            continue;
        }
        if metadata.len() > policy::MAX_FILE_BYTES {
            entries.push(omitted(relative, metadata.len(), "oversized"));
            continue;
        }
        total_bytes = total_bytes
            .checked_add(metadata.len())
            .ok_or(InventoryError::ResourceLimit)?;
        if total_bytes > policy::MAX_TOTAL_BYTES {
            return Err(InventoryError::ResourceLimit);
        }
        entries.push(read_entry(root, path, relative, &metadata)?);
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
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
    Ok(Entry {
        path: relative,
        bytes: before.len(),
        modified_ms: modified_ms(before.modified().ok()),
        language: policy::language(path),
        hash: Some(format!("sha256:{:x}", Sha256::digest(&bytes))),
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
        std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
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
        assert!(!first_rows.iter().any(|row| row.0 == "ignored.txt"));
        assert!(!first_rows.iter().any(|row| row.0 == "target/generated.rs"));
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
    async fn project_context_rebuild_reflects_ignore_changes_and_preserves_completed_generation_on_failure(
    ) {
        let (_temp, context) = fixture().await;
        let root = context.canonical_root();
        std::fs::write(root.join("keep.txt"), "keep").unwrap();
        std::fs::write(root.join("later.txt"), "later").unwrap();
        std::fs::write(root.join(".ignore"), "later.txt\n").unwrap();
        let first = rebuild(&context, 0, context.revision()).await.unwrap();
        assert!(!rows(&context, first.generation)
            .iter()
            .any(|row| row.0 == "later.txt"));
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
        assert_eq!(rows(&context, first.generation).len(), 2);

        std::fs::write(root.join(".ignore"), "").unwrap();
        let second = rebuild(&context, first.generation, context.revision())
            .await
            .unwrap();
        assert!(rows(&context, second.generation)
            .iter()
            .any(|row| row.0 == "later.txt"));
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

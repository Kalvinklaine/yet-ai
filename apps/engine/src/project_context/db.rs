use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use fs2::FileExt;
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use sha2::{Digest, Sha256};

use crate::projects::ProjectContext;
use crate::storage::{ensure_store_namespace_sync, validate_storage_chain};

use super::schema::{
    CREATE_INVENTORY_SCHEMA, CREATE_SCHEMA, POLICY_VERSION, RANKING_VERSION, SCHEMA_VERSION,
};

const DATABASE_FILE: &str = "cache.sqlite3";
const LOCK_FILE: &str = "cache.sqlite3.lock";
const MAX_DATABASE_BYTES: u64 = 512 * 1024 * 1024;
const BUSY_TIMEOUT: Duration = Duration::from_secs(2);
const LOCK_RETRY: Duration = Duration::from_millis(10);
static RESET_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum ContextDatabaseError {
    #[error("context cache unavailable")]
    Unavailable,
    #[error("context cache migration required")]
    MigrationRequired,
    #[error("context cache is corrupt")]
    Corrupt,
    #[error("context cache resource limit reached")]
    ResourceLimit,
}

pub(crate) struct ContextDatabase {
    pub connection: Connection,
}

impl std::fmt::Debug for ContextDatabase {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ContextDatabase")
            .finish_non_exhaustive()
    }
}

pub fn database_path(context: &ProjectContext) -> PathBuf {
    context.storage().context_cache.join(DATABASE_FILE)
}

pub(crate) async fn open(
    context: &ProjectContext,
) -> Result<ContextDatabase, ContextDatabaseError> {
    let namespace = context.storage().context_cache.clone();
    let path = database_path(context);
    let project_id = context.project_id().to_string();
    let root = context.canonical_root().to_path_buf();
    tokio::task::spawn_blocking(move || open_sync(&namespace, &path, &project_id, &root))
        .await
        .map_err(|_| ContextDatabaseError::Unavailable)?
}

fn open_sync(
    namespace: &Path,
    path: &Path,
    project_id: &str,
    root: &Path,
) -> Result<ContextDatabase, ContextDatabaseError> {
    ensure_namespace_sync(namespace)?;
    let lock = acquire_cache_lock(namespace)?;
    validate_database_target(path)?;
    cleanup_orphaned_sidecars(path)?;
    let result =
        open_database(path, project_id, root).map(|connection| ContextDatabase { connection });
    drop(lock);
    result
}

pub(crate) fn open_sync_for_rebuild(
    context: &ProjectContext,
) -> Result<ContextDatabase, ContextDatabaseError> {
    open_sync(
        &context.storage().context_cache,
        &database_path(context),
        context.project_id(),
        context.canonical_root(),
    )
}

fn open_database(
    path: &Path,
    project_id: &str,
    root: &Path,
) -> Result<Connection, ContextDatabaseError> {
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_CREATE
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let mut connection = Connection::open_with_flags(path, flags).map_err(map_open_error)?;
    connection
        .busy_timeout(BUSY_TIMEOUT)
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    connection.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_ATTACHED, 0);
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    match migrate(&mut connection, project_id, root) {
        Ok(()) => {}
        Err(MigrationError::Rebound) => {
            drop(connection);
            reset_rebound_cache(path)?;
            return open_database(path, project_id, root);
        }
        Err(MigrationError::Database(error)) => return Err(error),
    }
    validate_database_target(path)?;
    set_private_file(path)?;
    Ok(connection)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MigrationError {
    Rebound,
    Database(ContextDatabaseError),
}

impl From<ContextDatabaseError> for MigrationError {
    fn from(error: ContextDatabaseError) -> Self {
        Self::Database(error)
    }
}

fn ensure_namespace_sync(namespace: &Path) -> Result<(), ContextDatabaseError> {
    validate_storage_chain(namespace).map_err(|_| ContextDatabaseError::Unavailable)?;
    ensure_store_namespace_sync(namespace, true)
        .and_then(|created| {
            created
                .then_some(())
                .ok_or(crate::storage::ProjectStorageError)
        })
        .map_err(|_| ContextDatabaseError::Unavailable)
}

fn validate_database_target(path: &Path) -> Result<(), ContextDatabaseError> {
    validate_storage_chain(path.parent().ok_or(ContextDatabaseError::Unavailable)?)
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(ContextDatabaseError::Unavailable)
        }
        Ok(metadata) if metadata.len() > MAX_DATABASE_BYTES => {
            Err(ContextDatabaseError::ResourceLimit)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ContextDatabaseError::Unavailable),
    }
}

fn acquire_cache_lock(namespace: &Path) -> Result<std::fs::File, ContextDatabaseError> {
    let path = namespace.join(LOCK_FILE);
    validate_owned_file(&path, true)?;
    let mut options = std::fs::OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(&path)
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    let deadline = Instant::now() + BUSY_TIMEOUT;
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => break,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(ContextDatabaseError::Unavailable);
                }
                std::thread::sleep(LOCK_RETRY);
            }
            Err(_) => return Err(ContextDatabaseError::Unavailable),
        }
    }
    validate_owned_file(&path, false)?;
    set_private_open_file(&file)?;
    Ok(file)
}

fn sidecar_paths(path: &Path) -> [PathBuf; 2] {
    let value = path.as_os_str().to_string_lossy();
    [
        PathBuf::from(format!("{value}-wal")),
        PathBuf::from(format!("{value}-shm")),
    ]
}

fn cleanup_orphaned_sidecars(path: &Path) -> Result<(), ContextDatabaseError> {
    if path.exists() {
        return Ok(());
    }
    for sidecar in sidecar_paths(path) {
        validate_owned_file(&sidecar, true)?;
        match std::fs::remove_file(&sidecar) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(ContextDatabaseError::Unavailable),
        }
    }
    Ok(())
}

fn reset_rebound_cache(path: &Path) -> Result<(), ContextDatabaseError> {
    let parent = path.parent().ok_or(ContextDatabaseError::Unavailable)?;
    validate_storage_chain(parent).map_err(|_| ContextDatabaseError::Unavailable)?;
    let mut paths = vec![path.to_path_buf()];
    paths.extend(sidecar_paths(path));
    for candidate in &paths {
        validate_owned_file(candidate, true)?;
    }
    let reset = RESET_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut moved = Vec::new();
    for candidate in paths {
        if !candidate.exists() {
            continue;
        }
        let name = candidate
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(ContextDatabaseError::Unavailable)?;
        let quarantine = parent.join(format!(".{name}.rebound.{}.{}", std::process::id(), reset));
        validate_owned_file(&quarantine, true)?;
        if std::fs::rename(&candidate, &quarantine).is_err() {
            for (original, quarantined) in moved.into_iter().rev() {
                let _ = std::fs::rename(quarantined, original);
            }
            return Err(ContextDatabaseError::Unavailable);
        }
        moved.push((candidate, quarantine));
    }
    sync_directory(parent)?;
    for (_, quarantine) in moved {
        std::fs::remove_file(quarantine).map_err(|_| ContextDatabaseError::Unavailable)?;
    }
    sync_directory(parent)
}

fn validate_owned_file(path: &Path, allow_missing: bool) -> Result<(), ContextDatabaseError> {
    validate_storage_chain(path.parent().ok_or(ContextDatabaseError::Unavailable)?)
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(ContextDatabaseError::Unavailable)
        }
        Ok(_) => Ok(()),
        Err(error) if allow_missing && error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ContextDatabaseError::Unavailable),
    }
}

fn migrate(
    connection: &mut Connection,
    project_id: &str,
    root: &Path,
) -> Result<(), MigrationError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    let version: i64 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContextDatabaseError::Corrupt)?;
    if version > SCHEMA_VERSION {
        return Err(ContextDatabaseError::MigrationRequired.into());
    }
    if version == 0 {
        transaction
            .execute_batch(CREATE_SCHEMA)
            .map_err(|_| ContextDatabaseError::Corrupt)?;
        transaction
            .execute(
                "INSERT INTO context_metadata (singleton, schema_version, policy_version, ranking_version, project_identity_hash, inventory_generation, build_state) VALUES (1, ?1, ?2, ?3, ?4, 0, 'not_built')",
                (SCHEMA_VERSION, POLICY_VERSION, RANKING_VERSION, project_identity_hash(project_id, root)),
            )
            .map_err(|_| ContextDatabaseError::Corrupt)?;
        transaction
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|_| ContextDatabaseError::Corrupt)?;
    }
    transaction
        .execute_batch(CREATE_INVENTORY_SCHEMA)
        .map_err(|_| ContextDatabaseError::Corrupt)?;
    validate_metadata(&transaction, project_id, root)?;
    transaction
        .commit()
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    Ok(())
}

fn validate_metadata(
    connection: &Connection,
    project_id: &str,
    root: &Path,
) -> Result<(), MigrationError> {
    let metadata = connection.query_row(
        "SELECT schema_version, project_identity_hash FROM context_metadata WHERE singleton = 1",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    );
    match metadata {
        Ok((schema, _)) if schema != SCHEMA_VERSION => Err(ContextDatabaseError::Corrupt.into()),
        Ok((_, identity)) if identity == project_identity_hash(project_id, root) => Ok(()),
        Ok((_, identity)) => match parse_project_identity_hash(&identity) {
            Some((stored_project, _)) if stored_project == hash_bytes(project_id.as_bytes()) => {
                Err(MigrationError::Rebound)
            }
            None if identity == legacy_project_identity_hash(project_id) => {
                Err(MigrationError::Rebound)
            }
            _ => Err(ContextDatabaseError::Corrupt.into()),
        },
        Err(_) => Err(ContextDatabaseError::Corrupt.into()),
    }
}

fn project_identity_hash(project_id: &str, root: &Path) -> String {
    format!(
        "v1:{}:{}",
        hash_bytes(project_id.as_bytes()),
        hash_root(root)
    )
}

fn legacy_project_identity_hash(project_id: &str) -> String {
    format!("sha256:{}", hash_bytes(project_id.as_bytes()))
}

fn parse_project_identity_hash(value: &str) -> Option<(&str, &str)> {
    let mut parts = value.split(':');
    match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some("v1"), Some(project), Some(root), None)
            if valid_sha256(project) && valid_sha256(root) =>
        {
            Some((project, root))
        }
        _ => None,
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn hash_bytes(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

#[cfg(unix)]
fn hash_root(root: &Path) -> String {
    use std::os::unix::ffi::OsStrExt;
    hash_bytes(root.as_os_str().as_bytes())
}

#[cfg(not(unix))]
fn hash_root(root: &Path) -> String {
    let bytes = root
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    hash_bytes(&bytes)
}

fn map_open_error(error: rusqlite::Error) -> ContextDatabaseError {
    match error.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DatabaseCorrupt) | Some(rusqlite::ErrorCode::NotADatabase) => {
            ContextDatabaseError::Corrupt
        }
        Some(rusqlite::ErrorCode::DiskFull) => ContextDatabaseError::ResourceLimit,
        _ => ContextDatabaseError::Unavailable,
    }
}

#[cfg(unix)]
fn set_private_file(path: &Path) -> Result<(), ContextDatabaseError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| ContextDatabaseError::Unavailable)
}

#[cfg(unix)]
fn set_private_open_file(file: &std::fs::File) -> Result<(), ContextDatabaseError> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|_| ContextDatabaseError::Unavailable)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), ContextDatabaseError> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| ContextDatabaseError::Unavailable)
}

#[cfg(not(unix))]
fn set_private_file(_path: &Path) -> Result<(), ContextDatabaseError> {
    Ok(())
}

#[cfg(not(unix))]
fn set_private_open_file(_file: &std::fs::File) -> Result<(), ContextDatabaseError> {
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), ContextDatabaseError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::ProductIdentity;
    use crate::projects::ProjectRegistryRuntime;
    use crate::storage::resolve_storage_paths;

    async fn contexts() -> (tempfile::TempDir, ProjectContext, ProjectContext) {
        let temp = tempfile::tempdir().unwrap();
        let first_root = temp.path().join("first-root");
        let second_root = temp.path().join("second-root");
        std::fs::create_dir(&first_root).unwrap();
        std::fs::create_dir(&second_root).unwrap();
        let paths = resolve_storage_paths(
            &ProductIdentity::load().unwrap(),
            &temp.path().join("project"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        let registry = ProjectRegistryRuntime::new(&paths);
        let first = registry.register(&first_root, Some("First")).await.unwrap();
        let second = registry
            .register(&second_root, Some("Second"))
            .await
            .unwrap();
        let first = registry
            .resolve_context(&paths, &first.project_id)
            .await
            .unwrap();
        let second = registry
            .resolve_context(&paths, &second.project_id)
            .await
            .unwrap();
        (temp, first, second)
    }

    #[tokio::test]
    async fn project_context_db_bootstrap_is_private_wal_and_isolated() {
        let (_temp, first, second) = contexts().await;
        let first_db = open(&first).await.unwrap();
        first_db
            .connection
            .execute(
                "UPDATE context_metadata SET inventory_generation = 7 WHERE singleton = 1",
                [],
            )
            .unwrap();
        let second_db = open(&second).await.unwrap();
        let second_generation: i64 = second_db
            .connection
            .query_row(
                "SELECT inventory_generation FROM context_metadata WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(second_generation, 0);
        assert_ne!(database_path(&first), database_path(&second));
        assert_eq!(
            first_db
                .connection
                .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
                .unwrap()
                .to_ascii_lowercase(),
            "wal"
        );
        assert_eq!(
            first_db
                .connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        assert!(!first.storage().turn_context.exists());
    }

    #[tokio::test]
    async fn project_context_db_concurrent_bootstrap_is_atomic() {
        let (_temp, first, _) = contexts().await;
        let (one, two) = tokio::join!(open(&first), open(&first));
        assert!(one.is_ok());
        assert!(two.is_ok());
        assert_eq!(
            open(&first)
                .await
                .unwrap()
                .connection
                .query_row("SELECT COUNT(*) FROM context_metadata", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn project_context_db_newer_migration_and_identity_mismatch_fail_closed() {
        let (_temp, first, second) = contexts().await;
        drop(open(&first).await.unwrap());
        let raw = Connection::open(database_path(&first)).unwrap();
        raw.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        drop(raw);
        assert_eq!(
            open(&first).await.unwrap_err(),
            ContextDatabaseError::MigrationRequired
        );

        drop(open(&second).await.unwrap());
        let raw = Connection::open(database_path(&second)).unwrap();
        raw.execute(
            "UPDATE context_metadata SET project_identity_hash = 'sha256:wrong'",
            [],
        )
        .unwrap();
        drop(raw);
        assert_eq!(
            open(&second).await.unwrap_err(),
            ContextDatabaseError::Corrupt
        );
    }

    #[tokio::test]
    async fn project_context_db_rebind_resets_only_rebuildable_cache() {
        let temp = tempfile::tempdir().unwrap();
        let old_root = temp.path().join("old-root");
        let new_root = temp.path().join("new-root");
        std::fs::create_dir(&old_root).unwrap();
        std::fs::create_dir(&new_root).unwrap();
        let paths = resolve_storage_paths(
            &ProductIdentity::load().unwrap(),
            &temp.path().join("project"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        let registry = ProjectRegistryRuntime::new(&paths);
        let created = registry.register(&old_root, Some("Stable")).await.unwrap();
        let before = registry
            .resolve_context(&paths, &created.project_id)
            .await
            .unwrap();
        let database = open(&before).await.unwrap();
        database
            .connection
            .execute(
                "UPDATE context_metadata SET inventory_generation = 8, build_state = 'ready' WHERE singleton = 1",
                [],
            )
            .unwrap();
        drop(database);
        for sidecar in sidecar_paths(&database_path(&before)) {
            std::fs::write(sidecar, []).unwrap();
        }
        std::fs::create_dir_all(&before.storage().turn_context).unwrap();
        let durable = before.storage().turn_context.join("preserved.json");
        std::fs::write(&durable, b"durable turn evidence").unwrap();

        let rebound = registry
            .rebind(&created.project_id, &created.revision, &new_root)
            .await
            .unwrap();
        let after = registry
            .resolve_context(&paths, &rebound.project_id)
            .await
            .unwrap();
        let (one, two) = tokio::join!(
            crate::project_context::load_status(&after),
            crate::project_context::load_status(&after)
        );
        for status in [one.unwrap(), two.unwrap()] {
            assert_eq!(
                status.state,
                crate::project_context::status::ContextState::NotBuilt
            );
            assert_eq!(status.inventory_generation, 0);
        }
        assert_eq!(std::fs::read(durable).unwrap(), b"durable turn evidence");
        let entries = std::fs::read_dir(&after.storage().context_cache)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(entries.iter().all(|name| name.starts_with(DATABASE_FILE)));
        assert!(entries.iter().all(|name| !name.contains(".rebound.")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn project_context_db_rebind_rejects_symlinked_sidecar_without_reset() {
        let (temp, first, _) = contexts().await;
        drop(open(&first).await.unwrap());
        let path = database_path(&first);
        let before = std::fs::read(&path).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        let wal = sidecar_paths(&path)[0].clone();
        std::os::unix::fs::symlink(outside.path(), &wal).unwrap();
        let rebound_root = temp.path().join("rebound-root");
        std::fs::create_dir(&rebound_root).unwrap();
        let paths = resolve_storage_paths(
            &ProductIdentity::load().unwrap(),
            &temp.path().join("project"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        let registry = ProjectRegistryRuntime::new(&paths);
        let rebound = registry
            .rebind(first.project_id(), first.revision(), &rebound_root)
            .await
            .unwrap();
        let rebound = registry
            .resolve_context(&paths, &rebound.project_id)
            .await
            .unwrap();

        assert_eq!(
            open(&rebound).await.unwrap_err(),
            ContextDatabaseError::Unavailable
        );
        assert_eq!(std::fs::read(path).unwrap(), before);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn project_context_db_rejects_symlink_target() {
        let (_temp, first, _) = contexts().await;
        std::fs::create_dir_all(&first.storage().context_cache).unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), database_path(&first)).unwrap();
        assert_eq!(
            open(&first).await.unwrap_err(),
            ContextDatabaseError::Unavailable
        );
    }
}

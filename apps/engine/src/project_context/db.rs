use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use sha2::{Digest, Sha256};

use crate::projects::ProjectContext;
use crate::storage::{ensure_store_namespace_sync, validate_storage_chain};

use super::schema::{CREATE_SCHEMA, POLICY_VERSION, RANKING_VERSION, SCHEMA_VERSION};

const DATABASE_FILE: &str = "cache.sqlite3";
const MAX_DATABASE_BYTES: u64 = 512 * 1024 * 1024;
const BUSY_TIMEOUT: Duration = Duration::from_secs(2);

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
    tokio::task::spawn_blocking(move || open_sync(&namespace, &path, &project_id))
        .await
        .map_err(|_| ContextDatabaseError::Unavailable)?
}

fn open_sync(
    namespace: &Path,
    path: &Path,
    project_id: &str,
) -> Result<ContextDatabase, ContextDatabaseError> {
    ensure_namespace_sync(namespace)?;
    validate_database_target(path)?;
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
    migrate(&mut connection, project_id)?;
    validate_database_target(path)?;
    set_private_file(path)?;
    Ok(ContextDatabase { connection })
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

fn migrate(connection: &mut Connection, project_id: &str) -> Result<(), ContextDatabaseError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| ContextDatabaseError::Unavailable)?;
    let version: i64 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContextDatabaseError::Corrupt)?;
    if version > SCHEMA_VERSION {
        return Err(ContextDatabaseError::MigrationRequired);
    }
    if version == 0 {
        transaction
            .execute_batch(CREATE_SCHEMA)
            .map_err(|_| ContextDatabaseError::Corrupt)?;
        transaction
            .execute(
                "INSERT INTO context_metadata (singleton, schema_version, policy_version, ranking_version, project_identity_hash, inventory_generation, build_state) VALUES (1, ?1, ?2, ?3, ?4, 0, 'not_built')",
                (SCHEMA_VERSION, POLICY_VERSION, RANKING_VERSION, project_identity_hash(project_id)),
            )
            .map_err(|_| ContextDatabaseError::Corrupt)?;
        transaction
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|_| ContextDatabaseError::Corrupt)?;
    }
    validate_metadata(&transaction, project_id)?;
    transaction
        .commit()
        .map_err(|_| ContextDatabaseError::Unavailable)
}

fn validate_metadata(
    connection: &Connection,
    project_id: &str,
) -> Result<(), ContextDatabaseError> {
    let metadata = connection.query_row(
        "SELECT schema_version, project_identity_hash FROM context_metadata WHERE singleton = 1",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    );
    match metadata {
        Ok((schema, identity))
            if schema == SCHEMA_VERSION && identity == project_identity_hash(project_id) =>
        {
            Ok(())
        }
        Ok(_) => Err(ContextDatabaseError::Corrupt),
        Err(_) => Err(ContextDatabaseError::Corrupt),
    }
}

fn project_identity_hash(project_id: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(project_id.as_bytes()))
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

#[cfg(not(unix))]
fn set_private_file(_path: &Path) -> Result<(), ContextDatabaseError> {
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

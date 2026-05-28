use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::providers;

static TEMP_SECRET_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecretKind {
    ApiKey,
    OAuthAccessToken,
    OAuthRefreshToken,
    AuthMetadata,
}

impl SecretKind {
    fn file_name(self) -> &'static str {
        match self {
            Self::ApiKey => "api-key",
            Self::OAuthAccessToken => "oauth-access-token",
            Self::OAuthRefreshToken => "oauth-refresh-token",
            Self::AuthMetadata => "auth-metadata",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SecretStoreError {
    #[error("invalid provider id")]
    InvalidProviderId,
    #[error("secret storage error")]
    Storage,
    #[error("invalid secret record")]
    InvalidRecord,
}

#[allow(async_fn_in_trait)]
pub trait ProviderSecretStore {
    async fn put_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<(), SecretStoreError>;

    async fn get_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<Option<String>, SecretStoreError>;

    async fn delete_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<(), SecretStoreError>;
}

#[derive(Clone, Debug)]
pub struct FileSecretStore {
    root: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretRecord {
    kind: SecretKind,
    value: String,
}

impl FileSecretStore {
    pub fn new(config_dir: impl AsRef<Path>) -> Self {
        Self {
            root: config_dir.as_ref().join("provider-secrets"),
        }
    }

    pub fn secret_path(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<PathBuf, SecretStoreError> {
        providers::validate_provider_id(provider_id)
            .map_err(|_| SecretStoreError::InvalidProviderId)?;
        Ok(self
            .root
            .join(provider_id)
            .join(format!("{}.json", kind.file_name())))
    }
}

impl ProviderSecretStore for FileSecretStore {
    async fn put_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<(), SecretStoreError> {
        if value.is_empty() {
            return self.delete_secret(provider_id, kind).await;
        }
        let path = self.secret_path(provider_id, kind)?;
        ensure_secret_directories(&self.root, provider_id).await?;
        reject_secret_file_symlink(&path).await?;
        write_secret_record(
            &path,
            &SecretRecord {
                kind,
                value: value.to_string(),
            },
        )
        .await
    }

    async fn get_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<Option<String>, SecretStoreError> {
        let path = self.secret_path(provider_id, kind)?;
        if !ensure_existing_secret_directories(&self.root, provider_id).await? {
            return Ok(None);
        }
        reject_secret_file_symlink(&path).await?;
        let bytes = match tokio::fs::read(path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(SecretStoreError::Storage),
        };
        let record: SecretRecord =
            serde_json::from_slice(&bytes).map_err(|_| SecretStoreError::InvalidRecord)?;
        if record.kind != kind || record.value.is_empty() {
            return Err(SecretStoreError::InvalidRecord);
        }
        Ok(Some(record.value))
    }

    async fn delete_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<(), SecretStoreError> {
        let path = self.secret_path(provider_id, kind)?;
        if !ensure_existing_secret_directories(&self.root, provider_id).await? {
            return Ok(());
        }
        reject_secret_file_symlink(&path).await?;
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(SecretStoreError::Storage),
        }
    }
}

const FULL_REDACTION_MAX_CHARS: usize = 16;
const REDACTION_EDGE_CHARS: usize = 2;

pub fn redact_secret(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= FULL_REDACTION_MAX_CHARS {
        return "[redacted]".to_string();
    }
    let prefix: String = chars.iter().take(REDACTION_EDGE_CHARS).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(REDACTION_EDGE_CHARS)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}...{suffix}")
}

async fn ensure_secret_directories(root: &Path, provider_id: &str) -> Result<(), SecretStoreError> {
    let parent = root.parent().ok_or(SecretStoreError::Storage)?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| SecretStoreError::Storage)?;
    ensure_secret_directory(root, true).await?;
    ensure_secret_directory(&root.join(provider_id), true).await?;
    Ok(())
}

async fn ensure_existing_secret_directories(
    root: &Path,
    provider_id: &str,
) -> Result<bool, SecretStoreError> {
    if !ensure_secret_directory(root, false).await? {
        return Ok(false);
    }
    ensure_secret_directory(&root.join(provider_id), false).await
}

async fn ensure_secret_directory(path: &Path, create: bool) -> Result<bool, SecretStoreError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(SecretStoreError::Storage);
            }
            set_private_directory_permissions(path).await?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            tokio::fs::create_dir(path)
                .await
                .map_err(|_| SecretStoreError::Storage)?;
            set_private_directory_permissions(path).await?;
            Ok(true)
        }
        Err(_) => Err(SecretStoreError::Storage),
    }
}

async fn reject_secret_file_symlink(path: &Path) -> Result<(), SecretStoreError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(SecretStoreError::Storage),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(SecretStoreError::Storage),
    }
}

async fn write_secret_record(path: &Path, record: &SecretRecord) -> Result<(), SecretStoreError> {
    let dir = path.parent().ok_or(SecretStoreError::Storage)?;
    ensure_secret_directory(dir, false).await?;
    reject_secret_file_symlink(path).await?;
    let content = serde_json::to_vec_pretty(record).map_err(|_| SecretStoreError::Storage)?;
    let temp_path = temp_secret_path(path);
    let mut options = tokio::fs::OpenOptions::new();
    options.create_new(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    let result = async {
        let mut file = options
            .open(&temp_path)
            .await
            .map_err(|_| SecretStoreError::Storage)?;
        file.write_all(&content)
            .await
            .map_err(|_| SecretStoreError::Storage)?;
        file.sync_all()
            .await
            .map_err(|_| SecretStoreError::Storage)?;
        drop(file);
        set_private_permissions(&temp_path).await?;
        tokio::fs::rename(&temp_path, path)
            .await
            .map_err(|_| SecretStoreError::Storage)?;
        set_private_permissions(path).await?;
        sync_parent_directory(path).await
    }
    .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            cleanup_temp_secret_file(&temp_path).await?;
            Err(error)
        }
    }
}

async fn cleanup_temp_secret_file(path: &Path) -> Result<(), SecretStoreError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) => match tokio::fs::symlink_metadata(path).await {
            Ok(_) => Err(SecretStoreError::Storage),
            Err(metadata_error)
                if error.kind() == std::io::ErrorKind::NotFound
                    && metadata_error.kind() == std::io::ErrorKind::NotFound =>
            {
                Ok(())
            }
            Err(_) => Err(SecretStoreError::Storage),
        },
    }
}
#[cfg(unix)]
async fn sync_parent_directory(path: &Path) -> Result<(), SecretStoreError> {
    let dir = path
        .parent()
        .ok_or(SecretStoreError::Storage)?
        .to_path_buf();
    tokio::task::spawn_blocking(move || {
        match std::fs::File::open(dir).and_then(|directory| directory.sync_all()) {
            Ok(()) => Ok(()),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::Unsupported
                ) =>
            {
                Ok(())
            }
            Err(_) => Err(SecretStoreError::Storage),
        }
    })
    .await
    .map_err(|_| SecretStoreError::Storage)?
}
#[cfg(not(unix))]
async fn sync_parent_directory(_path: &Path) -> Result<(), SecretStoreError> {
    Ok(())
}

fn temp_secret_path(path: &Path) -> PathBuf {
    let counter = TEMP_SECRET_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("secret.json");
    path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        counter
    ))
}

#[cfg(unix)]
async fn set_private_permissions(path: &Path) -> Result<(), SecretStoreError> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .await
        .map_err(|_| SecretStoreError::Storage)
}

#[cfg(not(unix))]
async fn set_private_permissions(_path: &Path) -> Result<(), SecretStoreError> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_directory_permissions(path: &Path) -> Result<(), SecretStoreError> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .await
        .map_err(|_| SecretStoreError::Storage)
}

#[cfg(not(unix))]
async fn set_private_directory_permissions(_path: &Path) -> Result<(), SecretStoreError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{FileSecretStore, ProviderSecretStore, SecretKind, SecretStoreError};

    static TEST_DIR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-secret-store-test-{}-{}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn redact_secret_fully_redacts_short_values_through_sixteen_chars() {
        for length in 0..=16 {
            let value = "a".repeat(length);
            assert_eq!(super::redact_secret(&value), "[redacted]");
        }
    }

    #[test]
    fn redact_secret_keeps_minimal_signal_for_long_values() {
        for (value, expected) in [
            ("sk-test-secret-abcd", "sk...cd"),
            ("codex-access-token-secret-abcd", "co...cd"),
            ("oauth-refresh-token-secret-wxyz", "oa...yz"),
            ("abcdefghijklmnopq", "ab...pq"),
        ] {
            let redacted = super::redact_secret(value);
            assert_eq!(redacted, expected);
            assert!(!redacted.contains("secret"));
            assert!(!redacted.contains("token"));
        }
    }

    #[tokio::test]
    async fn file_secret_store_put_get_delete_roundtrip() {
        let store = FileSecretStore::new(temp_dir());
        store
            .put_secret("openai-local", SecretKind::ApiKey, "sk-test-secret-abcd")
            .await
            .unwrap();
        assert_eq!(
            store
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap()
                .as_deref(),
            Some("sk-test-secret-abcd")
        );
        store
            .delete_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_eq!(
            store
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn file_secret_store_supports_oauth_and_metadata_kinds() {
        let store = FileSecretStore::new(temp_dir());
        for (kind, value) in [
            (SecretKind::OAuthAccessToken, "access-token"),
            (SecretKind::OAuthRefreshToken, "refresh-token"),
            (SecretKind::AuthMetadata, r#"{"account":"local"}"#),
        ] {
            store.put_secret("openai", kind, value).await.unwrap();
            assert_eq!(
                store.get_secret("openai", kind).await.unwrap().as_deref(),
                Some(value)
            );
        }
    }

    #[cfg(unix)]
    fn file_mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::symlink_metadata(path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn file_secret_store_rejects_provider_directory_symlink_escape() {
        let dir = temp_dir();
        let outside = temp_dir();
        let store = FileSecretStore::new(&dir);
        std::fs::create_dir_all(&outside).unwrap();
        let root = dir.join("provider-secrets");
        std::fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("openai-local")).unwrap();

        assert!(matches!(
            store
                .put_secret("openai-local", SecretKind::ApiKey, "sk-symlink-secret-abcd")
                .await,
            Err(SecretStoreError::Storage)
        ));
        assert!(!outside.join("api-key.json").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn file_secret_store_rejects_secret_file_symlink_read() {
        let dir = temp_dir();
        let outside = temp_dir();
        let store = FileSecretStore::new(&dir);
        let path = store
            .secret_path("openai-local", SecretKind::ApiKey)
            .expect("valid path");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let outside_secret = outside.join("outside-secret.json");
        std::fs::write(
            &outside_secret,
            r#"{"kind":"api_key","value":"sk-outside-secret-abcd"}"#,
        )
        .unwrap();
        std::os::unix::fs::symlink(&outside_secret, &path).unwrap();

        assert!(matches!(
            store.get_secret("openai-local", SecretKind::ApiKey).await,
            Err(SecretStoreError::Storage)
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn file_secret_store_writes_private_directory_and_file_modes() {
        let dir = temp_dir();
        let store = FileSecretStore::new(&dir);
        store
            .put_secret("openai-local", SecretKind::ApiKey, "sk-mode-secret-abcd")
            .await
            .unwrap();
        let root = dir.join("provider-secrets");
        let provider_dir = root.join("openai-local");
        let secret_path = store
            .secret_path("openai-local", SecretKind::ApiKey)
            .expect("valid path");

        assert_eq!(file_mode(&root), 0o700);
        assert_eq!(file_mode(&provider_dir), 0o700);
        assert_eq!(file_mode(&secret_path), 0o600);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn file_secret_store_syncs_parent_directory_after_write() {
        let dir = temp_dir();
        let store = FileSecretStore::new(&dir);
        store
            .put_secret(
                "openai-local",
                SecretKind::ApiKey,
                "sk-directory-sync-secret-abcd",
            )
            .await
            .unwrap();
        let secret_path = store
            .secret_path("openai-local", SecretKind::ApiKey)
            .expect("valid path");

        super::sync_parent_directory(&secret_path).await.unwrap();
    }

    #[tokio::test]
    async fn file_secret_store_missing_and_corrupt_records_are_safe() {
        let dir = temp_dir();
        let store = FileSecretStore::new(&dir);
        assert_eq!(
            store
                .get_secret("missing", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
        let path = store
            .secret_path("corrupt", SecretKind::ApiKey)
            .expect("valid path");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, r#"{"value":"sk-corrupt-secret-abcd""#).unwrap();
        assert!(matches!(
            store.get_secret("corrupt", SecretKind::ApiKey).await,
            Err(SecretStoreError::InvalidRecord)
        ));
    }
}

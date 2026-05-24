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
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(SecretStoreError::Storage),
        }
    }
}

pub fn redact_secret(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 8 {
        return "...".to_string();
    }
    let prefix: String = chars.iter().take(3).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}-...{suffix}")
}

async fn write_secret_record(path: &Path, record: &SecretRecord) -> Result<(), SecretStoreError> {
    let dir = path.parent().ok_or(SecretStoreError::Storage)?;
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|_| SecretStoreError::Storage)?;
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
        set_private_permissions(path).await
    }
    .await;
    let cleanup = tokio::fs::remove_file(&temp_path).await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            if cleanup.is_err() && temp_path.exists() {
                return Err(SecretStoreError::Storage);
            }
            Err(error)
        }
    }
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

#[cfg(test)]
mod tests {
    use super::{FileSecretStore, ProviderSecretStore, SecretKind, SecretStoreError};

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-secret-store-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
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

    #[tokio::test]
    async fn file_secret_store_missing_and_corrupt_records_are_safe() {
        let dir = temp_dir();
        let store = FileSecretStore::new(&dir);
        assert_eq!(
            store.get_secret("missing", SecretKind::ApiKey).await.unwrap(),
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

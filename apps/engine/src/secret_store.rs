use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::providers;

static TEMP_SECRET_COUNTER: AtomicU64 = AtomicU64::new(0);
const OS_KEYCHAIN_SERVICE: &str = "yet-ai.provider-secrets";
const OS_KEYCHAIN_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(100);
static KEYCHAIN_PUT_IF_ABSENT_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
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
    #[error("secret storage unavailable")]
    Unavailable,
    #[error("secret storage disabled")]
    Disabled,
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

    async fn put_secret_if_absent(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<bool, SecretStoreError>;

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
pub struct CompositeProviderSecretStore<P, F> {
    primary: P,
    fallback: F,
}

impl<P, F> CompositeProviderSecretStore<P, F> {
    pub fn new(primary: P, fallback: F) -> Self {
        Self { primary, fallback }
    }
}

impl<P, F> CompositeProviderSecretStore<P, F>
where
    P: ProviderSecretStore,
    F: ProviderSecretStore,
{
    async fn put_verified_primary(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<bool, SecretStoreError> {
        match self.primary.put_secret(provider_id, kind, value).await {
            Ok(()) => {}
            Err(SecretStoreError::Disabled) => return Ok(false),
            Err(SecretStoreError::Unavailable) => return Err(SecretStoreError::Unavailable),
            Err(error) => return Err(error),
        }
        match self.primary.get_secret(provider_id, kind).await {
            Ok(Some(stored)) if stored == value => Ok(true),
            Ok(_) => Err(SecretStoreError::Storage),
            Err(SecretStoreError::Disabled) => Ok(false),
            Err(SecretStoreError::Unavailable) => Err(SecretStoreError::Unavailable),
            Err(error) => Err(error),
        }
    }

    async fn migrate_fallback_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<(), SecretStoreError> {
        if self.put_verified_primary(provider_id, kind, value).await? {
            self.fallback.delete_secret(provider_id, kind).await?;
        }
        Ok(())
    }

    async fn retry_fallback_cleanup(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<(), SecretStoreError> {
        if self.fallback.get_secret(provider_id, kind).await?.is_some() {
            self.fallback.delete_secret(provider_id, kind).await?;
        }
        Ok(())
    }
}

impl<P, F> ProviderSecretStore for CompositeProviderSecretStore<P, F>
where
    P: ProviderSecretStore,
    F: ProviderSecretStore,
{
    async fn put_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<(), SecretStoreError> {
        if value.is_empty() {
            return self.delete_secret(provider_id, kind).await;
        }
        if self.put_verified_primary(provider_id, kind, value).await? {
            self.fallback.delete_secret(provider_id, kind).await?;
            return Ok(());
        }
        self.fallback.put_secret(provider_id, kind, value).await
    }

    async fn put_secret_if_absent(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<bool, SecretStoreError> {
        if value.is_empty() {
            return Ok(false);
        }
        if self.get_secret(provider_id, kind).await?.is_some() {
            return Ok(false);
        }
        match self
            .primary
            .put_secret_if_absent(provider_id, kind, value)
            .await
        {
            Ok(false) => Ok(false),
            Ok(true) => match self.primary.get_secret(provider_id, kind).await {
                Ok(Some(stored)) if stored == value => {
                    self.fallback.delete_secret(provider_id, kind).await?;
                    Ok(true)
                }
                Ok(_) => Err(SecretStoreError::Storage),
                Err(SecretStoreError::Disabled) => {
                    self.fallback
                        .put_secret_if_absent(provider_id, kind, value)
                        .await
                }
                Err(SecretStoreError::Unavailable) => Err(SecretStoreError::Unavailable),
                Err(error) => Err(error),
            },
            Err(SecretStoreError::Disabled) => {
                self.fallback
                    .put_secret_if_absent(provider_id, kind, value)
                    .await
            }
            Err(SecretStoreError::Unavailable) => Err(SecretStoreError::Unavailable),
            Err(error) => Err(error),
        }
    }

    async fn get_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<Option<String>, SecretStoreError> {
        match self.primary.get_secret(provider_id, kind).await {
            Ok(Some(secret)) => {
                self.retry_fallback_cleanup(provider_id, kind).await?;
                Ok(Some(secret))
            }
            Ok(None) => {
                let fallback = self.fallback.get_secret(provider_id, kind).await?;
                if let Some(secret) = fallback.as_deref() {
                    self.migrate_fallback_secret(provider_id, kind, secret)
                        .await?;
                }
                Ok(fallback)
            }
            Err(SecretStoreError::Disabled) => self.fallback.get_secret(provider_id, kind).await,
            Err(SecretStoreError::Unavailable) => Err(SecretStoreError::Unavailable),
            Err(error) => Err(error),
        }
    }

    async fn delete_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<(), SecretStoreError> {
        let primary = self.primary.delete_secret(provider_id, kind).await;
        let fallback = self.fallback.delete_secret(provider_id, kind).await;
        match (primary, fallback) {
            (Ok(()), Ok(()))
            | (Ok(()), Err(SecretStoreError::Disabled))
            | (Err(SecretStoreError::Disabled), Ok(()))
            | (Err(SecretStoreError::Disabled), Err(SecretStoreError::Disabled)) => Ok(()),
            (Err(error), _) | (_, Err(error)) => Err(error),
        }
    }
}

#[cfg(not(any(test, debug_assertions)))]
pub type ProductionProviderSecretStore =
    CompositeProviderSecretStore<OsKeychainSecretStore, FileSecretStore>;

#[cfg(any(test, debug_assertions))]
pub type ProductionProviderSecretStore =
    CompositeProviderSecretStore<TestUnavailableSecretStore, FileSecretStore>;

#[cfg(not(any(test, debug_assertions)))]
pub fn provider_secret_store(config_dir: impl AsRef<Path>) -> ProductionProviderSecretStore {
    CompositeProviderSecretStore::new(
        OsKeychainSecretStore::new(),
        FileSecretStore::new(config_dir),
    )
}

#[cfg(any(test, debug_assertions))]
pub fn provider_secret_store(config_dir: impl AsRef<Path>) -> ProductionProviderSecretStore {
    CompositeProviderSecretStore::new(TestUnavailableSecretStore, FileSecretStore::new(config_dir))
}

#[cfg(any(test, debug_assertions))]
#[derive(Clone, Debug)]
pub struct TestUnavailableSecretStore;

#[cfg(any(test, debug_assertions))]
impl ProviderSecretStore for TestUnavailableSecretStore {
    async fn put_secret(
        &self,
        _provider_id: &str,
        _kind: SecretKind,
        _value: &str,
    ) -> Result<(), SecretStoreError> {
        Err(SecretStoreError::Disabled)
    }

    async fn put_secret_if_absent(
        &self,
        _provider_id: &str,
        _kind: SecretKind,
        _value: &str,
    ) -> Result<bool, SecretStoreError> {
        Err(SecretStoreError::Disabled)
    }

    async fn get_secret(
        &self,
        _provider_id: &str,
        _kind: SecretKind,
    ) -> Result<Option<String>, SecretStoreError> {
        Err(SecretStoreError::Disabled)
    }

    async fn delete_secret(
        &self,
        _provider_id: &str,
        _kind: SecretKind,
    ) -> Result<(), SecretStoreError> {
        Err(SecretStoreError::Disabled)
    }
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

    async fn put_secret_if_absent(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<bool, SecretStoreError> {
        if value.is_empty() {
            return Ok(false);
        }
        let path = self.secret_path(provider_id, kind)?;
        ensure_secret_directories(&self.root, provider_id).await?;
        reject_secret_file_symlink(&path).await?;
        write_secret_record_if_absent(
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
        let bytes = match read_secret_file(&path).await? {
            Some(bytes) => bytes,
            None => return Ok(None),
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

#[derive(Clone, Debug, Default)]
pub struct OsKeychainSecretStore;

impl OsKeychainSecretStore {
    pub fn new() -> Self {
        Self
    }
}

impl ProviderSecretStore for OsKeychainSecretStore {
    async fn put_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<(), SecretStoreError> {
        if value.is_empty() {
            return self.delete_secret(provider_id, kind).await;
        }
        let account = keychain_account(provider_id, kind)?;
        let value = value.to_string();
        run_keychain_mutation(move || {
            let entry = ProductionKeychainAdapter::entry(OS_KEYCHAIN_SERVICE, &account)?;
            ProductionKeychainAdapter::set_password(&entry, &value)
        })
        .await
    }

    async fn put_secret_if_absent(
        &self,
        provider_id: &str,
        kind: SecretKind,
        value: &str,
    ) -> Result<bool, SecretStoreError> {
        if value.is_empty() {
            return Ok(false);
        }
        let _guard = KEYCHAIN_PUT_IF_ABSENT_LOCK.lock().await;
        if self.get_secret(provider_id, kind).await?.is_some() {
            return Ok(false);
        }
        self.put_secret(provider_id, kind, value).await?;
        match self.get_secret(provider_id, kind).await? {
            Some(stored) if stored == value => Ok(true),
            _ => Err(SecretStoreError::Storage),
        }
    }

    async fn get_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<Option<String>, SecretStoreError> {
        let account = keychain_account(provider_id, kind)?;
        run_keychain_read(move || {
            let entry = ProductionKeychainAdapter::entry(OS_KEYCHAIN_SERVICE, &account)?;
            ProductionKeychainAdapter::get_password(&entry)
        })
        .await
    }

    async fn delete_secret(
        &self,
        provider_id: &str,
        kind: SecretKind,
    ) -> Result<(), SecretStoreError> {
        let account = keychain_account(provider_id, kind)?;
        run_keychain_mutation(move || {
            let entry = ProductionKeychainAdapter::entry(OS_KEYCHAIN_SERVICE, &account)?;
            ProductionKeychainAdapter::delete_credential(&entry)
        })
        .await
    }
}

fn keychain_account(provider_id: &str, kind: SecretKind) -> Result<String, SecretStoreError> {
    providers::validate_provider_id(provider_id)
        .map_err(|_| SecretStoreError::InvalidProviderId)?;
    Ok(format!("{provider_id}:{}", kind.file_name()))
}

async fn run_keychain_read<R>(
    f: impl FnOnce() -> Result<R, KeychainError> + Send + 'static,
) -> Result<R, SecretStoreError>
where
    R: Send + 'static,
{
    tokio::time::timeout(OS_KEYCHAIN_READ_TIMEOUT, tokio::task::spawn_blocking(f))
        .await
        .map_err(|_| SecretStoreError::Unavailable)?
        .map_err(|_| SecretStoreError::Storage)?
        .map_err(keychain_error_to_secret_store_error)
}

async fn run_keychain_mutation<R>(
    f: impl FnOnce() -> Result<R, KeychainError> + Send + 'static,
) -> Result<R, SecretStoreError>
where
    R: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|_| SecretStoreError::Storage)?
        .map_err(keychain_error_to_secret_store_error)
}

#[derive(Debug, PartialEq, Eq)]
#[allow(dead_code)]
enum KeychainError {
    NoEntry,
    Unavailable,
    Disabled,
    Storage,
}

fn keychain_error_to_secret_store_error(error: KeychainError) -> SecretStoreError {
    match error {
        KeychainError::NoEntry => SecretStoreError::Storage,
        KeychainError::Unavailable => SecretStoreError::Unavailable,
        KeychainError::Disabled => SecretStoreError::Disabled,
        KeychainError::Storage => SecretStoreError::Storage,
    }
}

#[cfg(feature = "os-keychain")]
struct ProductionKeychainAdapter;

#[cfg(feature = "os-keychain")]
impl ProductionKeychainAdapter {
    fn entry(service: &str, account: &str) -> Result<keyring::Entry, KeychainError> {
        keyring::Entry::new(service, account).map_err(map_keyring_error)
    }

    fn set_password(entry: &keyring::Entry, value: &str) -> Result<(), KeychainError> {
        entry.set_password(value).map_err(map_keyring_error)
    }

    fn get_password(entry: &keyring::Entry) -> Result<Option<String>, KeychainError> {
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(map_keyring_error(error)),
        }
    }

    fn delete_credential(entry: &keyring::Entry) -> Result<(), KeychainError> {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(map_keyring_error(error)),
        }
    }
}

#[cfg(feature = "os-keychain")]
fn map_keyring_error(error: keyring::Error) -> KeychainError {
    match error {
        keyring::Error::NoEntry => KeychainError::NoEntry,
        keyring::Error::NoStorageAccess(_) => KeychainError::Unavailable,
        keyring::Error::PlatformFailure(_)
        | keyring::Error::BadEncoding(_)
        | keyring::Error::TooLong(_, _)
        | keyring::Error::Invalid(_, _)
        | keyring::Error::Ambiguous(_) => KeychainError::Storage,
        _ => KeychainError::Storage,
    }
}

#[cfg(not(feature = "os-keychain"))]
struct ProductionKeychainAdapter;

#[cfg(not(feature = "os-keychain"))]
impl ProductionKeychainAdapter {
    fn entry(_service: &str, _account: &str) -> Result<(), KeychainError> {
        Err(KeychainError::Disabled)
    }

    fn set_password(_entry: &(), _value: &str) -> Result<(), KeychainError> {
        Err(KeychainError::Disabled)
    }

    fn get_password(_entry: &()) -> Result<Option<String>, KeychainError> {
        Err(KeychainError::Disabled)
    }

    fn delete_credential(_entry: &()) -> Result<(), KeychainError> {
        Err(KeychainError::Disabled)
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
            match tokio::fs::create_dir(path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(SecretStoreError::Storage),
            }
            let metadata = tokio::fs::symlink_metadata(path)
                .await
                .map_err(|_| SecretStoreError::Storage)?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(SecretStoreError::Storage);
            }
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
        set_private_permissions_for_open_file(file).await?;
        tokio::fs::rename(&temp_path, path)
            .await
            .map_err(|_| SecretStoreError::Storage)
    }
    .await;
    match result {
        Ok(()) => {
            let _ = set_private_permissions(path).await;
            let _ = sync_parent_directory(path).await;
            Ok(())
        }
        Err(error) => {
            cleanup_temp_secret_file(&temp_path).await?;
            Err(error)
        }
    }
}

async fn write_secret_record_if_absent(
    path: &Path,
    record: &SecretRecord,
) -> Result<bool, SecretStoreError> {
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
        set_private_permissions_for_open_file(file).await?;
        match tokio::fs::hard_link(&temp_path, path).await {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(_) => Err(SecretStoreError::Storage),
        }
    }
    .await;
    let cleanup = cleanup_temp_secret_file(&temp_path).await;
    match (result, cleanup) {
        (Ok(created), Ok(())) => {
            if created {
                let _ = set_private_permissions(path).await;
                let _ = sync_parent_directory(path).await;
            }
            Ok(created)
        }
        (Err(error), Ok(())) => Err(error),
        (_, Err(error)) => Err(error),
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
        match open_directory_no_follow(&dir).and_then(|directory| directory.sync_all()) {
            Ok(()) => Ok(()),
            Err(error) if is_unsupported_directory_sync_error(&error) => Ok(()),
            Err(_) => Err(SecretStoreError::Storage),
        }
    })
    .await
    .map_err(|_| SecretStoreError::Storage)?
}

#[cfg(unix)]
fn is_unsupported_directory_sync_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::PermissionDenied
            | std::io::ErrorKind::Unsupported
            | std::io::ErrorKind::InvalidInput
    ) || error.raw_os_error() == Some(22)
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
async fn read_secret_file(path: &Path) -> Result<Option<Vec<u8>>, SecretStoreError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::io::Read;

        let mut file = match open_file_no_follow(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(SecretStoreError::Storage),
        };
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|_| SecretStoreError::Storage)?;
        Ok(Some(bytes))
    })
    .await
    .map_err(|_| SecretStoreError::Storage)?
}

#[cfg(not(unix))]
async fn read_secret_file(path: &Path) -> Result<Option<Vec<u8>>, SecretStoreError> {
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(SecretStoreError::Storage),
    }
}

#[cfg(unix)]
fn open_file_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(unix)]
fn open_directory_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(unix)]
async fn set_private_permissions_for_open_file(
    file: tokio::fs::File,
) -> Result<(), SecretStoreError> {
    use std::os::unix::fs::PermissionsExt;

    let file = file.into_std().await;
    tokio::task::spawn_blocking(move || {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| SecretStoreError::Storage)
    })
    .await
    .map_err(|_| SecretStoreError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions_for_open_file(
    file: tokio::fs::File,
) -> Result<(), SecretStoreError> {
    drop(file);
    Ok(())
}

#[cfg(unix)]
async fn set_private_permissions(path: &Path) -> Result<(), SecretStoreError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = open_file_no_follow(&path).map_err(|_| SecretStoreError::Storage)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| SecretStoreError::Storage)
    })
    .await
    .map_err(|_| SecretStoreError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions(_path: &Path) -> Result<(), SecretStoreError> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_directory_permissions(path: &Path) -> Result<(), SecretStoreError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let directory = open_directory_no_follow(&path).map_err(|_| SecretStoreError::Storage)?;
        directory
            .set_permissions(std::fs::Permissions::from_mode(0o700))
            .map_err(|_| SecretStoreError::Storage)
    })
    .await
    .map_err(|_| SecretStoreError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_directory_permissions(_path: &Path) -> Result<(), SecretStoreError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        CompositeProviderSecretStore, FileSecretStore, ProviderSecretStore, SecretKind,
        SecretStoreError,
    };
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

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

    fn test_secret_digest(value: &str) -> u64 {
        use std::hash::{Hash, Hasher};

        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        value.hash(&mut hasher);
        hasher.finish()
    }

    fn assert_stored_secret(actual: Option<&str>, expected: &str) {
        let Some(actual) = actual else {
            panic!("expected stored secret to be present");
        };
        assert_eq!(
            actual.len(),
            expected.len(),
            "stored secret length mismatch"
        );
        assert_eq!(
            test_secret_digest(actual),
            test_secret_digest(expected),
            "stored secret digest mismatch"
        );
        assert_eq!(
            test_secret_digest(actual),
            test_secret_digest(expected),
            "stored secret value mismatch"
        );
    }

    fn assert_secret_is_one_of(actual: &str, expected: &[&str]) {
        let actual_digest = test_secret_digest(actual);
        assert!(
            expected
                .iter()
                .any(|value| value.len() == actual.len()
                    && test_secret_digest(value) == actual_digest),
            "stored secret did not match an expected digest"
        );
    }

    type TestSecretKey = (String, SecretKind);

    #[derive(Clone, Debug, Default)]
    struct MockSecretBackend {
        state: Arc<Mutex<MockSecretBackendState>>,
    }

    #[derive(Debug, Default)]
    struct MockSecretBackendState {
        records: HashMap<TestSecretKey, String>,
        unavailable: bool,
        disabled: bool,
        put_failure: bool,
        get_failure: bool,
        delete_failure: bool,
        delete_failures_remaining: usize,
        read_back_mismatch: bool,
        put_count: usize,
        delete_count: usize,
    }

    impl MockSecretBackend {
        fn unavailable() -> Self {
            let store = Self::default();
            store.with_state(|state| state.unavailable = true);
            store
        }

        fn disabled() -> Self {
            let store = Self::default();
            store.with_state(|state| state.disabled = true);
            store
        }

        fn put_failure() -> Self {
            let store = Self::default();
            store.with_state(|state| state.put_failure = true);
            store
        }

        fn delete_failure() -> Self {
            let store = Self::default();
            store.with_state(|state| state.delete_failure = true);
            store
        }

        fn delete_fail_once() -> Self {
            let store = Self::default();
            store.with_state(|state| state.delete_failures_remaining = 1);
            store
        }

        fn read_back_mismatch() -> Self {
            let store = Self::default();
            store.with_state(|state| state.read_back_mismatch = true);
            store
        }

        fn with_secret(provider_id: &str, kind: SecretKind, value: &str) -> Self {
            let store = Self::default();
            store.with_state(|state| {
                state
                    .records
                    .insert((provider_id.to_string(), kind), value.to_string());
            });
            store
        }

        fn with_state<R>(&self, f: impl FnOnce(&mut MockSecretBackendState) -> R) -> R {
            f(&mut self.state.lock().unwrap())
        }

        fn put_count(&self) -> usize {
            self.with_state(|state| state.put_count)
        }

        fn delete_count(&self) -> usize {
            self.with_state(|state| state.delete_count)
        }
    }

    impl ProviderSecretStore for MockSecretBackend {
        async fn put_secret(
            &self,
            provider_id: &str,
            kind: SecretKind,
            value: &str,
        ) -> Result<(), SecretStoreError> {
            self.with_state(|state| {
                if state.disabled {
                    return Err(SecretStoreError::Disabled);
                }
                if state.unavailable {
                    return Err(SecretStoreError::Unavailable);
                }
                if state.put_failure {
                    return Err(SecretStoreError::Storage);
                }
                state.put_count += 1;
                if value.is_empty() {
                    state.records.remove(&(provider_id.to_string(), kind));
                } else {
                    state
                        .records
                        .insert((provider_id.to_string(), kind), value.to_string());
                }
                Ok(())
            })
        }

        async fn put_secret_if_absent(
            &self,
            provider_id: &str,
            kind: SecretKind,
            value: &str,
        ) -> Result<bool, SecretStoreError> {
            self.with_state(|state| {
                if state.disabled {
                    return Err(SecretStoreError::Disabled);
                }
                if state.unavailable {
                    return Err(SecretStoreError::Unavailable);
                }
                if state.put_failure {
                    return Err(SecretStoreError::Storage);
                }
                let key = (provider_id.to_string(), kind);
                if value.is_empty() || state.records.contains_key(&key) {
                    return Ok(false);
                }
                state.put_count += 1;
                state.records.insert(key, value.to_string());
                Ok(true)
            })
        }

        async fn get_secret(
            &self,
            provider_id: &str,
            kind: SecretKind,
        ) -> Result<Option<String>, SecretStoreError> {
            self.with_state(|state| {
                if state.disabled {
                    return Err(SecretStoreError::Disabled);
                }
                if state.unavailable {
                    return Err(SecretStoreError::Unavailable);
                }
                if state.get_failure {
                    return Err(SecretStoreError::Storage);
                }
                let secret = state.records.get(&(provider_id.to_string(), kind)).cloned();
                if secret.is_some() && state.read_back_mismatch {
                    return Ok(Some("mismatched-secret-value".to_string()));
                }
                Ok(secret)
            })
        }

        async fn delete_secret(
            &self,
            provider_id: &str,
            kind: SecretKind,
        ) -> Result<(), SecretStoreError> {
            self.with_state(|state| {
                if state.disabled {
                    return Err(SecretStoreError::Disabled);
                }
                if state.unavailable {
                    return Err(SecretStoreError::Unavailable);
                }
                if state.delete_failure {
                    return Err(SecretStoreError::Storage);
                }
                if state.delete_failures_remaining > 0 {
                    state.delete_failures_remaining -= 1;
                    return Err(SecretStoreError::Storage);
                }
                state.delete_count += 1;
                state.records.remove(&(provider_id.to_string(), kind));
                Ok(())
            })
        }
    }

    #[tokio::test]
    async fn composite_secret_store_primary_wins_over_fallback() {
        let primary = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-primary-secret-abcd",
        );
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-fallback-secret-wxyz",
        );
        let store = CompositeProviderSecretStore::new(primary.clone(), fallback.clone());

        let secret = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();

        assert_stored_secret(secret.as_deref(), "sk-composite-primary-secret-abcd");
        assert_eq!(primary.put_count(), 0);
        assert_eq!(fallback.delete_count(), 1);
    }

    #[tokio::test]
    async fn composite_secret_store_rejects_fallback_read_when_primary_unavailable() {
        let primary = MockSecretBackend::unavailable();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-fallback-read-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback);

        let error = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Unavailable));
    }

    #[tokio::test]
    async fn composite_secret_store_reads_fallback_when_primary_disabled() {
        let primary = MockSecretBackend::disabled();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-disabled-fallback-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        let secret = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();

        assert_stored_secret(secret.as_deref(), "sk-composite-disabled-fallback-abcd");
        assert_eq!(fallback.delete_count(), 0);
    }

    #[tokio::test]
    async fn composite_secret_store_migrates_fallback_after_verified_primary_write() {
        let primary = MockSecretBackend::default();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-migrate-secret-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary.clone(), fallback.clone());

        let secret = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();

        assert_stored_secret(secret.as_deref(), "sk-composite-migrate-secret-abcd");
        let primary_secret = primary
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(
            primary_secret.as_deref(),
            "sk-composite-migrate-secret-abcd",
        );
        assert_eq!(
            fallback
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
        assert_eq!(fallback.delete_count(), 1);
    }

    #[tokio::test]
    async fn composite_secret_store_retries_fallback_cleanup_after_prior_failure() {
        let primary = MockSecretBackend::default();
        let fallback = MockSecretBackend::delete_fail_once();
        fallback
            .put_secret(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-cleanup-retry-abcd",
            )
            .await
            .unwrap();
        let store = CompositeProviderSecretStore::new(primary.clone(), fallback.clone());

        let error = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap_err();
        assert!(matches!(error, SecretStoreError::Storage));
        let secret = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();

        assert_stored_secret(secret.as_deref(), "sk-composite-cleanup-retry-abcd");
        assert_eq!(fallback.delete_count(), 1);
        assert_eq!(
            fallback
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn composite_secret_store_fails_closed_when_primary_healthy_and_fallback_cleanup_broken()
    {
        let primary = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-cleanup-primary-abcd",
        );
        let fallback = MockSecretBackend::delete_failure();
        fallback
            .put_secret(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-cleanup-fallback-wxyz",
            )
            .await
            .unwrap();
        let store = CompositeProviderSecretStore::new(primary, fallback);

        let error = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Storage));
        assert_eq!(error.to_string(), "secret storage error");
    }

    #[tokio::test]
    async fn composite_secret_store_keeps_fallback_when_verification_fails() {
        let primary = MockSecretBackend::read_back_mismatch();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-verify-failure-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        assert!(matches!(
            store.get_secret("openai-local", SecretKind::ApiKey).await,
            Err(SecretStoreError::Storage)
        ));
        let fallback_secret = fallback
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(
            fallback_secret.as_deref(),
            "sk-composite-verify-failure-abcd",
        );
        assert_eq!(fallback.delete_count(), 0);
    }

    #[tokio::test]
    async fn composite_secret_store_put_uses_fallback_when_primary_disabled() {
        let primary = MockSecretBackend::disabled();
        let fallback = MockSecretBackend::default();
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        store
            .put_secret(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-put-fallback-abcd",
            )
            .await
            .unwrap();

        let secret = fallback
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(secret.as_deref(), "sk-composite-put-fallback-abcd");
    }

    #[tokio::test]
    async fn composite_secret_store_rejects_fallback_write_when_primary_unavailable() {
        let primary = MockSecretBackend::unavailable();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-current-fallback-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        let error = store
            .put_secret(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-newer-fallback-wxyz",
            )
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Unavailable));
        let secret = fallback
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(secret.as_deref(), "sk-composite-current-fallback-abcd");
    }

    #[tokio::test]
    async fn composite_secret_store_delete_covers_both_stores() {
        let primary = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-delete-primary-abcd",
        );
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-delete-fallback-wxyz",
        );
        let store = CompositeProviderSecretStore::new(primary.clone(), fallback.clone());

        store
            .delete_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();

        assert_eq!(primary.delete_count(), 1);
        assert_eq!(fallback.delete_count(), 1);
        assert_eq!(
            primary
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            fallback
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn composite_secret_store_delete_rejects_success_when_primary_unavailable() {
        let primary = MockSecretBackend::unavailable();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-delete-fallback-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        let error = store
            .delete_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Unavailable));
        assert_eq!(fallback.delete_count(), 1);
    }

    #[tokio::test]
    async fn composite_secret_store_delete_allows_disabled_primary_fallback_cleanup() {
        let primary = MockSecretBackend::disabled();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-delete-disabled-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        store
            .delete_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();

        assert_eq!(fallback.delete_count(), 1);
    }

    #[tokio::test]
    async fn composite_secret_store_primary_wins_for_all_provider_secret_kinds() {
        for (provider_id, kind, primary_secret, stale_fallback_secret) in [
            (
                "openai-api-primary",
                SecretKind::ApiKey,
                "sk-composite-primary-api-secret-abcd",
                "sk-composite-stale-api-secret-wxyz",
            ),
            (
                "openai-oauth-access",
                SecretKind::OAuthAccessToken,
                "codex-primary-access-token-abcd",
                "codex-stale-access-token-wxyz",
            ),
            (
                "openai-oauth-refresh",
                SecretKind::OAuthRefreshToken,
                "codex-primary-refresh-token-abcd",
                "codex-stale-refresh-token-wxyz",
            ),
            (
                "openai-oauth-metadata",
                SecretKind::AuthMetadata,
                r#"{"account":"primary","chatBaseUrl":"http://127.0.0.1:1"}"#,
                r#"{"account":"stale","chatBaseUrl":"http://127.0.0.1:2"}"#,
            ),
        ] {
            let primary = MockSecretBackend::with_secret(provider_id, kind, primary_secret);
            let fallback = MockSecretBackend::with_secret(provider_id, kind, stale_fallback_secret);
            let store = CompositeProviderSecretStore::new(primary.clone(), fallback.clone());

            let secret = store.get_secret(provider_id, kind).await.unwrap();

            assert_stored_secret(secret.as_deref(), primary_secret);
            assert_eq!(fallback.get_secret(provider_id, kind).await.unwrap(), None);
            assert_eq!(fallback.delete_count(), 1);
        }
    }

    #[tokio::test]
    async fn composite_secret_store_migrates_all_secret_kinds_after_verified_primary_write() {
        for (provider_id, kind, fallback_secret) in [
            (
                "openai-api-migrate",
                SecretKind::ApiKey,
                "sk-composite-migrate-api-secret-abcd",
            ),
            (
                "openai-access-migrate",
                SecretKind::OAuthAccessToken,
                "codex-migrate-access-token-abcd",
            ),
            (
                "openai-refresh-migrate",
                SecretKind::OAuthRefreshToken,
                "codex-migrate-refresh-token-abcd",
            ),
            (
                "openai-metadata-migrate",
                SecretKind::AuthMetadata,
                r#"{"account":"fallback","chatBaseUrl":"http://127.0.0.1:3"}"#,
            ),
        ] {
            let primary = MockSecretBackend::default();
            let fallback = MockSecretBackend::with_secret(provider_id, kind, fallback_secret);
            let store = CompositeProviderSecretStore::new(primary.clone(), fallback.clone());

            let secret = store.get_secret(provider_id, kind).await.unwrap();

            assert_stored_secret(secret.as_deref(), fallback_secret);
            let primary_secret = primary.get_secret(provider_id, kind).await.unwrap();
            assert_stored_secret(primary_secret.as_deref(), fallback_secret);
            assert_eq!(fallback.get_secret(provider_id, kind).await.unwrap(), None);
            assert_eq!(fallback.delete_count(), 1);
        }
    }

    #[tokio::test]
    async fn composite_secret_store_put_keeps_fallback_when_primary_readback_mismatches() {
        let primary = MockSecretBackend::read_back_mismatch();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-existing-fallback-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        let error = store
            .put_secret(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-replacement-secret-wxyz",
            )
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Storage));
        assert_eq!(error.to_string(), "secret storage error");
        let fallback_secret = fallback
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(
            fallback_secret.as_deref(),
            "sk-composite-existing-fallback-abcd",
        );
        assert_eq!(fallback.delete_count(), 0);
    }

    #[tokio::test]
    async fn composite_secret_store_put_if_absent_keeps_fallback_when_primary_readback_mismatches()
    {
        let primary = MockSecretBackend::read_back_mismatch();
        let fallback = MockSecretBackend::default();
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        let error = store
            .put_secret_if_absent(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-if-absent-mismatch-abcd",
            )
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Storage));
        assert_eq!(error.to_string(), "secret storage error");
        assert_eq!(
            fallback
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
        assert_eq!(fallback.delete_count(), 0);
    }

    #[tokio::test]
    async fn composite_secret_store_put_if_absent_rejects_unavailable_primary_fallback_write() {
        let primary = MockSecretBackend::unavailable();
        let fallback = MockSecretBackend::default();
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        let error = store
            .put_secret_if_absent(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-if-absent-unavailable-abcd",
            )
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Unavailable));
        assert_eq!(
            fallback
                .get_secret("openai-local", SecretKind::ApiKey)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn composite_secret_store_put_if_absent_keeps_existing_primary_secret() {
        let primary = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-existing-primary-abcd",
        );
        let fallback = MockSecretBackend::default();
        let store = CompositeProviderSecretStore::new(primary.clone(), fallback);

        let created = store
            .put_secret_if_absent(
                "openai-local",
                SecretKind::ApiKey,
                "sk-composite-stale-inline-wxyz",
            )
            .await
            .unwrap();

        assert!(!created);
        let secret = primary
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(secret.as_deref(), "sk-composite-existing-primary-abcd");
    }

    #[tokio::test]
    async fn composite_secret_store_delete_covers_oauth_secret_kinds_in_both_stores() {
        let primary = MockSecretBackend::default();
        let fallback = MockSecretBackend::default();
        for kind in [
            SecretKind::OAuthAccessToken,
            SecretKind::OAuthRefreshToken,
            SecretKind::AuthMetadata,
        ] {
            primary
                .put_secret("openai", kind, "codex-delete-primary-secret-abcd")
                .await
                .unwrap();
            fallback
                .put_secret("openai", kind, "codex-delete-fallback-secret-wxyz")
                .await
                .unwrap();
        }
        let store = CompositeProviderSecretStore::new(primary.clone(), fallback.clone());

        for kind in [
            SecretKind::OAuthAccessToken,
            SecretKind::OAuthRefreshToken,
            SecretKind::AuthMetadata,
        ] {
            store.delete_secret("openai", kind).await.unwrap();
            assert_eq!(primary.get_secret("openai", kind).await.unwrap(), None);
            assert_eq!(fallback.get_secret("openai", kind).await.unwrap(), None);
        }

        assert_eq!(primary.delete_count(), 3);
        assert_eq!(fallback.delete_count(), 3);
    }
    #[tokio::test]
    async fn composite_secret_store_delete_surfaces_sanitized_storage_failure() {
        let primary = MockSecretBackend::delete_failure();
        let fallback = MockSecretBackend::with_secret(
            "openai-local",
            SecretKind::ApiKey,
            "sk-composite-delete-failure-abcd",
        );
        let store = CompositeProviderSecretStore::new(primary, fallback.clone());

        let error = store
            .delete_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Storage));
        assert_eq!(error.to_string(), "secret storage error");
        assert_eq!(fallback.delete_count(), 1);
    }

    #[tokio::test]
    async fn composite_secret_store_storage_failures_are_sanitized() {
        let primary = MockSecretBackend::put_failure();
        let fallback = MockSecretBackend::default();
        let store = CompositeProviderSecretStore::new(primary, fallback);
        let forbidden = "sk-composite-storage-failure-abcd";

        let error = store
            .put_secret("openai-local", SecretKind::ApiKey, forbidden)
            .await
            .unwrap_err();

        assert!(matches!(error, SecretStoreError::Storage));
        assert_eq!(error.to_string(), "secret storage error");
        assert!(!error.to_string().contains(forbidden));
    }

    #[test]
    fn os_keychain_names_are_stable_bounded_and_secret_free() {
        let account = super::keychain_account("openai-local", SecretKind::OAuthRefreshToken)
            .expect("valid account");

        assert_eq!(super::OS_KEYCHAIN_SERVICE, "yet-ai.provider-secrets");
        assert_eq!(account, "openai-local:oauth-refresh-token");
        assert!(account.len() <= 96);
        assert!(!super::OS_KEYCHAIN_SERVICE.contains("sk-"));
        assert!(!super::OS_KEYCHAIN_SERVICE.contains("token-value"));
        assert!(!super::OS_KEYCHAIN_SERVICE.contains('/'));
        assert!(!super::OS_KEYCHAIN_SERVICE.contains("http"));
        assert!(!super::OS_KEYCHAIN_SERVICE.contains("code_verifier"));
        for forbidden in ["sk-", "token-value", "/", "http", "code_verifier"] {
            assert!(!account.contains(forbidden));
        }
    }

    #[test]
    fn os_keychain_account_rejects_unsafe_provider_ids() {
        assert!(matches!(
            super::keychain_account("../openai", SecretKind::ApiKey),
            Err(SecretStoreError::InvalidProviderId)
        ));
        assert!(matches!(
            super::keychain_account("openai/local", SecretKind::ApiKey),
            Err(SecretStoreError::InvalidProviderId)
        ));
    }

    #[test]
    fn keychain_errors_map_to_sanitized_secret_store_errors() {
        assert!(matches!(
            super::keychain_error_to_secret_store_error(super::KeychainError::Unavailable),
            SecretStoreError::Unavailable
        ));
        assert!(matches!(
            super::keychain_error_to_secret_store_error(super::KeychainError::Storage),
            SecretStoreError::Storage
        ));
        let error = super::keychain_error_to_secret_store_error(super::KeychainError::Storage);
        assert_eq!(error.to_string(), "secret storage error");
        assert!(!error.to_string().contains("sk-keychain-secret-abcd"));
    }

    #[tokio::test]
    async fn keychain_read_timeout_returns_unavailable_without_waiting() {
        let started = std::time::Instant::now();
        let result = super::run_keychain_read(|| {
            std::thread::sleep(std::time::Duration::from_millis(250));
            Ok(())
        })
        .await;

        assert!(matches!(result, Err(SecretStoreError::Unavailable)));
        assert!(started.elapsed() < std::time::Duration::from_millis(200));
    }

    #[tokio::test]
    async fn keychain_mutation_waits_for_delayed_completion() {
        let completed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mutation_completed = Arc::clone(&completed);
        let started = std::time::Instant::now();

        let result = super::run_keychain_mutation(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            mutation_completed.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .await;

        assert!(result.is_ok());
        assert!(completed.load(std::sync::atomic::Ordering::SeqCst));
        assert!(started.elapsed() >= std::time::Duration::from_millis(100));
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
        let secret = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(secret.as_deref(), "sk-test-secret-abcd");
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
            let secret = store.get_secret("openai", kind).await.unwrap();
            assert_stored_secret(secret.as_deref(), value);
        }
    }

    #[tokio::test]
    async fn file_secret_store_put_if_absent_creates_and_preserves_existing() {
        let store = FileSecretStore::new(temp_dir());
        assert!(store
            .put_secret_if_absent(
                "openai-local",
                SecretKind::ApiKey,
                "sk-if-absent-first-secret-abcd",
            )
            .await
            .unwrap());
        assert!(!store
            .put_secret_if_absent(
                "openai-local",
                SecretKind::ApiKey,
                "sk-if-absent-second-secret-wxyz",
            )
            .await
            .unwrap());
        let secret = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap();
        assert_stored_secret(secret.as_deref(), "sk-if-absent-first-secret-abcd");
    }

    #[tokio::test]
    async fn file_secret_store_put_if_absent_concurrent_single_winner() {
        let store = FileSecretStore::new(temp_dir());
        let first = store.clone();
        let second = store.clone();
        let (first_result, second_result) = tokio::join!(
            first.put_secret_if_absent(
                "openai-local",
                SecretKind::ApiKey,
                "sk-if-absent-race-first-abcd",
            ),
            second.put_secret_if_absent(
                "openai-local",
                SecretKind::ApiKey,
                "sk-if-absent-race-second-wxyz",
            ),
        );
        let results = [first_result.unwrap(), second_result.unwrap()];
        assert_eq!(results.iter().filter(|created| **created).count(), 1);
        let secret = store
            .get_secret("openai-local", SecretKind::ApiKey)
            .await
            .unwrap()
            .unwrap();
        assert_secret_is_one_of(
            &secret,
            &[
                "sk-if-absent-race-first-abcd",
                "sk-if-absent-race-second-wxyz",
            ],
        );
    }

    #[tokio::test]
    async fn file_secret_store_put_if_absent_rejects_unsafe_provider_ids() {
        let store = FileSecretStore::new(temp_dir());
        assert!(matches!(
            store
                .put_secret_if_absent("../openai", SecretKind::ApiKey, "sk-unsafe-secret-abcd")
                .await,
            Err(SecretStoreError::InvalidProviderId)
        ));
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
    async fn file_secret_store_put_if_absent_rejects_provider_directory_symlink_escape() {
        let dir = temp_dir();
        let outside = temp_dir();
        let store = FileSecretStore::new(&dir);
        std::fs::create_dir_all(&outside).unwrap();
        let root = dir.join("provider-secrets");
        std::fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("openai-local")).unwrap();

        assert!(matches!(
            store
                .put_secret_if_absent("openai-local", SecretKind::ApiKey, "sk-symlink-secret-abcd")
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
    async fn no_follow_file_read_rejects_final_symlink() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("target.json");
        std::fs::write(
            &target,
            r#"{"kind":"api_key","value":"sk-target-secret-abcd"}"#,
        )
        .unwrap();
        let link = dir.join("link.json");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert!(matches!(
            super::read_secret_file(&link).await,
            Err(SecretStoreError::Storage)
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn no_follow_directory_permissions_reject_final_symlink() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let link = dir.join("provider-link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();

        assert!(matches!(
            super::set_private_directory_permissions(&link).await,
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

    #[cfg(unix)]
    #[test]
    fn directory_sync_unsupported_errors_are_tolerated() {
        for kind in [
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::Unsupported,
            std::io::ErrorKind::InvalidInput,
        ] {
            let error = std::io::Error::from(kind);
            assert!(super::is_unsupported_directory_sync_error(&error));
        }
        let error = std::io::Error::from_raw_os_error(22);
        assert!(super::is_unsupported_directory_sync_error(&error));
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

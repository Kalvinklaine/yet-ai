use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::secret_store::{
    redact_secret, FileSecretStore, ProviderSecretStore, SecretKind, SecretStoreError,
};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
    Ollama,
    Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    None,
    ApiKey,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProviderConfig {
    pub id: String,
    pub kind: ProviderKind,
    pub display_name: String,
    pub enabled: bool,
    pub base_url: String,
    pub auth: StoredAuthConfig,
    #[serde(default)]
    pub models: Vec<ModelSummary>,
    #[serde(default)]
    pub capabilities: ProviderCapabilities,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAuthConfig {
    #[serde(rename = "type")]
    pub auth_type: AuthType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRegistrySummary {
    pub providers: Vec<ProviderSummary>,
    pub cloud_required: bool,
    pub provider_access: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub id: String,
    pub kind: ProviderKind,
    pub display_name: String,
    pub enabled: bool,
    pub base_url: String,
    pub auth: ProviderAuthSummary,
    pub models: Vec<ModelSummary>,
    pub capabilities: ProviderCapabilities,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthSummary {
    #[serde(rename = "type")]
    pub auth_type: AuthType,
    pub configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redacted: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResponse {
    pub models: Vec<ModelSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummary {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub chat: bool,
    pub completion: bool,
    pub embeddings: bool,
}

impl Default for ProviderCapabilities {
    fn default() -> Self {
        Self {
            chat: true,
            completion: false,
            embeddings: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWriteRequest {
    pub id: Option<String>,
    pub kind: Option<ProviderKind>,
    pub display_name: Option<String>,
    pub enabled: Option<bool>,
    pub base_url: Option<String>,
    pub auth: Option<AuthWriteRequest>,
    pub models: Option<Vec<ModelSummary>>,
    pub capabilities: Option<ProviderCapabilities>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthWriteRequest {
    #[serde(rename = "type")]
    pub auth_type: AuthType,
    pub api_key: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResponse {
    pub ok: bool,
    pub provider_id: String,
    pub status: ProviderTestStatus,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub cloud_required: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderTestStatus {
    Reachable,
    UnsupportedKind,
    MissingSecret,
    MissingModel,
    BadUrl,
    Unauthorized,
    Timeout,
    Unreachable,
    UpstreamError,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("invalid provider id")]
    InvalidId,
    #[error("provider id is required")]
    MissingId,
    #[error("provider kind is required")]
    MissingKind,
    #[error("display name is required")]
    MissingDisplayName,
    #[error("baseUrl is required for this provider kind")]
    MissingBaseUrl,
    #[error("invalid provider baseUrl")]
    InvalidBaseUrl,
    #[error("provider not found")]
    NotFound,
    #[error("provider already exists")]
    AlreadyExists,
    #[error("invalid provider config")]
    InvalidConfig,
    #[error("provider storage error")]
    Storage,
    #[error("provider secret storage error")]
    SecretStorage,
}

impl ProviderError {
    pub fn status(&self) -> http::StatusCode {
        match self {
            Self::NotFound => http::StatusCode::NOT_FOUND,
            Self::AlreadyExists => http::StatusCode::CONFLICT,
            Self::Storage | Self::SecretStorage => http::StatusCode::INTERNAL_SERVER_ERROR,
            Self::InvalidId
            | Self::MissingId
            | Self::MissingKind
            | Self::MissingDisplayName
            | Self::MissingBaseUrl
            | Self::InvalidBaseUrl
            | Self::InvalidConfig => http::StatusCode::BAD_REQUEST,
        }
    }
}

impl From<SecretStoreError> for ProviderError {
    fn from(error: SecretStoreError) -> Self {
        match error {
            SecretStoreError::InvalidProviderId => Self::InvalidId,
            SecretStoreError::Storage | SecretStoreError::InvalidRecord => Self::SecretStorage,
        }
    }
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::OpenAiCompatible => "openai-compatible",
            Self::Ollama => "ollama",
            Self::Custom => "custom",
        };
        formatter.write_str(value)
    }
}

impl StoredProviderConfig {
    pub fn summary(&self) -> ProviderSummary {
        ProviderSummary {
            id: self.id.clone(),
            kind: self.kind.clone(),
            display_name: self.display_name.clone(),
            enabled: self.enabled,
            base_url: self.base_url.clone(),
            auth: self.auth.summary(),
            models: self.models.clone(),
            capabilities: self.capabilities.clone(),
        }
    }

    fn summary_with_secret(&self, api_key: Option<&str>) -> ProviderSummary {
        ProviderSummary {
            id: self.id.clone(),
            kind: self.kind.clone(),
            display_name: self.display_name.clone(),
            enabled: self.enabled,
            base_url: self.base_url.clone(),
            auth: self.auth.summary_with_secret(api_key),
            models: self.models.clone(),
            capabilities: self.capabilities.clone(),
        }
    }
}

impl StoredAuthConfig {
    fn summary(&self) -> ProviderAuthSummary {
        self.summary_with_secret(self.api_key.as_deref())
    }

    fn summary_with_secret(&self, api_key: Option<&str>) -> ProviderAuthSummary {
        let configured =
            self.auth_type == AuthType::ApiKey && api_key.is_some_and(|value| !value.is_empty());
        ProviderAuthSummary {
            auth_type: self.auth_type.clone(),
            configured,
            redacted: api_key.filter(|_| configured).map(redact_secret),
        }
    }
}

pub fn validate_provider_id(id: &str) -> Result<(), ProviderError> {
    if id.is_empty() || id.len() > 64 {
        return Err(ProviderError::InvalidId);
    }
    if !id.as_bytes()[0].is_ascii_alphanumeric() {
        return Err(ProviderError::InvalidId);
    }
    if id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        Ok(())
    } else {
        Err(ProviderError::InvalidId)
    }
}

pub fn providers_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("providers.d")
}

pub fn provider_config_path(config_dir: &Path, id: &str) -> Result<PathBuf, ProviderError> {
    validate_provider_id(id)?;
    Ok(providers_dir(config_dir).join(format!("{id}.json")))
}

pub async fn list_provider_configs(
    config_dir: &Path,
) -> Result<Vec<StoredProviderConfig>, ProviderError> {
    let dir = providers_dir(config_dir);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(ProviderError::Storage),
    };
    let mut providers = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|_| ProviderError::Storage)?
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|_| ProviderError::Storage)?;
        let config: StoredProviderConfig =
            serde_json::from_str(&content).map_err(|_| ProviderError::InvalidConfig)?;
        validate_config(&config)?;
        providers.push(config);
    }
    providers.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(providers)
}

pub async fn get_provider_config(
    config_dir: &Path,
    id: &str,
) -> Result<StoredProviderConfig, ProviderError> {
    let path = provider_config_path(config_dir, id)?;
    let content = match tokio::fs::read_to_string(path).await {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ProviderError::NotFound);
        }
        Err(_) => return Err(ProviderError::Storage),
    };
    let config: StoredProviderConfig =
        serde_json::from_str(&content).map_err(|_| ProviderError::InvalidConfig)?;
    validate_config(&config)?;
    Ok(config)
}

pub async fn get_provider_config_with_secrets(
    config_dir: &Path,
    id: &str,
) -> Result<StoredProviderConfig, ProviderError> {
    let mut config = get_provider_config(config_dir, id).await?;
    hydrate_provider_secret(config_dir, &mut config).await?;
    Ok(config)
}

pub async fn provider_summary(
    config_dir: &Path,
    id: &str,
) -> Result<ProviderSummary, ProviderError> {
    let config = get_provider_config(config_dir, id).await?;
    summary_for_config(config_dir, &config).await
}

pub async fn create_provider_config(
    config_dir: &Path,
    request: ProviderWriteRequest,
) -> Result<StoredProviderConfig, ProviderError> {
    let id = clean_required(request.id, ProviderError::MissingId)?;
    validate_provider_id(&id)?;
    let path = provider_config_path(config_dir, &id)?;
    match tokio::fs::metadata(&path).await {
        Ok(_) => return Err(ProviderError::AlreadyExists),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(ProviderError::Storage),
    }
    let kind = request.kind.ok_or(ProviderError::MissingKind)?;
    let config = StoredProviderConfig {
        id,
        kind: kind.clone(),
        display_name: clean_required(request.display_name, ProviderError::MissingDisplayName)?,
        enabled: request.enabled.unwrap_or(true),
        base_url: normalize_base_url(kind, request.base_url)?,
        auth: normalize_auth(request.auth),
        models: request.models.unwrap_or_default(),
        capabilities: request.capabilities.unwrap_or_default(),
    };
    validate_config(&config)?;
    let (config, secret_change) = prepare_config_secrets(config);
    create_provider_config_file(&path, &config).await?;
    if let Err(error) = commit_secret_change(config_dir, &config.id, secret_change).await {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(error);
    }
    get_provider_config_with_secrets(config_dir, &config.id).await
}

pub async fn update_provider_config(
    config_dir: &Path,
    id: &str,
    request: ProviderWriteRequest,
) -> Result<StoredProviderConfig, ProviderError> {
    validate_provider_id(id)?;
    if let Some(request_id) = request.id.as_deref() {
        if request_id != id {
            return Err(ProviderError::InvalidId);
        }
    }
    let mut config = get_provider_config_with_secrets(config_dir, id).await?;
    if let Some(kind) = request.kind {
        config.kind = kind;
    }
    if let Some(display_name) = request.display_name {
        config.display_name = clean(display_name).ok_or(ProviderError::MissingDisplayName)?;
    }
    if let Some(enabled) = request.enabled {
        config.enabled = enabled;
    }
    if request.base_url.is_some() || config.kind == ProviderKind::Ollama {
        config.base_url = normalize_base_url(
            config.kind.clone(),
            request.base_url.or(Some(config.base_url)),
        )?;
    }
    if let Some(auth) = request.auth {
        config.auth = merge_auth(config.auth, auth);
    }
    if let Some(models) = request.models {
        config.models = models;
    }
    if let Some(capabilities) = request.capabilities {
        config.capabilities = capabilities;
    }
    validate_config(&config)?;
    let (config, secret_change) = prepare_config_secrets(config);
    let previous_secret = FileSecretStore::new(config_dir)
        .get_secret(id, SecretKind::ApiKey)
        .await?;
    let path = provider_config_path(config_dir, id)?;
    write_provider_config(&path, &config).await?;
    if let Err(error) = commit_secret_change(config_dir, id, secret_change).await {
        rollback_secret(config_dir, id, previous_secret).await?;
        return Err(error);
    }
    get_provider_config_with_secrets(config_dir, id).await
}

pub async fn delete_provider_config(config_dir: &Path, id: &str) -> Result<(), ProviderError> {
    let path = provider_config_path(config_dir, id)?;
    match tokio::fs::remove_file(path).await {
        Ok(()) => {
            FileSecretStore::new(config_dir)
                .delete_secret(id, SecretKind::ApiKey)
                .await?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(ProviderError::NotFound),
        Err(_) => Err(ProviderError::Storage),
    }
}

pub async fn registry(config_dir: &Path) -> Result<ProviderRegistrySummary, ProviderError> {
    Ok(ProviderRegistrySummary {
        providers: provider_summaries(config_dir).await?,
        cloud_required: false,
        provider_access: "direct".to_string(),
    })
}

pub async fn provider_summaries(config_dir: &Path) -> Result<Vec<ProviderSummary>, ProviderError> {
    let mut summaries = Vec::new();
    for provider in list_provider_configs(config_dir).await? {
        summaries.push(summary_for_config(config_dir, &provider).await?);
    }
    Ok(summaries)
}

pub async fn models(config_dir: &Path) -> Result<ModelListResponse, ProviderError> {
    let models = list_provider_configs(config_dir)
        .await?
        .into_iter()
        .filter(|provider| provider.enabled)
        .flat_map(|provider| {
            provider.models.into_iter().map(move |mut model| {
                model.provider_id = Some(provider.id.clone());
                model
            })
        })
        .collect();
    Ok(ModelListResponse { models })
}

pub async fn test_provider(
    config_dir: &Path,
    id: &str,
) -> Result<ProviderTestResponse, ProviderError> {
    let provider = get_provider_config_with_secrets(config_dir, id).await?;
    Ok(match provider.kind {
        ProviderKind::OpenAiCompatible => test_openai_compatible_provider(&provider).await,
        ProviderKind::Ollama | ProviderKind::Custom => ProviderTestResponse {
            ok: false,
            provider_id: provider.id,
            status: ProviderTestStatus::UnsupportedKind,
            message:
                "Provider reachability test is currently available for OpenAI-compatible providers."
                    .to_string(),
            model_id: None,
            cloud_required: false,
        },
    })
}

async fn test_openai_compatible_provider(provider: &StoredProviderConfig) -> ProviderTestResponse {
    let Some(model) = provider.models.first() else {
        return provider_test_response(
            provider,
            false,
            ProviderTestStatus::MissingModel,
            "Provider has no configured model.",
            None,
        );
    };
    if provider.auth.auth_type == AuthType::ApiKey
        && provider
            .auth
            .api_key
            .as_deref()
            .is_none_or(|value| value.is_empty())
    {
        return provider_test_response(
            provider,
            false,
            ProviderTestStatus::MissingSecret,
            "Provider API key is not configured.",
            Some(model.id.clone()),
        );
    }
    let Ok(url) = models_url(&provider.base_url) else {
        return provider_test_response(
            provider,
            false,
            ProviderTestStatus::BadUrl,
            "Provider base URL is invalid.",
            Some(model.id.clone()),
        );
    };
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return provider_test_response(
                provider,
                false,
                ProviderTestStatus::Unreachable,
                "Provider test client could not be initialized.",
                Some(model.id.clone()),
            )
        }
    };
    let mut request = client.get(url);
    if provider.auth.auth_type == AuthType::ApiKey {
        if let Some(api_key) = provider.auth.api_key.as_deref() {
            request = request.bearer_auth(api_key);
        }
    }
    match request.send().await {
        Ok(response) if response.status().is_success() => provider_test_response(
            provider,
            true,
            ProviderTestStatus::Reachable,
            "Provider is reachable and accepted the configured credentials.",
            Some(model.id.clone()),
        ),
        Ok(response)
            if response.status() == reqwest::StatusCode::UNAUTHORIZED
                || response.status() == reqwest::StatusCode::FORBIDDEN =>
        {
            provider_test_response(
                provider,
                false,
                ProviderTestStatus::Unauthorized,
                "Provider authentication failed. Check the configured credentials.",
                Some(model.id.clone()),
            )
        }
        Ok(_) => provider_test_response(
            provider,
            false,
            ProviderTestStatus::UpstreamError,
            "Provider returned an error during the reachability check.",
            Some(model.id.clone()),
        ),
        Err(error) if error.is_timeout() => provider_test_response(
            provider,
            false,
            ProviderTestStatus::Timeout,
            "Provider reachability check timed out.",
            Some(model.id.clone()),
        ),
        Err(_) => provider_test_response(
            provider,
            false,
            ProviderTestStatus::Unreachable,
            "Provider could not be reached.",
            Some(model.id.clone()),
        ),
    }
}

fn provider_test_response(
    provider: &StoredProviderConfig,
    ok: bool,
    status: ProviderTestStatus,
    message: &str,
    model_id: Option<String>,
) -> ProviderTestResponse {
    ProviderTestResponse {
        ok,
        provider_id: provider.id.clone(),
        status,
        message: message.to_string(),
        model_id,
        cloud_required: false,
    }
}

fn models_url(base_url: &str) -> Result<String, ProviderError> {
    validate_provider_base_url(base_url)?;
    let mut url = reqwest::Url::parse(base_url).map_err(|_| ProviderError::InvalidBaseUrl)?;
    let mut normalized_path = url.path().trim_end_matches('/').to_string();
    for suffix in ["/v1/chat/completions", "/chat/completions"] {
        if normalized_path.ends_with(suffix) {
            normalized_path.truncate(normalized_path.len() - suffix.len());
            break;
        }
    }
    if normalized_path.ends_with("/models") {
        url.set_path(&normalized_path);
    } else {
        url.set_path(&format!("{normalized_path}/models"));
    }
    Ok(url.to_string())
}

async fn summary_for_config(
    config_dir: &Path,
    config: &StoredProviderConfig,
) -> Result<ProviderSummary, ProviderError> {
    let secret = configured_api_key(config_dir, config).await?;
    Ok(config.summary_with_secret(secret.as_deref()))
}

async fn hydrate_provider_secret(
    config_dir: &Path,
    config: &mut StoredProviderConfig,
) -> Result<(), ProviderError> {
    if config.auth.auth_type == AuthType::ApiKey {
        if let Some(secret) = configured_api_key(config_dir, config).await? {
            config.auth.api_key = Some(secret);
        }
    }
    Ok(())
}

async fn configured_api_key(
    config_dir: &Path,
    config: &StoredProviderConfig,
) -> Result<Option<String>, ProviderError> {
    if config.auth.auth_type != AuthType::ApiKey {
        return Ok(None);
    }
    let store = FileSecretStore::new(config_dir);
    match store.get_secret(&config.id, SecretKind::ApiKey).await {
        Ok(Some(secret)) => Ok(Some(secret)),
        Ok(None) => Ok(config.auth.api_key.clone()),
        Err(SecretStoreError::InvalidRecord) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

enum SecretChange {
    None,
    Put(String),
    Delete,
}

fn prepare_config_secrets(
    mut config: StoredProviderConfig,
) -> (StoredProviderConfig, SecretChange) {
    let secret_change = match config.auth.auth_type {
        AuthType::None => SecretChange::Delete,
        AuthType::ApiKey => config
            .auth
            .api_key
            .take()
            .filter(|value| !value.is_empty())
            .map_or(SecretChange::None, SecretChange::Put),
    };
    config.auth.api_key = None;
    (config, secret_change)
}

async fn commit_secret_change(
    config_dir: &Path,
    id: &str,
    secret_change: SecretChange,
) -> Result<(), ProviderError> {
    let store = FileSecretStore::new(config_dir);
    match secret_change {
        SecretChange::None => Ok(()),
        SecretChange::Put(api_key) => store
            .put_secret(id, SecretKind::ApiKey, &api_key)
            .await
            .map_err(Into::into),
        SecretChange::Delete => store
            .delete_secret(id, SecretKind::ApiKey)
            .await
            .map_err(Into::into),
    }
}

async fn rollback_secret(
    config_dir: &Path,
    id: &str,
    previous_secret: Option<String>,
) -> Result<(), ProviderError> {
    let store = FileSecretStore::new(config_dir);
    match previous_secret {
        Some(secret) => store.put_secret(id, SecretKind::ApiKey, &secret).await?,
        None => store.delete_secret(id, SecretKind::ApiKey).await?,
    }
    Ok(())
}

fn validate_config(config: &StoredProviderConfig) -> Result<(), ProviderError> {
    validate_provider_id(&config.id)?;
    if config.display_name.trim().is_empty() {
        return Err(ProviderError::MissingDisplayName);
    }
    validate_provider_base_url(&config.base_url)?;
    Ok(())
}

async fn write_provider_config(
    path: &Path,
    config: &StoredProviderConfig,
) -> Result<(), ProviderError> {
    write_temp_then(path, config, false).await?;
    set_private_permissions(path).await
}

async fn create_provider_config_file(
    path: &Path,
    config: &StoredProviderConfig,
) -> Result<(), ProviderError> {
    write_temp_then(path, config, true).await?;
    set_private_permissions(path).await
}

async fn write_temp_then(
    path: &Path,
    config: &StoredProviderConfig,
    create_new: bool,
) -> Result<(), ProviderError> {
    let dir = path.parent().ok_or(ProviderError::Storage)?;
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|_| ProviderError::Storage)?;
    let content = serde_json::to_vec_pretty(config).map_err(|_| ProviderError::Storage)?;
    let temp_path = temp_provider_config_path(path);
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
            .map_err(|_| ProviderError::Storage)?;
        file.write_all(&content)
            .await
            .map_err(|_| ProviderError::Storage)?;
        file.sync_all().await.map_err(|_| ProviderError::Storage)?;
        drop(file);
        set_private_permissions(&temp_path).await?;
        if create_new {
            match tokio::fs::hard_link(&temp_path, path).await {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    Err(ProviderError::AlreadyExists)
                }
                Err(_) => Err(ProviderError::Storage),
            }
        } else {
            tokio::fs::rename(&temp_path, path)
                .await
                .map_err(|_| ProviderError::Storage)
        }
    }
    .await;
    let cleanup = tokio::fs::remove_file(&temp_path).await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            if cleanup.is_err() {
                return Err(ProviderError::Storage);
            }
            Err(error)
        }
    }
}

fn temp_provider_config_path(path: &Path) -> PathBuf {
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("provider.json");
    path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        counter
    ))
}

#[cfg(unix)]
async fn set_private_permissions(path: &Path) -> Result<(), ProviderError> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .await
        .map_err(|_| ProviderError::Storage)
}

#[cfg(not(unix))]
async fn set_private_permissions(_path: &Path) -> Result<(), ProviderError> {
    Ok(())
}

fn normalize_base_url(
    kind: ProviderKind,
    base_url: Option<String>,
) -> Result<String, ProviderError> {
    let value = base_url.and_then(clean);
    let value = match (kind, value) {
        (ProviderKind::Ollama, None) => "http://127.0.0.1:11434".to_string(),
        (_, Some(value)) => value,
        _ => return Err(ProviderError::MissingBaseUrl),
    };
    validate_provider_base_url(&value)?;
    Ok(value.trim_end_matches('/').to_string())
}

pub fn validate_provider_base_url(base_url: &str) -> Result<(), ProviderError> {
    let url = reqwest::Url::parse(base_url).map_err(|_| ProviderError::InvalidBaseUrl)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ProviderError::InvalidBaseUrl);
    }
    if url.host().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(ProviderError::InvalidBaseUrl);
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(ProviderError::InvalidBaseUrl);
    }
    Ok(())
}

fn normalize_auth(auth: Option<AuthWriteRequest>) -> StoredAuthConfig {
    match auth {
        Some(auth) => StoredAuthConfig {
            auth_type: auth.auth_type,
            api_key: auth.api_key.and_then(clean),
        },
        None => StoredAuthConfig {
            auth_type: AuthType::None,
            api_key: None,
        },
    }
}

fn merge_auth(current: StoredAuthConfig, auth: AuthWriteRequest) -> StoredAuthConfig {
    match auth.auth_type {
        AuthType::None => StoredAuthConfig {
            auth_type: AuthType::None,
            api_key: None,
        },
        AuthType::ApiKey => StoredAuthConfig {
            auth_type: AuthType::ApiKey,
            api_key: auth.api_key.and_then(clean).or(current.api_key),
        },
    }
}

fn clean_required(value: Option<String>, error: ProviderError) -> Result<String, ProviderError> {
    value.and_then(clean).ok_or(error)
}

fn clean(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

pub fn empty_registry() -> ProviderRegistrySummary {
    ProviderRegistrySummary {
        providers: Vec::new(),
        cloud_required: false,
        provider_access: "direct".to_string(),
    }
}

pub fn empty_models() -> ModelListResponse {
    ModelListResponse { models: Vec::new() }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_base_url, validate_provider_base_url, validate_provider_id, ProviderError,
        ProviderKind,
    };

    #[test]
    fn provider_id_validation_rejects_unsafe_paths() {
        assert!(validate_provider_id("openai_local").is_ok());
        assert!(validate_provider_id("../secret").is_err());
        assert!(validate_provider_id("bad/id").is_err());
        assert!(validate_provider_id(".hidden").is_err());
    }

    #[test]
    fn provider_base_url_validation_accepts_http_endpoints() {
        assert!(validate_provider_base_url("http://127.0.0.1:8080/v1").is_ok());
        assert!(validate_provider_base_url("https://api.example.test/v1/").is_ok());
        assert!(validate_provider_base_url("http://localhost:11434").is_ok());
    }

    #[test]
    fn provider_base_url_validation_rejects_unsafe_values() {
        assert!(matches!(
            validate_provider_base_url("file:///tmp/socket"),
            Err(ProviderError::InvalidBaseUrl)
        ));
        assert!(matches!(
            validate_provider_base_url("http://user:pass@127.0.0.1:8080/v1"),
            Err(ProviderError::InvalidBaseUrl)
        ));
        assert!(matches!(
            validate_provider_base_url("https://example.test/v1?api_key=secret"),
            Err(ProviderError::InvalidBaseUrl)
        ));
        assert!(matches!(
            validate_provider_base_url("https://example.test/v1#token"),
            Err(ProviderError::InvalidBaseUrl)
        ));
        assert!(matches!(
            validate_provider_base_url("not a url"),
            Err(ProviderError::InvalidBaseUrl)
        ));
    }

    #[test]
    fn provider_base_url_normalization_trims_trailing_slashes() {
        assert_eq!(
            normalize_base_url(
                ProviderKind::OpenAiCompatible,
                Some(" http://127.0.0.1:8080/v1/ ".to_string())
            )
            .unwrap(),
            "http://127.0.0.1:8080/v1"
        );
    }

    #[test]
    fn redaction_keeps_only_small_signal() {
        assert_eq!(
            crate::secret_store::redact_secret("sk-test-secret-abcd"),
            "sk...cd"
        );
    }
}

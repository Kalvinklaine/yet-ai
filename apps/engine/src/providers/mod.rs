use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

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
    pub cloud_required: bool,
    pub message: String,
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
}

impl ProviderError {
    pub fn status(&self) -> http::StatusCode {
        match self {
            Self::NotFound => http::StatusCode::NOT_FOUND,
            Self::AlreadyExists => http::StatusCode::CONFLICT,
            Self::Storage => http::StatusCode::INTERNAL_SERVER_ERROR,
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
}

impl StoredAuthConfig {
    fn summary(&self) -> ProviderAuthSummary {
        let configured = self.auth_type == AuthType::ApiKey
            && self
                .api_key
                .as_deref()
                .is_some_and(|value| !value.is_empty());
        ProviderAuthSummary {
            auth_type: self.auth_type.clone(),
            configured,
            redacted: self
                .api_key
                .as_deref()
                .filter(|_| configured)
                .map(redact_secret),
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

pub async fn create_provider_config(
    config_dir: &Path,
    request: ProviderWriteRequest,
) -> Result<StoredProviderConfig, ProviderError> {
    let id = clean_required(request.id, ProviderError::MissingId)?;
    validate_provider_id(&id)?;
    let path = provider_config_path(config_dir, &id)?;
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
    create_provider_config_file(&path, &config).await?;
    Ok(config)
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
    let mut config = get_provider_config(config_dir, id).await?;
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
    let path = provider_config_path(config_dir, id)?;
    write_provider_config(&path, &config).await?;
    Ok(config)
}

pub async fn delete_provider_config(config_dir: &Path, id: &str) -> Result<(), ProviderError> {
    let path = provider_config_path(config_dir, id)?;
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(ProviderError::NotFound),
        Err(_) => Err(ProviderError::Storage),
    }
}

pub async fn registry(config_dir: &Path) -> Result<ProviderRegistrySummary, ProviderError> {
    Ok(ProviderRegistrySummary {
        providers: list_provider_configs(config_dir)
            .await?
            .into_iter()
            .map(|provider| provider.summary())
            .collect(),
        cloud_required: false,
        provider_access: "direct".to_string(),
    })
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

fn redact_secret(value: &str) -> String {
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
        normalize_base_url, redact_secret, validate_provider_base_url, validate_provider_id,
        ProviderError, ProviderKind,
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
        assert_eq!(redact_secret("sk-test-secret-abcd"), "sk--...abcd");
    }
}

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use base64::Engine;
use chrono::{Duration, Utc};
use futures_util::StreamExt;
use http::StatusCode;
use serde::de::{DeserializeOwned, Error as DeError};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::providers::{self, AuthType, ProviderKind, StoredProviderConfig};
use crate::secret_store::{
    provider_secret_store, ProviderSecretStore, SecretKind, SecretStoreError,
};

const LOGIN_UNAVAILABLE_MESSAGE: &str = "OpenAI account login is not available for this local provider path. Create an API key in the provider console and paste it once into Yet AI.";
const API_KEY_CONFIGURED_MESSAGE: &str = "API-key authentication is configured locally.";
const DISCONNECT_MESSAGE: &str = "Provider login credentials were disconnected and removed from local engine storage. API-key provider configuration was left unchanged.";
const MOCK_PENDING_MESSAGE: &str = "Mock OAuth login is pending in local test state.";
const MOCK_CONNECTED_MESSAGE: &str = "Mock OAuth login is connected in local test state.";
const MOCK_DISCONNECTED_MESSAGE: &str =
    "Mock OAuth login state was disconnected and removed from local test state.";
const CODEX_PENDING_MESSAGE: &str = "Experimental Codex-like OpenAI login is pending. This uses a private-endpoint-style OAuth contract and is not official public third-party OpenAI OAuth support.";
const MOCK_TTL_SECONDS: i64 = 600;
const CODEX_TTL_SECONDS: i64 = 600;
const MAX_PROVIDER_AUTH_TTL_SECONDS: i64 = 3600;
const CODEX_TOKEN_EXCHANGE_TIMEOUT_SECONDS: u64 = 2;
const CODEX_TOKEN_ERROR_BODY_LIMIT_BYTES: usize = 4096;
const CODEX_REFRESH_FILE_LOCK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const CODEX_REFRESH_FILE_LOCK_RETRY: std::time::Duration = std::time::Duration::from_millis(10);
const CODEX_TOKEN_REFRESH_SKEW_SECONDS: i64 = 60;
const CODEX_TOKEN_DEFAULT_EXPIRES_IN_SECONDS: i64 = 3600;
const MAX_CODEX_TOKEN_EXPIRES_IN_SECONDS: i64 = 86400;
const CODEX_AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_CHAT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const CODEX_CHAT_MODEL: &str = "gpt-5-codex";
const CODEX_CLIENT_ID: &str = "yet-ai-local-experimental";
const CODEX_REDIRECT_URI: &str = "http://127.0.0.1:1455/auth/openai/callback";
const CODEX_SCOPE: &str = "openid profile email offline_access";
const CODEX_CONNECTED_MESSAGE: &str = "Experimental Codex-like OpenAI login is connected in local engine storage. This remains experimental/high-risk and is not official public third-party OpenAI OAuth support.";
const CODEX_EXPIRED_MESSAGE: &str = "Experimental Codex-like OpenAI login expired. Reconnect the account or use the OpenAI API-key fallback.";
const PROVIDER_AUTH_SESSION_ID_MAX_CHARS: usize = 256;
const PROVIDER_AUTH_STATE_MAX_CHARS: usize = 512;
const PROVIDER_AUTH_CODE_MAX_CHARS: usize = 4096;
const PROVIDER_AUTH_URL_MAX_CHARS: usize = 2048;
const CODEX_SCOPE_MAX_TOKENS: usize = 32;
const CODEX_SCOPE_MAX_TOKEN_CHARS: usize = 128;
const CODEX_SCOPE_MAX_LIST_CHARS: usize = 1024;
const CODEX_CHAT_MODEL_MAX_CHARS: usize = 128;
const CODEX_ALLOWED_SCOPES: [&str; 4] = ["openid", "profile", "email", "offline_access"];
static MOCK_COUNTER: AtomicU64 = AtomicU64::new(1);
static PROVIDER_AUTH_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static CODEX_EXCHANGE_IN_FLIGHT: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
static CODEX_REFRESH_LOCKS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct CodexExchangeGuard {
    key: String,
}

impl Drop for CodexExchangeGuard {
    fn drop(&mut self) {
        if let Ok(mut keys) = CODEX_EXCHANGE_IN_FLIGHT.lock() {
            keys.remove(&self.key);
        }
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderAuthStartRequest {
    #[serde(default)]
    pub mock: bool,
    #[serde(default)]
    pub experimental_codex_like: bool,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub ttl_seconds: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub token_endpoint_url: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub chat_endpoint_url: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderAuthExchangeRequest {
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub session_id: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub state: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum NonNullField<T> {
    Value(T),
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    match Option::<NonNullField<T>>::deserialize(deserializer)? {
        Some(NonNullField::Value(value)) => Ok(Some(value)),
        None => Err(D::Error::custom("null is not allowed")),
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderAuthDisconnectRequest {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthResponse {
    pub provider: String,
    pub configured: bool,
    pub status: &'static str,
    pub auth_source: &'static str,
    pub supports_login: bool,
    pub supports_api_key: bool,
    pub cloud_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redacted: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll_interval_seconds: Option<u64>,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderAuthError {
    #[error("invalid provider id")]
    InvalidProvider,
    #[error("provider auth is not supported for this provider")]
    UnsupportedProvider,
    #[error("invalid provider auth request")]
    InvalidRequest,
    #[error("provider auth session was not found")]
    SessionNotFound,
    #[error("provider auth session expired")]
    SessionExpired,
    #[error("provider auth session mismatch")]
    SessionMismatch,
    #[error("provider storage error")]
    Provider(#[from] providers::ProviderError),
    #[error("provider auth storage error")]
    Storage,
    #[error("provider auth token exchange failed")]
    TokenExchange,
}

impl ProviderAuthError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::InvalidProvider | Self::InvalidRequest | Self::SessionMismatch => {
                StatusCode::BAD_REQUEST
            }
            Self::UnsupportedProvider | Self::SessionNotFound => StatusCode::NOT_FOUND,
            Self::SessionExpired => StatusCode::GONE,
            Self::Provider(error) => error.status(),
            Self::Storage => StatusCode::INTERNAL_SERVER_ERROR,
            Self::TokenExchange => StatusCode::BAD_GATEWAY,
        }
    }
}

impl From<SecretStoreError> for ProviderAuthError {
    fn from(_: SecretStoreError) -> Self {
        Self::Storage
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MockOAuthState {
    pending: Option<MockOAuthSession>,
    connected: Option<MockOAuthConnection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MockOAuthSession {
    provider: String,
    session_id: String,
    state: String,
    verifier: String,
    challenge: String,
    expires_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MockOAuthConnection {
    provider: String,
    account_label: String,
    scopes: Vec<String>,
    expires_at: String,
    access_token: String,
    refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CodexOAuthState {
    pending: Option<CodexOAuthSession>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexOAuthSession {
    provider: String,
    session_id: String,
    state: String,
    verifier: String,
    challenge: String,
    expires_at: String,
    scopes: Vec<String>,
    token_endpoint_url: String,
    chat_base_url: String,
    chat_model: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexAuthMetadata {
    provider: String,
    account_label: String,
    scopes: Vec<String>,
    expires_at: String,
    redacted: String,
    #[serde(default = "default_codex_chat_base_url")]
    chat_base_url: String,
    #[serde(default = "default_codex_chat_model")]
    chat_model: String,
    #[serde(default = "default_codex_token_url")]
    token_endpoint_url: String,
}

#[derive(Debug, Clone)]
pub struct ExperimentalCodexChatAuth {
    pub access_token: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct CodexTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    account_label: Option<String>,
}

#[derive(Debug)]
enum CodexTokenEndpointError {
    Failed,
    RefreshTokenReused,
}

impl From<CodexTokenEndpointError> for ProviderAuthError {
    fn from(_: CodexTokenEndpointError) -> Self {
        ProviderAuthError::TokenExchange
    }
}

pub async fn status(
    config_dir: &Path,
    provider: &str,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let provider = normalize_supported_provider(provider)?;
    if provider == "openai" {
        let codex = read_codex_state(config_dir, provider).await?;
        if let Some(session) = codex.pending {
            if parse_time(&session.expires_at)? > Utc::now() {
                return Ok(codex_pending_response(provider, &session, None));
            }
        }
        if let Some(response) = codex_connected_status(config_dir, provider).await? {
            return Ok(response);
        }
    }
    let mock = read_mock_state(config_dir, provider).await?;
    if let Some(session) = mock.pending {
        if parse_time(&session.expires_at)? > Utc::now() {
            return Ok(mock_pending_response(provider, &session, None));
        }
    }
    if let Some(connection) = mock.connected {
        if parse_time(&connection.expires_at)? > Utc::now() {
            return Ok(mock_connected_response(
                provider,
                connection.scopes,
                Some(true),
            ));
        }
    }
    Ok(status_response(
        provider,
        configured_api_key(config_dir, provider).await?,
        None,
    ))
}

pub async fn start(
    config_dir: &Path,
    provider: &str,
    request: ProviderAuthStartRequest,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let provider = normalize_supported_provider(provider)?;
    validate_start_request(provider, &request)?;
    if request.mock {
        reject_mock_codex_coexistence(config_dir, provider).await?;
        let ttl_seconds = validate_ttl_seconds(request.ttl_seconds.unwrap_or(MOCK_TTL_SECONDS))?;
        let session = new_mock_session(provider, ttl_seconds);
        let state = MockOAuthState {
            pending: Some(session.clone()),
            connected: None,
        };
        write_mock_state(config_dir, provider, &state).await?;
        return Ok(mock_pending_response(provider, &session, Some(true)));
    }
    if request.experimental_codex_like && provider == "openai" {
        reject_codex_mock_coexistence(config_dir, provider).await?;
        reject_existing_codex_auth_state(config_dir, provider).await?;
        let session = new_codex_session(
            request.ttl_seconds.unwrap_or(CODEX_TTL_SECONDS),
            request.token_endpoint_url.as_deref(),
            request.chat_endpoint_url.as_deref(),
        )?;
        write_codex_state(
            config_dir,
            provider,
            &CodexOAuthState {
                pending: Some(session.clone()),
            },
        )
        .await?;
        return Ok(codex_pending_response(provider, &session, Some(true)));
    }
    Ok(status_response(
        provider,
        configured_api_key(config_dir, provider).await?,
        Some(false),
    ))
}

fn validate_start_request(
    provider: &str,
    request: &ProviderAuthStartRequest,
) -> Result<(), ProviderAuthError> {
    if request.mock && request.experimental_codex_like {
        return Err(ProviderAuthError::InvalidRequest);
    }
    if request.experimental_codex_like && provider != "openai" {
        return Err(ProviderAuthError::InvalidRequest);
    }
    if request.ttl_seconds.is_some() && !request.mock && !request.experimental_codex_like {
        return Err(ProviderAuthError::InvalidRequest);
    }
    if request.token_endpoint_url.is_some() || request.chat_endpoint_url.is_some() {
        if request.mock || !request.experimental_codex_like || provider != "openai" {
            return Err(ProviderAuthError::InvalidRequest);
        }
        if let Some(value) = request.token_endpoint_url.as_deref() {
            validate_experimental_endpoint_url(value, true)?;
        }
        if let Some(value) = request.chat_endpoint_url.as_deref() {
            validate_experimental_endpoint_url(value, true)?;
        }
    }
    Ok(())
}

pub async fn exchange(
    config_dir: &Path,
    provider: &str,
    request: ProviderAuthExchangeRequest,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let provider = normalize_supported_provider(provider)?;
    if request.session_id.is_none() && request.state.is_none() && request.code.is_none() {
        let mut response = status(config_dir, provider).await?;
        response.success = Some(false);
        return Ok(response);
    }
    let session_id = required_value(request.session_id, PROVIDER_AUTH_SESSION_ID_MAX_CHARS)?;
    let state_value = required_value(request.state, PROVIDER_AUTH_STATE_MAX_CHARS)?;
    let code = required_value(request.code, PROVIDER_AUTH_CODE_MAX_CHARS)?;
    if provider == "openai" && !code.starts_with("mock-code-") {
        return codex_exchange(config_dir, provider, session_id, state_value, code).await;
    }
    if !code.starts_with("mock-code-") {
        return Err(ProviderAuthError::InvalidRequest);
    }

    let mut mock = read_mock_state(config_dir, provider).await?;
    let Some(session) = mock.pending.take() else {
        return Err(ProviderAuthError::SessionNotFound);
    };
    if session.provider != provider
        || session.session_id != session_id
        || session.state != state_value
    {
        mock.pending = Some(session);
        write_mock_state(config_dir, provider, &mock).await?;
        return Err(ProviderAuthError::SessionMismatch);
    }
    if parse_time(&session.expires_at)? <= Utc::now() {
        write_mock_state(config_dir, provider, &mock).await?;
        return Err(ProviderAuthError::SessionExpired);
    }
    if provider == "openai" && codex_auth_state_exists(config_dir, provider).await? {
        write_mock_state(config_dir, provider, &MockOAuthState::default()).await?;
        return Err(ProviderAuthError::InvalidRequest);
    }

    let scopes = vec!["mock:chat".to_string(), "mock:profile".to_string()];
    let connection = MockOAuthConnection {
        provider: provider.to_string(),
        account_label: "Mock OAuth Account".to_string(),
        scopes: scopes.clone(),
        expires_at: (Utc::now() + Duration::hours(1)).to_rfc3339(),
        access_token: format!("fake-access-token-{session_id}"),
        refresh_token: format!("fake-refresh-token-{state_value}"),
    };
    mock.connected = Some(connection);
    write_mock_state(config_dir, provider, &mock).await?;
    Ok(mock_connected_response(provider, scopes, Some(true)))
}

pub async fn disconnect(
    config_dir: &Path,
    provider: &str,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let provider = normalize_supported_provider(provider)?;
    let mock = read_mock_state(config_dir, provider).await?;
    let had_mock = mock.pending.is_some() || mock.connected.is_some();
    if had_mock {
        write_mock_state(config_dir, provider, &MockOAuthState::default()).await?;
    }

    let mut had_codex = false;
    if provider == "openai" {
        let codex = read_codex_state(config_dir, provider).await?;
        had_codex = codex.pending.is_some() || codex_has_secrets(config_dir, provider).await?;
        if had_codex {
            write_codex_state(config_dir, provider, &CodexOAuthState::default()).await?;
            delete_codex_secrets(config_dir, provider).await?;
        }
    }

    let configured = configured_api_key(config_dir, provider).await?;
    let mut response = status_response(provider, configured, Some(true));
    if had_mock || had_codex {
        if !response.configured {
            response.status = "revoked";
        }
        response.message = if had_codex {
            DISCONNECT_MESSAGE.to_string()
        } else {
            MOCK_DISCONNECTED_MESSAGE.to_string()
        };
    } else if response.configured {
        response.message = DISCONNECT_MESSAGE.to_string();
    } else {
        response.status = "revoked";
        response.message = DISCONNECT_MESSAGE.to_string();
    }
    Ok(response)
}

fn normalize_supported_provider(provider: &str) -> Result<&str, ProviderAuthError> {
    providers::validate_provider_id(provider).map_err(|_| ProviderAuthError::InvalidProvider)?;
    match provider {
        "openai" | "openai-compatible" => Ok(provider),
        _ => Err(ProviderAuthError::UnsupportedProvider),
    }
}

async fn configured_api_key(
    config_dir: &Path,
    provider: &str,
) -> Result<Option<String>, ProviderAuthError> {
    let providers = providers::list_provider_configs(config_dir).await?;
    for stored in providers
        .into_iter()
        .filter(|stored| supports_provider_config(stored, provider))
    {
        let summary = providers::provider_summary(config_dir, &stored.id).await?;
        if summary.auth.auth_type == AuthType::ApiKey && summary.auth.configured {
            return Ok(summary.auth.redacted);
        }
    }
    Ok(None)
}

fn supports_provider_config(config: &StoredProviderConfig, provider: &str) -> bool {
    match provider {
        "openai" => config.id == "openai" || config.id == "openai-api",
        "openai-compatible" => config.kind == ProviderKind::OpenAiCompatible,
        _ => false,
    }
}

fn status_response(
    provider: &str,
    redacted: Option<String>,
    success: Option<bool>,
) -> ProviderAuthResponse {
    match redacted {
        Some(redacted) => ProviderAuthResponse {
            provider: provider.to_string(),
            configured: true,
            status: "api_key_configured",
            auth_source: "api_key",
            supports_login: false,
            supports_api_key: true,
            cloud_required: false,
            success,
            account_label: None,
            redacted: Some(redacted),
            authorization_url: None,
            verification_url: None,
            session_id: None,
            expires_at: None,
            scopes: None,
            poll_interval_seconds: None,
            message: API_KEY_CONFIGURED_MESSAGE.to_string(),
        },
        None => ProviderAuthResponse {
            provider: provider.to_string(),
            configured: false,
            status: "login_unavailable",
            auth_source: "none",
            supports_login: false,
            supports_api_key: true,
            cloud_required: false,
            success,
            account_label: None,
            redacted: None,
            authorization_url: None,
            verification_url: None,
            session_id: None,
            expires_at: None,
            scopes: None,
            poll_interval_seconds: None,
            message: LOGIN_UNAVAILABLE_MESSAGE.to_string(),
        },
    }
}

fn mock_pending_response(
    provider: &str,
    session: &MockOAuthSession,
    success: Option<bool>,
) -> ProviderAuthResponse {
    ProviderAuthResponse {
        provider: provider.to_string(),
        configured: false,
        status: "pending",
        auth_source: "oauth",
        supports_login: true,
        supports_api_key: true,
        cloud_required: false,
        success,
        account_label: None,
        redacted: None,
        authorization_url: Some(format!(
            "http://127.0.0.1/mock-oauth/authorize?provider={provider}&state={}&code_challenge={}",
            session.state, session.challenge
        )),
        verification_url: Some("http://127.0.0.1/mock-oauth/verify".to_string()),
        session_id: Some(session.session_id.clone()),
        expires_at: Some(session.expires_at.clone()),
        scopes: Some(vec!["mock:chat".to_string(), "mock:profile".to_string()]),
        poll_interval_seconds: Some(1),
        message: MOCK_PENDING_MESSAGE.to_string(),
    }
}

fn mock_connected_response(
    provider: &str,
    scopes: Vec<String>,
    success: Option<bool>,
) -> ProviderAuthResponse {
    ProviderAuthResponse {
        provider: provider.to_string(),
        configured: true,
        status: "connected",
        auth_source: "oauth",
        supports_login: true,
        supports_api_key: true,
        cloud_required: false,
        success,
        account_label: Some("Mock OAuth Account".to_string()),
        redacted: Some("mock-oauth-...connected".to_string()),
        authorization_url: None,
        verification_url: None,
        session_id: None,
        expires_at: Some((Utc::now() + Duration::hours(1)).to_rfc3339()),
        scopes: Some(scopes),
        poll_interval_seconds: None,
        message: MOCK_CONNECTED_MESSAGE.to_string(),
    }
}

fn codex_pending_response(
    provider: &str,
    session: &CodexOAuthSession,
    success: Option<bool>,
) -> ProviderAuthResponse {
    ProviderAuthResponse {
        provider: provider.to_string(),
        configured: false,
        status: "pending",
        auth_source: "oauth",
        supports_login: true,
        supports_api_key: true,
        cloud_required: false,
        success,
        account_label: None,
        redacted: None,
        authorization_url: Some(codex_authorization_url(session)),
        verification_url: None,
        session_id: Some(session.session_id.clone()),
        expires_at: Some(session.expires_at.clone()),
        scopes: Some(session.scopes.clone()),
        poll_interval_seconds: Some(3),
        message: CODEX_PENDING_MESSAGE.to_string(),
    }
}

fn new_mock_session(provider: &str, ttl_seconds: i64) -> MockOAuthSession {
    let id = MOCK_COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = Utc::now();
    let session_id = format!("mock-session-{id}");
    let state = format!("mock-state-{id}");
    let verifier = format!("mock-verifier-{provider}-{id}");
    let challenge = verifier.chars().rev().collect::<String>();
    MockOAuthSession {
        provider: provider.to_string(),
        session_id,
        state,
        verifier,
        challenge,
        expires_at: (now + Duration::seconds(ttl_seconds)).to_rfc3339(),
    }
}

fn codex_connected_response(
    provider: &str,
    metadata: CodexAuthMetadata,
    success: Option<bool>,
) -> ProviderAuthResponse {
    ProviderAuthResponse {
        provider: provider.to_string(),
        configured: true,
        status: "connected",
        auth_source: "oauth",
        supports_login: true,
        supports_api_key: true,
        cloud_required: false,
        success,
        account_label: Some(metadata.account_label),
        redacted: Some(metadata.redacted),
        authorization_url: None,
        verification_url: None,
        session_id: None,
        expires_at: Some(metadata.expires_at),
        scopes: Some(metadata.scopes),
        poll_interval_seconds: None,
        message: CODEX_CONNECTED_MESSAGE.to_string(),
    }
}

fn codex_expired_response(provider: &str, metadata: CodexAuthMetadata) -> ProviderAuthResponse {
    ProviderAuthResponse {
        provider: provider.to_string(),
        configured: false,
        status: "expired",
        auth_source: "oauth",
        supports_login: true,
        supports_api_key: true,
        cloud_required: false,
        success: None,
        account_label: Some(metadata.account_label),
        redacted: Some(metadata.redacted),
        authorization_url: None,
        verification_url: None,
        session_id: None,
        expires_at: Some(metadata.expires_at),
        scopes: Some(metadata.scopes),
        poll_interval_seconds: None,
        message: CODEX_EXPIRED_MESSAGE.to_string(),
    }
}

fn new_codex_session(
    ttl_seconds: i64,
    token_endpoint_url: Option<&str>,
    chat_endpoint_url: Option<&str>,
) -> Result<CodexOAuthSession, ProviderAuthError> {
    let ttl_seconds = validate_ttl_seconds(ttl_seconds)?;
    let token_endpoint_url = experimental_endpoint_url(token_endpoint_url, CODEX_TOKEN_URL)?;
    let chat_base_url = experimental_endpoint_url(chat_endpoint_url, CODEX_CHAT_BASE_URL)?;
    let verifier = random_url_safe(64)?;
    let challenge = pkce_challenge(&verifier);
    Ok(CodexOAuthSession {
        provider: "openai".to_string(),
        session_id: format!("codex-{}", random_url_safe(32)?),
        state: random_url_safe(32)?,
        verifier,
        challenge,
        expires_at: (Utc::now() + Duration::seconds(ttl_seconds)).to_rfc3339(),
        scopes: codex_scopes(),
        token_endpoint_url,
        chat_base_url: chat_base_url.trim_end_matches('/').to_string(),
        chat_model: CODEX_CHAT_MODEL.to_string(),
    })
}

fn validate_ttl_seconds(ttl_seconds: i64) -> Result<i64, ProviderAuthError> {
    if ttl_seconds <= 0 || ttl_seconds > MAX_PROVIDER_AUTH_TTL_SECONDS {
        return Err(ProviderAuthError::InvalidRequest);
    }
    Ok(ttl_seconds)
}

fn experimental_endpoint_url(
    request_value: Option<&str>,
    default_value: &str,
) -> Result<String, ProviderAuthError> {
    match request_value {
        Some(value) => validate_experimental_endpoint_url(value, true),
        None => validate_experimental_endpoint_url(default_value, false),
    }
}

fn validate_experimental_endpoint_url(
    value: &str,
    require_loopback: bool,
) -> Result<String, ProviderAuthError> {
    let value = validate_required_string(value, PROVIDER_AUTH_URL_MAX_CHARS)?;
    let parsed = reqwest::Url::parse(&value).map_err(|_| ProviderAuthError::InvalidRequest)?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(ProviderAuthError::InvalidRequest);
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ProviderAuthError::InvalidRequest);
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(ProviderAuthError::InvalidRequest);
    }
    if require_loopback && !is_allowed_loopback_host(&parsed) {
        return Err(ProviderAuthError::InvalidRequest);
    }
    Ok(value.to_string())
}

fn is_allowed_loopback_host(url: &reqwest::Url) -> bool {
    matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "::1" | "[::1]")
    )
}

fn try_acquire_codex_exchange_guard(
    config_dir: &Path,
    provider: &str,
) -> Result<CodexExchangeGuard, ProviderAuthError> {
    let key = format!("{}\0{provider}", config_dir.display());
    let mut keys = CODEX_EXCHANGE_IN_FLIGHT
        .lock()
        .map_err(|_| ProviderAuthError::Storage)?;
    if !keys.insert(key.clone()) {
        return Err(ProviderAuthError::SessionNotFound);
    }
    Ok(CodexExchangeGuard { key })
}

async fn codex_exchange(
    config_dir: &Path,
    provider: &str,
    session_id: String,
    state_value: String,
    code: String,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let _guard = try_acquire_codex_exchange_guard(config_dir, provider)?;
    let mut codex = read_codex_state(config_dir, provider).await?;
    let Some(session) = codex.pending.take() else {
        return Err(ProviderAuthError::SessionNotFound);
    };
    if session.provider != provider
        || session.session_id != session_id
        || session.state != state_value
    {
        codex.pending = Some(session);
        write_codex_state(config_dir, provider, &codex).await?;
        return Err(ProviderAuthError::SessionMismatch);
    }
    if parse_time(&session.expires_at)? <= Utc::now() {
        write_codex_state(config_dir, provider, &codex).await?;
        return Err(ProviderAuthError::SessionExpired);
    }

    let token = match exchange_codex_token(&session, &code).await {
        Ok(token) => token,
        Err(error) => {
            codex.pending = Some(session);
            write_codex_state(config_dir, provider, &codex).await?;
            return Err(error);
        }
    };
    if token.access_token.trim().is_empty() || token.refresh_token.trim().is_empty() {
        codex.pending = Some(session);
        write_codex_state(config_dir, provider, &codex).await?;
        return Err(ProviderAuthError::TokenExchange);
    }
    let scopes = codex_token_scopes(token.scope.as_deref(), &session.scopes)?;
    let expires_in = validate_codex_token_expires_in(token.expires_in)?;
    let expires_at = (Utc::now() + Duration::seconds(expires_in)).to_rfc3339();
    let metadata = CodexAuthMetadata {
        provider: provider.to_string(),
        account_label: sanitized_account_label(token.account_label.as_deref()),
        scopes,
        expires_at,
        redacted: crate::secret_store::redact_secret(&token.access_token),
        chat_base_url: session.chat_base_url,
        chat_model: session.chat_model,
        token_endpoint_url: session.token_endpoint_url,
    };
    store_codex_connection(config_dir, provider, &token, &metadata).await?;
    if write_codex_state(config_dir, provider, &CodexOAuthState::default())
        .await
        .is_err()
    {
        delete_codex_secrets(config_dir, provider).await?;
        return Err(ProviderAuthError::Storage);
    }
    Ok(codex_connected_response(provider, metadata, Some(true)))
}

async fn exchange_codex_token(
    session: &CodexOAuthSession,
    code: &str,
) -> Result<CodexTokenResponse, ProviderAuthError> {
    let body = serde_json::json!({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": CODEX_REDIRECT_URI,
        "client_id": CODEX_CLIENT_ID,
        "code_verifier": session.verifier,
    });
    post_codex_token(&session.token_endpoint_url, body).await
}

async fn post_codex_token(
    token_endpoint_url: &str,
    body: serde_json::Value,
) -> Result<CodexTokenResponse, ProviderAuthError> {
    post_codex_token_raw(token_endpoint_url, body)
        .await
        .map_err(Into::into)
}

async fn post_codex_token_raw(
    token_endpoint_url: &str,
    body: serde_json::Value,
) -> Result<CodexTokenResponse, CodexTokenEndpointError> {
    let builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(
            CODEX_TOKEN_EXCHANGE_TIMEOUT_SECONDS,
        ))
        .no_proxy();
    let client = builder
        .build()
        .map_err(|_| CodexTokenEndpointError::Failed)?;
    let response = client
        .post(token_endpoint_url)
        .json(&body)
        .send()
        .await
        .map_err(|_| CodexTokenEndpointError::Failed)?;
    let status = response.status();
    if !status.is_success() {
        if status == StatusCode::UNAUTHORIZED {
            let body = bounded_codex_token_error_body(response).await;
            if codex_token_error_is_refresh_token_reused(&body) {
                return Err(CodexTokenEndpointError::RefreshTokenReused);
            }
        }
        return Err(CodexTokenEndpointError::Failed);
    }
    response
        .json::<CodexTokenResponse>()
        .await
        .map_err(|_| CodexTokenEndpointError::Failed)
}

async fn refresh_codex_token(
    token_endpoint_url: &str,
    refresh_token: &str,
) -> Result<CodexTokenResponse, CodexTokenEndpointError> {
    let body = serde_json::json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CODEX_CLIENT_ID,
    });
    post_codex_token_raw(token_endpoint_url, body).await
}

async fn bounded_codex_token_error_body(response: reqwest::Response) -> Vec<u8> {
    let read = async move {
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| ())?;
            let remaining = CODEX_TOKEN_ERROR_BODY_LIMIT_BYTES.saturating_sub(body.len());
            if remaining == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if body.len() >= CODEX_TOKEN_ERROR_BODY_LIMIT_BYTES {
                break;
            }
        }
        Ok::<Vec<u8>, ()>(body)
    };
    match tokio::time::timeout(
        std::time::Duration::from_secs(CODEX_TOKEN_EXCHANGE_TIMEOUT_SECONDS),
        read,
    )
    .await
    {
        Ok(Ok(body)) => body,
        _ => Vec::new(),
    }
}

fn codex_token_error_is_refresh_token_reused(body: &[u8]) -> bool {
    let text = String::from_utf8_lossy(body).to_ascii_lowercase();
    text.contains("refresh_token_reused")
        || (text.contains("refresh token") && text.contains("already been used"))
}

fn validate_codex_token_expires_in(value: Option<i64>) -> Result<i64, ProviderAuthError> {
    let value = value.unwrap_or(CODEX_TOKEN_DEFAULT_EXPIRES_IN_SECONDS);
    if value <= 0 || value > MAX_CODEX_TOKEN_EXPIRES_IN_SECONDS {
        return Err(ProviderAuthError::TokenExchange);
    }
    Ok(value)
}

fn codex_token_scopes(
    token_scope: Option<&str>,
    default_scopes: &[String],
) -> Result<Vec<String>, ProviderAuthError> {
    let defaults = validate_codex_scope_allowlist(default_scopes.to_vec())
        .map_err(|_| ProviderAuthError::TokenExchange)?;
    match token_scope {
        Some(value) => validate_codex_scope_subset(
            value.split_whitespace().map(str::to_string).collect(),
            &defaults,
        ),
        None => Ok(defaults),
    }
    .map_err(|_| ProviderAuthError::TokenExchange)
}

fn validate_codex_scopes(scopes: Vec<String>) -> Result<Vec<String>, ProviderAuthError> {
    if scopes.is_empty() || scopes.len() > CODEX_SCOPE_MAX_TOKENS {
        return Err(ProviderAuthError::Storage);
    }
    let mut total_chars = 0usize;
    let mut sanitized = Vec::with_capacity(scopes.len());
    for scope in scopes {
        let scope = scope.trim();
        let lower = scope.to_ascii_lowercase();
        total_chars = total_chars.saturating_add(scope.chars().count());
        if scope.is_empty()
            || scope.chars().count() > CODEX_SCOPE_MAX_TOKEN_CHARS
            || total_chars > CODEX_SCOPE_MAX_LIST_CHARS
            || !scope.chars().all(is_safe_codex_scope_char)
            || scope.contains("..")
            || scope.starts_with('/')
            || scope.starts_with('-')
            || scope.starts_with('.')
            || lower.contains("secret")
            || lower.contains("token")
            || lower.contains("cookie")
            || lower.contains("bearer")
            || lower.contains("auth.json")
        {
            return Err(ProviderAuthError::Storage);
        }
        sanitized.push(scope.to_string());
    }
    Ok(sanitized)
}

fn validate_codex_scope_allowlist(scopes: Vec<String>) -> Result<Vec<String>, ProviderAuthError> {
    let scopes = validate_codex_scopes(scopes)?;
    let requested: HashSet<&str> = scopes.iter().map(String::as_str).collect();
    let mut ordered = Vec::new();
    for allowed in CODEX_ALLOWED_SCOPES {
        if requested.contains(allowed) {
            ordered.push(allowed.to_string());
        }
    }
    if ordered.len() != requested.len() || ordered.is_empty() {
        return Err(ProviderAuthError::Storage);
    }
    Ok(ordered)
}

fn validate_codex_scope_subset(
    scopes: Vec<String>,
    requested_scopes: &[String],
) -> Result<Vec<String>, ProviderAuthError> {
    let scopes = validate_codex_scopes(scopes)?;
    let returned: HashSet<&str> = scopes.iter().map(String::as_str).collect();
    if returned.is_empty() {
        return Err(ProviderAuthError::Storage);
    }
    let requested: HashSet<&str> = requested_scopes.iter().map(String::as_str).collect();
    if returned.iter().any(|scope| !requested.contains(*scope)) {
        return Err(ProviderAuthError::Storage);
    }
    Ok(requested_scopes
        .iter()
        .filter(|scope| returned.contains(scope.as_str()))
        .cloned()
        .collect())
}

fn is_safe_codex_scope_char(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, ':' | '.' | '_' | '-' | '/')
}

fn sanitized_account_label(value: Option<&str>) -> String {
    let label = value
        .unwrap_or("OpenAI account")
        .trim()
        .chars()
        .map(|value| if value.is_control() { ' ' } else { value })
        .collect::<String>();
    let label = redact_account_label_secrets(&label)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let label = label.trim();
    if label.is_empty() || label == "..." || label.contains("...") {
        return "OpenAI account".to_string();
    }
    label.chars().take(120).collect()
}

fn redact_account_label_secrets(value: &str) -> String {
    value
        .split_whitespace()
        .map(|part| {
            let lower = part.to_lowercase();
            if lower.contains("bearer")
                || lower.contains("api_key")
                || lower.contains("apikey")
                || lower.contains("access_token")
                || lower.contains("refresh_token")
                || lower.contains("oauth_code")
                || lower.contains("code_verifier")
                || lower.contains("client_secret")
                || lower.contains("cookie")
                || lower.contains("auth.json")
                || lower.contains(".codex/")
                || lower.starts_with("sk-")
                || lower.starts_with("codex-")
                || looks_like_jwt(part)
                || looks_like_path(part)
            {
                "...".to_string()
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn looks_like_jwt(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| part.len() >= 8 && is_url_safe_token(part))
}

fn looks_like_path(value: &str) -> bool {
    value.starts_with('/') || value.starts_with('~') || value.contains("\\")
}

fn is_url_safe_token(value: &str) -> bool {
    value
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
}

async fn store_codex_connection(
    config_dir: &Path,
    provider: &str,
    token: &CodexTokenResponse,
    metadata: &CodexAuthMetadata,
) -> Result<(), ProviderAuthError> {
    let store = provider_secret_store(config_dir);
    let metadata = serde_json::to_string(metadata).map_err(|_| ProviderAuthError::Storage)?;
    let result = async {
        store
            .put_secret(provider, SecretKind::OAuthAccessToken, &token.access_token)
            .await?;
        store
            .put_secret(
                provider,
                SecretKind::OAuthRefreshToken,
                &token.refresh_token,
            )
            .await?;
        store
            .put_secret(provider, SecretKind::AuthMetadata, &metadata)
            .await?;
        Ok::<(), ProviderAuthError>(())
    }
    .await;
    if result.is_err() {
        delete_codex_secret_bundle(&store, provider).await?;
    }
    result
}

async fn delete_codex_secret_bundle(
    store: &impl ProviderSecretStore,
    provider: &str,
) -> Result<(), ProviderAuthError> {
    let mut failed = false;
    for kind in [
        SecretKind::OAuthAccessToken,
        SecretKind::OAuthRefreshToken,
        SecretKind::AuthMetadata,
    ] {
        if store.delete_secret(provider, kind).await.is_err() {
            failed = true;
        }
    }
    if failed {
        Err(ProviderAuthError::Storage)
    } else {
        Ok(())
    }
}

async fn codex_connected_status(
    config_dir: &Path,
    provider: &str,
) -> Result<Option<ProviderAuthResponse>, ProviderAuthError> {
    let store = provider_secret_store(config_dir);
    let Some(metadata) = store.get_secret(provider, SecretKind::AuthMetadata).await? else {
        return Ok(None);
    };
    let metadata: CodexAuthMetadata =
        serde_json::from_str(&metadata).map_err(|_| ProviderAuthError::Storage)?;
    validate_codex_metadata(provider, &metadata)?;
    let Some(access_token) = store
        .get_secret(provider, SecretKind::OAuthAccessToken)
        .await?
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let Some(_) = store
        .get_secret(provider, SecretKind::OAuthRefreshToken)
        .await?
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let metadata = sanitize_codex_response_metadata(metadata, Some(&access_token));
    if parse_time(&metadata.expires_at)? <= Utc::now() {
        return Ok(Some(codex_expired_response(provider, metadata)));
    }
    Ok(Some(codex_connected_response(provider, metadata, None)))
}

pub async fn experimental_codex_chat_auth(
    config_dir: &Path,
) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
    let provider = "openai";
    let store = provider_secret_store(config_dir);
    let Some(metadata) = store.get_secret(provider, SecretKind::AuthMetadata).await? else {
        return Ok(None);
    };
    let metadata: CodexAuthMetadata =
        serde_json::from_str(&metadata).map_err(|_| ProviderAuthError::Storage)?;
    if validate_codex_metadata(provider, &metadata).is_err()
        || parse_time(&metadata.expires_at)? <= Utc::now()
    {
        return Ok(None);
    }
    let Some(access_token) = store
        .get_secret(provider, SecretKind::OAuthAccessToken)
        .await?
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let Some(_) = store
        .get_secret(provider, SecretKind::OAuthRefreshToken)
        .await?
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    Ok(Some(ExperimentalCodexChatAuth {
        access_token,
        base_url: metadata.chat_base_url,
        model: metadata.chat_model,
    }))
}

pub async fn refresh_experimental_codex_chat_auth_after_rejection(
    config_dir: &Path,
    rejected_access_token: &str,
) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
    refresh_experimental_codex_chat_auth(config_dir, Some(rejected_access_token)).await
}

pub async fn refresh_experimental_codex_chat_auth_if_needed(
    config_dir: &Path,
) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
    let provider = "openai";
    if codex_pending_session_is_unexpired(config_dir, provider).await? {
        return Ok(None);
    }
    let Some(snapshot) = read_codex_chat_auth_snapshot(config_dir, provider).await? else {
        return Ok(None);
    };
    if metadata_needs_refresh(&snapshot.metadata)? {
        refresh_experimental_codex_chat_auth(config_dir, None).await
    } else {
        Ok(Some(snapshot.auth))
    }
}

async fn refresh_experimental_codex_chat_auth(
    config_dir: &Path,
    rejected_access_token: Option<&str>,
) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
    let provider = "openai";
    if codex_pending_session_is_unexpired(config_dir, provider).await? {
        return Ok(None);
    }
    let lock = codex_refresh_lock(config_dir, provider)?;
    let _guard = lock.lock().await;
    let _file_guard = acquire_codex_refresh_file_lock(config_dir, provider).await?;
    if codex_pending_session_is_unexpired(config_dir, provider).await? {
        return Ok(None);
    }
    let Some(current) = read_codex_chat_auth_snapshot(config_dir, provider).await? else {
        return Ok(None);
    };
    let needs_refresh = metadata_needs_refresh(&current.metadata)?;
    if rejected_access_token.is_some_and(|token| token != current.access_token) && !needs_refresh {
        return Ok(Some(current.auth));
    }
    if rejected_access_token.is_none() && !needs_refresh {
        return Ok(Some(current.auth));
    }
    let refresh_token = current.refresh_token;
    let token =
        match refresh_codex_token(&current.metadata.token_endpoint_url, &refresh_token).await {
            Ok(token) => token,
            Err(CodexTokenEndpointError::RefreshTokenReused) => {
                if let Some(newer) =
                    read_newer_codex_chat_auth(config_dir, provider, &current.access_token).await?
                {
                    return Ok(Some(newer));
                }
                clear_codex_auth_after_refresh_token_reuse(config_dir, provider).await?;
                return Err(ProviderAuthError::TokenExchange);
            }
            Err(CodexTokenEndpointError::Failed) => return Err(ProviderAuthError::TokenExchange),
        };
    if token.access_token.trim().is_empty() || token.refresh_token.trim().is_empty() {
        return Err(ProviderAuthError::TokenExchange);
    }
    let scopes = codex_token_scopes(token.scope.as_deref(), &current.metadata.scopes)?;
    let expires_in = validate_codex_token_expires_in(token.expires_in)?;
    let metadata = CodexAuthMetadata {
        provider: provider.to_string(),
        account_label: token
            .account_label
            .as_deref()
            .map(|value| sanitized_account_label(Some(value)))
            .unwrap_or_else(|| sanitized_account_label(Some(&current.metadata.account_label))),
        scopes,
        expires_at: (Utc::now() + Duration::seconds(expires_in)).to_rfc3339(),
        redacted: crate::secret_store::redact_secret(&token.access_token),
        chat_base_url: current.metadata.chat_base_url,
        chat_model: current.metadata.chat_model,
        token_endpoint_url: current.metadata.token_endpoint_url,
    };
    store_codex_connection(config_dir, provider, &token, &metadata).await?;
    Ok(Some(ExperimentalCodexChatAuth {
        access_token: token.access_token,
        base_url: metadata.chat_base_url,
        model: metadata.chat_model,
    }))
}

async fn clear_codex_auth_after_refresh_token_reuse(
    config_dir: &Path,
    provider: &str,
) -> Result<(), ProviderAuthError> {
    write_codex_state(config_dir, provider, &CodexOAuthState::default()).await?;
    delete_codex_secrets(config_dir, provider).await
}

async fn codex_pending_session_is_unexpired(
    config_dir: &Path,
    provider: &str,
) -> Result<bool, ProviderAuthError> {
    let codex = read_codex_state(config_dir, provider).await?;
    let Some(session) = codex.pending else {
        return Ok(false);
    };
    Ok(parse_time(&session.expires_at)? > Utc::now())
}

struct CodexChatAuthSnapshot {
    access_token: String,
    refresh_token: String,
    metadata: CodexAuthMetadata,
    auth: ExperimentalCodexChatAuth,
}

async fn read_codex_chat_auth_snapshot(
    config_dir: &Path,
    provider: &str,
) -> Result<Option<CodexChatAuthSnapshot>, ProviderAuthError> {
    let store = provider_secret_store(config_dir);
    let Some(metadata) = store.get_secret(provider, SecretKind::AuthMetadata).await? else {
        return Ok(None);
    };
    let metadata: CodexAuthMetadata =
        serde_json::from_str(&metadata).map_err(|_| ProviderAuthError::Storage)?;
    validate_codex_metadata(provider, &metadata)?;
    let Some(access_token) = store
        .get_secret(provider, SecretKind::OAuthAccessToken)
        .await?
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let Some(refresh_token) = store
        .get_secret(provider, SecretKind::OAuthRefreshToken)
        .await?
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let auth = ExperimentalCodexChatAuth {
        access_token: access_token.clone(),
        base_url: metadata.chat_base_url.clone(),
        model: metadata.chat_model.clone(),
    };
    Ok(Some(CodexChatAuthSnapshot {
        access_token,
        refresh_token,
        metadata,
        auth,
    }))
}

async fn read_newer_codex_chat_auth(
    config_dir: &Path,
    provider: &str,
    old_access_token: &str,
) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
    let Some(snapshot) = read_codex_chat_auth_snapshot(config_dir, provider).await? else {
        return Ok(None);
    };
    if snapshot.access_token != old_access_token && !metadata_needs_refresh(&snapshot.metadata)? {
        Ok(Some(snapshot.auth))
    } else {
        Ok(None)
    }
}

fn metadata_needs_refresh(metadata: &CodexAuthMetadata) -> Result<bool, ProviderAuthError> {
    Ok(parse_time(&metadata.expires_at)?
        <= Utc::now() + Duration::seconds(CODEX_TOKEN_REFRESH_SKEW_SECONDS))
}

fn codex_refresh_lock(
    config_dir: &Path,
    provider: &str,
) -> Result<Arc<tokio::sync::Mutex<()>>, ProviderAuthError> {
    let key = format!("{}\0{provider}", config_dir.display());
    let mut locks = CODEX_REFRESH_LOCKS
        .lock()
        .map_err(|_| ProviderAuthError::Storage)?;
    Ok(locks
        .entry(key)
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone())
}

async fn acquire_codex_refresh_file_lock(
    config_dir: &Path,
    provider: &str,
) -> Result<CodexRefreshFileLock, ProviderAuthError> {
    let path = codex_refresh_lock_path(config_dir, provider)?;
    ensure_provider_auth_directory(&path).await?;
    reject_provider_auth_file_symlink(&path).await?;
    #[cfg(unix)]
    {
        let started = std::time::Instant::now();
        loop {
            match try_acquire_codex_refresh_file_lock_once(&path).await? {
                Some(lock) => return Ok(lock),
                None if started.elapsed() >= CODEX_REFRESH_FILE_LOCK_TIMEOUT => {
                    return Err(ProviderAuthError::Storage)
                }
                None => tokio::time::sleep(CODEX_REFRESH_FILE_LOCK_RETRY).await,
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(ProviderAuthError::Storage)
    }
}

#[cfg(unix)]
async fn try_acquire_codex_refresh_file_lock_once(
    path: &Path,
) -> Result<Option<CodexRefreshFileLock>, ProviderAuthError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let file = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)
            .map_err(|_| ProviderAuthError::Storage)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ProviderAuthError::Storage)?;
        let rc = unsafe {
            libc::flock(
                std::os::fd::AsRawFd::as_raw_fd(&file),
                libc::LOCK_EX | libc::LOCK_NB,
            )
        };
        if rc == 0 {
            return Ok(Some(CodexRefreshFileLock { file: Some(file) }));
        }
        let error = std::io::Error::last_os_error();
        if matches!(error.raw_os_error(), Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN) {
            return Ok(None);
        }
        Err(ProviderAuthError::Storage)
    })
    .await
    .map_err(|_| ProviderAuthError::Storage)?
}

fn codex_refresh_lock_path(
    config_dir: &Path,
    provider: &str,
) -> Result<PathBuf, ProviderAuthError> {
    providers::validate_provider_id(provider).map_err(|_| ProviderAuthError::InvalidProvider)?;
    Ok(config_dir
        .join("provider-auth-openai")
        .join(format!(".{provider}.refresh.lock")))
}

#[cfg(unix)]
struct CodexRefreshFileLock {
    file: Option<std::fs::File>,
}

#[cfg(unix)]
impl Drop for CodexRefreshFileLock {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            let _ = unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&file), libc::LOCK_UN) };
        }
    }
}

#[cfg(not(unix))]
struct CodexRefreshFileLock {}

fn validate_codex_metadata(
    provider: &str,
    metadata: &CodexAuthMetadata,
) -> Result<(), ProviderAuthError> {
    if metadata.provider != provider {
        return Err(ProviderAuthError::Storage);
    }
    let scopes = validate_codex_scope_subset(metadata.scopes.clone(), &codex_scopes())?;
    if scopes.len() != metadata.scopes.len() {
        return Err(ProviderAuthError::Storage);
    }
    if metadata.token_endpoint_url.trim() != CODEX_TOKEN_URL {
        validate_experimental_endpoint_url(&metadata.token_endpoint_url, true)?;
    }
    if metadata.chat_base_url.trim_end_matches('/') == CODEX_CHAT_BASE_URL {
        if metadata.chat_model == CODEX_CHAT_MODEL {
            return Ok(());
        }
        return Err(ProviderAuthError::Storage);
    }
    validate_experimental_endpoint_url(&metadata.chat_base_url, true)?;
    validate_codex_chat_model(&metadata.chat_model)
}

fn validate_codex_chat_model(value: &str) -> Result<(), ProviderAuthError> {
    if value == CODEX_CHAT_MODEL {
        return Ok(());
    }
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    if trimmed != value
        || trimmed.is_empty()
        || trimmed.chars().count() > CODEX_CHAT_MODEL_MAX_CHARS
        || trimmed.chars().any(|value| value.is_control() || value.is_whitespace())
        || !trimmed
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-' | ':'))
        || trimmed.starts_with('/')
        || trimmed.starts_with('.')
        || trimmed.starts_with('-')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('@')
        || trimmed.contains('?')
        || trimmed.contains('#')
        || trimmed.contains('=')
        || trimmed.contains("..")
        || lower.starts_with("sk-")
        || lower.contains("secret")
        || lower.contains("token")
        || lower.contains("bearer")
        || lower.contains("cookie")
        || lower.contains("auth.json")
        || lower.contains(".codex")
        || looks_like_jwt(trimmed)
        || looks_like_path(trimmed)
    {
        return Err(ProviderAuthError::Storage);
    }
    Ok(())
}

fn sanitize_codex_response_metadata(
    mut metadata: CodexAuthMetadata,
    access_token: Option<&str>,
) -> CodexAuthMetadata {
    metadata.account_label = sanitized_account_label(Some(&metadata.account_label));
    metadata.redacted = access_token
        .map(crate::secret_store::redact_secret)
        .unwrap_or_else(|| "oauth-token-...redacted".to_string());
    metadata
}

fn default_codex_chat_base_url() -> String {
    CODEX_CHAT_BASE_URL.to_string()
}

fn default_codex_chat_model() -> String {
    CODEX_CHAT_MODEL.to_string()
}

fn default_codex_token_url() -> String {
    CODEX_TOKEN_URL.to_string()
}

async fn codex_has_secrets(config_dir: &Path, provider: &str) -> Result<bool, ProviderAuthError> {
    let store = provider_secret_store(config_dir);
    Ok(store
        .get_secret(provider, SecretKind::OAuthAccessToken)
        .await?
        .is_some()
        || store
            .get_secret(provider, SecretKind::OAuthRefreshToken)
            .await?
            .is_some()
        || store
            .get_secret(provider, SecretKind::AuthMetadata)
            .await?
            .is_some())
}

async fn reject_mock_codex_coexistence(
    config_dir: &Path,
    provider: &str,
) -> Result<(), ProviderAuthError> {
    if provider != "openai" {
        return Ok(());
    }
    if codex_auth_state_exists(config_dir, provider).await? {
        return Err(ProviderAuthError::InvalidRequest);
    }
    Ok(())
}

async fn codex_auth_state_exists(
    config_dir: &Path,
    provider: &str,
) -> Result<bool, ProviderAuthError> {
    let codex = read_codex_state(config_dir, provider).await?;
    Ok(codex.pending.is_some() || codex_has_secrets(config_dir, provider).await?)
}

async fn reject_codex_mock_coexistence(
    config_dir: &Path,
    provider: &str,
) -> Result<(), ProviderAuthError> {
    let mock = read_mock_state(config_dir, provider).await?;
    if mock.pending.is_some() || mock.connected.is_some() {
        return Err(ProviderAuthError::InvalidRequest);
    }
    Ok(())
}

async fn reject_existing_codex_auth_state(
    config_dir: &Path,
    provider: &str,
) -> Result<(), ProviderAuthError> {
    let codex = read_codex_state(config_dir, provider).await?;
    if codex.pending.is_some() || codex_has_readable_secrets(config_dir, provider).await? {
        return Err(ProviderAuthError::InvalidRequest);
    }
    Ok(())
}

async fn codex_has_readable_secrets(
    config_dir: &Path,
    provider: &str,
) -> Result<bool, ProviderAuthError> {
    let store = provider_secret_store(config_dir);
    for kind in [
        SecretKind::OAuthAccessToken,
        SecretKind::OAuthRefreshToken,
        SecretKind::AuthMetadata,
    ] {
        if store.get_secret(provider, kind).await?.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn delete_codex_secrets(config_dir: &Path, provider: &str) -> Result<(), ProviderAuthError> {
    let store = provider_secret_store(config_dir);
    delete_codex_secret_bundle(&store, provider).await
}

fn codex_scopes() -> Vec<String> {
    CODEX_SCOPE.split(' ').map(str::to_string).collect()
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

fn random_url_safe(length: usize) -> Result<String, ProviderAuthError> {
    let mut bytes = vec![0u8; length];
    getrandom::getrandom(&mut bytes).map_err(|_| ProviderAuthError::Storage)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn codex_authorization_url(session: &CodexOAuthSession) -> String {
    let scope = session.scopes.join(" ");
    format!(
        "{CODEX_AUTHORIZE_URL}?response_type=code&client_id={CODEX_CLIENT_ID}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&state={}&originator=yet_ai_local",
        encode_component(CODEX_REDIRECT_URI),
        encode_component(&scope),
        encode_component(&session.challenge),
        encode_component(&session.state),
    )
}

fn encode_component(value: &str) -> String {
    url_encode(value.as_bytes())
}

fn url_encode(bytes: &[u8]) -> String {
    let mut output = String::new();
    for byte in bytes {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                output.push(*byte as char)
            }
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

fn required_value(value: Option<String>, max_chars: usize) -> Result<String, ProviderAuthError> {
    let value = value.ok_or(ProviderAuthError::InvalidRequest)?;
    if value.trim() != value {
        return Err(ProviderAuthError::InvalidRequest);
    }
    validate_required_string(&value, max_chars)
}

fn validate_required_string(value: &str, max_chars: usize) -> Result<String, ProviderAuthError> {
    if value.chars().any(is_c0_c1_control) {
        return Err(ProviderAuthError::InvalidRequest);
    }
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max_chars {
        return Err(ProviderAuthError::InvalidRequest);
    }
    Ok(value.to_string())
}

fn is_c0_c1_control(value: char) -> bool {
    matches!(value as u32, 0x00..=0x1f | 0x7f..=0x9f)
}

fn parse_time(value: &str) -> Result<chrono::DateTime<Utc>, ProviderAuthError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| ProviderAuthError::Storage)
}

async fn read_mock_state(
    config_dir: &Path,
    provider: &str,
) -> Result<MockOAuthState, ProviderAuthError> {
    read_provider_auth_state(config_dir, "provider-auth-mock", provider).await
}

async fn write_mock_state(
    config_dir: &Path,
    provider: &str,
    state: &MockOAuthState,
) -> Result<(), ProviderAuthError> {
    write_provider_auth_state(config_dir, "provider-auth-mock", provider, state).await
}

async fn read_codex_state(
    config_dir: &Path,
    provider: &str,
) -> Result<CodexOAuthState, ProviderAuthError> {
    read_provider_auth_state(config_dir, "provider-auth-openai", provider).await
}

async fn write_codex_state(
    config_dir: &Path,
    provider: &str,
    state: &CodexOAuthState,
) -> Result<(), ProviderAuthError> {
    write_provider_auth_state(config_dir, "provider-auth-openai", provider, state).await
}

async fn read_provider_auth_state<T>(
    config_dir: &Path,
    tree_name: &str,
    provider: &str,
) -> Result<T, ProviderAuthError>
where
    T: DeserializeOwned + Default,
{
    let path = provider_auth_state_path(config_dir, tree_name, provider)?;
    ensure_existing_provider_auth_directory(&path).await?;
    reject_provider_auth_file_symlink(&path).await?;
    let Some(bytes) = read_provider_auth_file(&path).await? else {
        return Ok(T::default());
    };
    serde_json::from_slice(&bytes).map_err(|_| ProviderAuthError::Storage)
}

async fn write_provider_auth_state<T>(
    config_dir: &Path,
    tree_name: &str,
    provider: &str,
    state: &T,
) -> Result<(), ProviderAuthError>
where
    T: Serialize,
{
    let path = provider_auth_state_path(config_dir, tree_name, provider)?;
    ensure_provider_auth_directory(&path).await?;
    reject_provider_auth_file_symlink(&path).await?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|_| ProviderAuthError::Storage)?;
    atomic_write_provider_auth_state(&path, &bytes).await
}

fn provider_auth_state_path(
    config_dir: &Path,
    tree_name: &str,
    provider: &str,
) -> Result<PathBuf, ProviderAuthError> {
    providers::validate_provider_id(provider).map_err(|_| ProviderAuthError::InvalidProvider)?;
    if !matches!(tree_name, "provider-auth-mock" | "provider-auth-openai") {
        return Err(ProviderAuthError::Storage);
    }
    let root = config_dir.join(tree_name);
    let path = root.join(format!("{provider}.json"));
    if path.parent() != Some(root.as_path()) || path.file_name().is_none() {
        return Err(ProviderAuthError::Storage);
    }
    Ok(path)
}

async fn ensure_provider_auth_directory(path: &Path) -> Result<(), ProviderAuthError> {
    let root = path.parent().ok_or(ProviderAuthError::Storage)?;
    let parent = root.parent().ok_or(ProviderAuthError::Storage)?;
    reject_existing_provider_auth_ancestor_symlinks(parent).await?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| ProviderAuthError::Storage)?;
    reject_existing_provider_auth_ancestor_symlinks(root).await?;
    ensure_provider_auth_root(root, true).await.map(|_| ())
}

async fn ensure_existing_provider_auth_directory(path: &Path) -> Result<(), ProviderAuthError> {
    let root = path.parent().ok_or(ProviderAuthError::Storage)?;
    reject_existing_provider_auth_ancestor_symlinks(root).await?;
    ensure_provider_auth_root(root, false).await.map(|_| ())
}

async fn ensure_provider_auth_root(root: &Path, create: bool) -> Result<bool, ProviderAuthError> {
    match tokio::fs::symlink_metadata(root).await {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(ProviderAuthError::Storage);
            }
            set_private_directory_permissions(root).await?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            tokio::fs::create_dir(root)
                .await
                .map_err(|_| ProviderAuthError::Storage)?;
            let metadata = tokio::fs::symlink_metadata(root)
                .await
                .map_err(|_| ProviderAuthError::Storage)?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(ProviderAuthError::Storage);
            }
            reject_existing_provider_auth_ancestor_symlinks(root).await?;
            set_private_directory_permissions(root).await?;
            Ok(true)
        }
        Err(_) => Err(ProviderAuthError::Storage),
    }
}

async fn reject_existing_provider_auth_ancestor_symlinks(
    path: &Path,
) -> Result<(), ProviderAuthError> {
    let mut current = PathBuf::new();
    let components = path.components();
    for component in components {
        current.push(component.as_os_str());
        if matches!(component, std::path::Component::RootDir) {
            let canonical_root =
                std::fs::canonicalize(&current).map_err(|_| ProviderAuthError::Storage)?;
            if canonical_root != current {
                current = canonical_root;
            }
            continue;
        }
        match tokio::fs::symlink_metadata(&current).await {
            Ok(metadata)
                if metadata.file_type().is_symlink()
                    && !is_provider_auth_platform_root_alias(&current) =>
            {
                return Err(ProviderAuthError::Storage);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err(ProviderAuthError::Storage),
        }
    }
    Ok(())
}

fn is_provider_auth_platform_root_alias(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        path == Path::new("/var")
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        false
    }
}

async fn reject_provider_auth_file_symlink(path: &Path) -> Result<(), ProviderAuthError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(ProviderAuthError::Storage),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ProviderAuthError::Storage),
    }
}

async fn atomic_write_provider_auth_state(
    path: &Path,
    bytes: &[u8],
) -> Result<(), ProviderAuthError> {
    let temp_path = temp_provider_auth_path(path);
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
            .map_err(|_| ProviderAuthError::Storage)?;
        file.write_all(bytes)
            .await
            .map_err(|_| ProviderAuthError::Storage)?;
        file.sync_all()
            .await
            .map_err(|_| ProviderAuthError::Storage)?;
        set_private_permissions_for_open_file(file).await?;
        reject_provider_auth_file_symlink(path).await?;
        tokio::fs::rename(&temp_path, path)
            .await
            .map_err(|_| ProviderAuthError::Storage)?;
        set_private_permissions(path).await?;
        sync_parent_directory(path).await
    }
    .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            cleanup_provider_auth_temp_file(&temp_path).await?;
            Err(error)
        }
    }
}

fn temp_provider_auth_path(path: &Path) -> PathBuf {
    let counter = PROVIDER_AUTH_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("state.json");
    path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        counter
    ))
}

async fn cleanup_provider_auth_temp_file(path: &Path) -> Result<(), ProviderAuthError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ProviderAuthError::Storage),
    }
}

#[cfg(unix)]
async fn read_provider_auth_file(path: &Path) -> Result<Option<Vec<u8>>, ProviderAuthError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::io::Read;

        let mut file = match open_file_no_follow(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ProviderAuthError::Storage),
        };
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|_| ProviderAuthError::Storage)?;
        Ok(Some(bytes))
    })
    .await
    .map_err(|_| ProviderAuthError::Storage)?
}

#[cfg(not(unix))]
async fn read_provider_auth_file(path: &Path) -> Result<Option<Vec<u8>>, ProviderAuthError> {
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ProviderAuthError::Storage),
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
) -> Result<(), ProviderAuthError> {
    use std::os::unix::fs::PermissionsExt;

    let file = file.into_std().await;
    tokio::task::spawn_blocking(move || {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ProviderAuthError::Storage)
    })
    .await
    .map_err(|_| ProviderAuthError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions_for_open_file(
    file: tokio::fs::File,
) -> Result<(), ProviderAuthError> {
    drop(file);
    Ok(())
}

#[cfg(unix)]
async fn set_private_permissions(path: &Path) -> Result<(), ProviderAuthError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = open_file_no_follow(&path).map_err(|_| ProviderAuthError::Storage)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ProviderAuthError::Storage)
    })
    .await
    .map_err(|_| ProviderAuthError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions(_path: &Path) -> Result<(), ProviderAuthError> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_directory_permissions(path: &Path) -> Result<(), ProviderAuthError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let directory = open_directory_no_follow(&path).map_err(|_| ProviderAuthError::Storage)?;
        directory
            .set_permissions(std::fs::Permissions::from_mode(0o700))
            .map_err(|_| ProviderAuthError::Storage)
    })
    .await
    .map_err(|_| ProviderAuthError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_directory_permissions(_path: &Path) -> Result<(), ProviderAuthError> {
    Ok(())
}

#[cfg(unix)]
async fn sync_parent_directory(path: &Path) -> Result<(), ProviderAuthError> {
    let dir = path
        .parent()
        .ok_or(ProviderAuthError::Storage)?
        .to_path_buf();
    tokio::task::spawn_blocking(move || {
        match open_directory_no_follow(&dir).and_then(|directory| directory.sync_all()) {
            Ok(()) => Ok(()),
            Err(error) if is_unsupported_directory_sync_error(&error) => Ok(()),
            Err(_) => Err(ProviderAuthError::Storage),
        }
    })
    .await
    .map_err(|_| ProviderAuthError::Storage)?
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
async fn sync_parent_directory(_path: &Path) -> Result<(), ProviderAuthError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{CodexOAuthState, ProviderAuthError};
    use crate::secret_store::{ProviderSecretStore, SecretKind, SecretStoreError};

    #[derive(Clone, Default)]
    struct DeleteRecordingSecretStore {
        attempts: std::sync::Arc<std::sync::Mutex<Vec<SecretKind>>>,
    }

    impl DeleteRecordingSecretStore {
        fn attempts(&self) -> Vec<SecretKind> {
            self.attempts.lock().unwrap().clone()
        }
    }

    impl ProviderSecretStore for DeleteRecordingSecretStore {
        async fn put_secret(
            &self,
            _provider_id: &str,
            _kind: SecretKind,
            _value: &str,
        ) -> Result<(), SecretStoreError> {
            Ok(())
        }

        async fn put_secret_if_absent(
            &self,
            _provider_id: &str,
            _kind: SecretKind,
            _value: &str,
        ) -> Result<bool, SecretStoreError> {
            Ok(false)
        }

        async fn get_secret(
            &self,
            _provider_id: &str,
            _kind: SecretKind,
        ) -> Result<Option<String>, SecretStoreError> {
            Ok(None)
        }

        async fn delete_secret(
            &self,
            _provider_id: &str,
            kind: SecretKind,
        ) -> Result<(), SecretStoreError> {
            let mut attempts = self.attempts.lock().unwrap();
            attempts.push(kind);
            if attempts.len() == 1 {
                Err(SecretStoreError::Storage)
            } else {
                Ok(())
            }
        }
    }

    static TEST_DIR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-provider-auth-state-test-{}-{}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn response_json(response: &super::ProviderAuthResponse) -> String {
        serde_json::to_string(response).unwrap()
    }

    fn assert_response_sanitized(response: &super::ProviderAuthResponse, forbidden: &[&str]) {
        let json = response_json(response);
        for value in forbidden {
            assert!(!json.contains(value), "response leaked {value:?}: {json}");
        }
        assert!(
            !json.contains("access_token"),
            "response leaked access_token key: {json}"
        );
        assert!(
            !json.contains("refresh_token"),
            "response leaked refresh_token key: {json}"
        );
        assert!(
            !json.contains("verifier"),
            "response leaked verifier key: {json}"
        );
        assert!(
            !json.contains("cookie"),
            "response leaked cookie key: {json}"
        );
        assert!(
            !json.contains("/Users/"),
            "response leaked private path: {json}"
        );
    }

    fn parse_start_request(
        json: &str,
    ) -> Result<super::ProviderAuthStartRequest, serde_json::Error> {
        serde_json::from_str(json)
    }

    fn parse_exchange_request(
        json: &str,
    ) -> Result<super::ProviderAuthExchangeRequest, serde_json::Error> {
        serde_json::from_str(json)
    }

    async fn create_openai_api_key_provider(dir: &std::path::Path) {
        crate::providers::create_provider_config(
            dir,
            crate::providers::ProviderWriteRequest {
                id: Some("openai".to_string()),
                kind: Some(crate::providers::ProviderKind::OpenAiCompatible),
                display_name: Some("OpenAI API".to_string()),
                enabled: Some(true),
                base_url: Some("https://api.openai.com/v1".to_string()),
                auth: Some(crate::providers::AuthWriteRequest {
                    auth_type: crate::providers::AuthType::ApiKey,
                    api_key: Some("sk-test-api-key-secret".to_string()),
                }),
                models: Some(vec![crate::providers::ModelSummary {
                    id: "gpt-test".to_string(),
                    display_name: "GPT Test".to_string(),
                    provider_id: None,
                    capabilities: crate::providers::ModelCapabilities::default(),
                    readiness: crate::providers::ModelReadiness::default(),
                }]),
                capabilities: Some(crate::providers::ProviderCapabilities::default()),
            },
        )
        .await
        .unwrap();
    }

    async fn create_codex_oauth_connection(dir: &std::path::Path) {
        create_codex_oauth_connection_with_expiry(
            dir,
            chrono::Utc::now() + chrono::Duration::hours(1),
        )
        .await;
    }

    async fn create_expired_codex_oauth_connection(dir: &std::path::Path) {
        create_codex_oauth_connection_with_expiry(
            dir,
            chrono::Utc::now() - chrono::Duration::hours(1),
        )
        .await;
    }

    async fn create_codex_oauth_connection_with_expiry(
        dir: &std::path::Path,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) {
        create_codex_oauth_connection_with_expiry_and_metadata(dir, expires_at, |_, _| {}).await;
    }

    async fn create_codex_oauth_connection_with_expiry_and_metadata(
        dir: &std::path::Path,
        expires_at: chrono::DateTime<chrono::Utc>,
        mutate: impl FnOnce(&mut super::CodexTokenResponse, &mut super::CodexAuthMetadata),
    ) {
        let token = super::CodexTokenResponse {
            access_token: "codex-access-token-secret".to_string(),
            refresh_token: "codex-refresh-token-secret".to_string(),
            expires_in: Some(3600),
            scope: Some("openid profile email offline_access".to_string()),
            account_label: Some("Codex Test Account".to_string()),
        };
        let metadata = super::CodexAuthMetadata {
            provider: "openai".to_string(),
            account_label: "Codex Test Account".to_string(),
            scopes: super::codex_scopes(),
            expires_at: expires_at.to_rfc3339(),
            redacted: crate::secret_store::redact_secret(&token.access_token),
            chat_base_url: super::CODEX_CHAT_BASE_URL.to_string(),
            chat_model: super::CODEX_CHAT_MODEL.to_string(),
            token_endpoint_url: super::CODEX_TOKEN_URL.to_string(),
        };
        let mut token = token;
        let mut metadata = metadata;
        mutate(&mut token, &mut metadata);

        super::store_codex_connection(dir, "openai", &token, &metadata)
            .await
            .unwrap();
    }

    async fn create_codex_oauth_connection_with_chat_model(
        dir: &std::path::Path,
        chat_model: &str,
    ) {
        create_codex_oauth_connection_with_expiry_and_metadata(
            dir,
            chrono::Utc::now() + chrono::Duration::hours(1),
            |_, metadata| metadata.chat_model = chat_model.to_string(),
        )
        .await;
    }

    async fn create_near_expired_codex_oauth_connection_with_token_endpoint(
        dir: &std::path::Path,
        token_endpoint_url: &str,
    ) {
        create_codex_oauth_connection_with_expiry_and_metadata(
            dir,
            chrono::Utc::now() + chrono::Duration::seconds(5),
            |_, metadata| metadata.token_endpoint_url = token_endpoint_url.to_string(),
        )
        .await;
    }

    async fn refresh_token_reused_loopback_endpoint() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buffer = [0_u8; 2048];
                let _ = stream.read(&mut buffer).await;
                let body = r#"{"error":"refresh_token_reused"}"#;
                let response = format!(
                    "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });
        url
    }

    async fn successful_codex_token_endpoint_with_hook(
        hook: impl FnOnce() + Send + 'static,
    ) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buffer = [0_u8; 2048];
                let _ = stream.read(&mut buffer).await;
                hook();
                let body = r#"{"access_token":"codex-exchange-access-token-secret","refresh_token":"codex-exchange-refresh-token-secret","expires_in":3600,"scope":"openid profile email offline_access","account_label":"Codex Exchange Account"}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });
        url
    }

    async fn create_mock_connected_state(dir: &std::path::Path) {
        super::write_mock_state(
            dir,
            "openai",
            &super::MockOAuthState {
                pending: None,
                connected: Some(super::MockOAuthConnection {
                    provider: "openai".to_string(),
                    account_label: "Mock OAuth Account".to_string(),
                    scopes: vec!["mock:chat".to_string()],
                    expires_at: (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339(),
                    access_token: "fake-access-token".to_string(),
                    refresh_token: "fake-refresh-token".to_string(),
                }),
            },
        )
        .await
        .unwrap();
    }

    async fn create_codex_pending_state(dir: &std::path::Path) -> super::CodexOAuthSession {
        let session = super::new_codex_session(600, None, None).unwrap();
        super::write_codex_state(
            dir,
            "openai",
            &super::CodexOAuthState {
                pending: Some(session.clone()),
            },
        )
        .await
        .unwrap();
        session
    }

    async fn create_codex_pending_state_with_token_endpoint(
        dir: &std::path::Path,
        token_endpoint_url: &str,
    ) -> super::CodexOAuthSession {
        let session = super::new_codex_session(600, Some(token_endpoint_url), None).unwrap();
        super::write_codex_state(
            dir,
            "openai",
            &super::CodexOAuthState {
                pending: Some(session.clone()),
            },
        )
        .await
        .unwrap();
        session
    }

    async fn create_expired_codex_pending_state(dir: &std::path::Path) -> super::CodexOAuthSession {
        let mut session = super::new_codex_session(600, None, None).unwrap();
        session.expires_at = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        super::write_codex_state(
            dir,
            "openai",
            &super::CodexOAuthState {
                pending: Some(session.clone()),
            },
        )
        .await
        .unwrap();
        session
    }

    async fn create_malicious_codex_metadata_scope(dir: &std::path::Path, scope: &str) {
        let token = super::CodexTokenResponse {
            access_token: "codex-access-token-secret".to_string(),
            refresh_token: "codex-refresh-token-secret".to_string(),
            expires_in: Some(3600),
            scope: None,
            account_label: Some("Codex Test Account".to_string()),
        };
        let metadata = super::CodexAuthMetadata {
            provider: "openai".to_string(),
            account_label: "Codex Test Account".to_string(),
            scopes: vec!["openid".to_string(), scope.to_string()],
            expires_at: (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339(),
            redacted: crate::secret_store::redact_secret(&token.access_token),
            chat_base_url: super::CODEX_CHAT_BASE_URL.to_string(),
            chat_model: super::CODEX_CHAT_MODEL.to_string(),
            token_endpoint_url: super::CODEX_TOKEN_URL.to_string(),
        };
        super::store_codex_connection(dir, "openai", &token, &metadata)
            .await
            .unwrap();
    }

    async fn create_malicious_codex_metadata_gui_fields(
        dir: &std::path::Path,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) {
        let token = super::CodexTokenResponse {
            access_token: "codex-access-token-secret-gui-safe".to_string(),
            refresh_token: "codex-refresh-token-secret-gui-safe".to_string(),
            expires_in: Some(3600),
            scope: None,
            account_label: Some("Codex Test Account".to_string()),
        };
        let metadata = super::CodexAuthMetadata {
            provider: "openai".to_string(),
            account_label: "Bearer sk-raw-account-label-secret /Users/alice/.codex/auth.json cookie=session".to_string(),
            scopes: super::codex_scopes(),
            expires_at: expires_at.to_rfc3339(),
            redacted: "sk-raw-redacted-token-secret /Users/alice/.codex/auth.json cookie=session".to_string(),
            chat_base_url: super::CODEX_CHAT_BASE_URL.to_string(),
            chat_model: super::CODEX_CHAT_MODEL.to_string(),
            token_endpoint_url: super::CODEX_TOKEN_URL.to_string(),
        };
        super::store_codex_connection(dir, "openai", &token, &metadata)
            .await
            .unwrap();
    }

    async fn codex_secret_values(
        dir: &std::path::Path,
    ) -> (Option<String>, Option<String>, Option<String>) {
        let store = crate::secret_store::provider_secret_store(dir);
        (
            store
                .get_secret("openai", SecretKind::OAuthAccessToken)
                .await
                .unwrap(),
            store
                .get_secret("openai", SecretKind::OAuthRefreshToken)
                .await
                .unwrap(),
            store
                .get_secret("openai", SecretKind::AuthMetadata)
                .await
                .unwrap(),
        )
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

    #[test]
    fn codex_refresh_file_lock_timeout_has_persistence_budget() {
        assert_eq!(
            super::CODEX_REFRESH_FILE_LOCK_TIMEOUT,
            std::time::Duration::from_secs(10)
        );
        assert!(
            super::CODEX_REFRESH_FILE_LOCK_TIMEOUT
                > std::time::Duration::from_secs(super::CODEX_TOKEN_EXCHANGE_TIMEOUT_SECONDS)
                    + std::time::Duration::from_millis(500)
        );
    }

    #[tokio::test]
    async fn codex_secret_bundle_cleanup_attempts_all_deletes_after_first_failure() {
        let store = DeleteRecordingSecretStore::default();

        let error = super::delete_codex_secret_bundle(&store, "openai")
            .await
            .unwrap_err();

        assert!(matches!(error, ProviderAuthError::Storage));
        assert_eq!(
            store.attempts(),
            vec![
                SecretKind::OAuthAccessToken,
                SecretKind::OAuthRefreshToken,
                SecretKind::AuthMetadata,
            ]
        );
    }

    #[tokio::test]
    async fn default_start_without_test_flags_returns_login_unavailable_without_pending_state() {
        let dir = temp_dir();

        let response = super::start(&dir, "openai", super::ProviderAuthStartRequest::default())
            .await
            .unwrap();

        assert!(!response.configured);
        assert_eq!(response.status, "login_unavailable");
        assert_eq!(response.success, Some(false));
        assert!(!response.supports_login);
        assert!(super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
    }

    #[tokio::test]
    async fn start_rejects_unknown_secret_smuggling_fields_before_state_mutation() {
        let dir = temp_dir();

        for body in [
            r#"{"mock":true,"apiKey":"sk-secret"}"#,
            r#"{"mock":true,"provider":"openai"}"#,
            r#"{"mock":true,"model":"gpt-secret"}"#,
        ] {
            assert!(parse_start_request(body).is_err(), "accepted body: {body}");
        }

        assert!(super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
    }

    #[test]
    fn start_rejects_explicit_null_meaningful_fields() {
        for body in [
            r#"{"ttlSeconds":null}"#,
            r#"{"tokenEndpointUrl":null}"#,
            r#"{"chatEndpointUrl":null}"#,
            r#"{"experimentalCodexLike":true,"ttlSeconds":null}"#,
            r#"{"experimentalCodexLike":true,"tokenEndpointUrl":null}"#,
            r#"{"experimentalCodexLike":true,"chatEndpointUrl":null}"#,
        ] {
            assert!(parse_start_request(body).is_err(), "accepted body: {body}");
        }

        assert!(parse_start_request(r#"{}"#).is_ok());
        assert!(parse_start_request(r#"{"experimentalCodexLike":true}"#).is_ok());
    }

    #[tokio::test]
    async fn start_rejects_ttl_without_mock_or_experimental_before_state_mutation() {
        let dir = temp_dir();

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                ttl_seconds: Some(60),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        assert!(super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
    }

    #[test]
    fn exchange_rejects_unknown_fields() {
        assert!(parse_exchange_request(
            r#"{"sessionId":"mock-session","state":"mock-state","code":"mock-code","apiKey":"sk-secret"}"#,
        )
        .is_err());
    }

    #[test]
    fn exchange_rejects_explicit_null_fields_but_allows_omitted_fallback() {
        for body in [
            r#"{"sessionId":null}"#,
            r#"{"state":null}"#,
            r#"{"code":null}"#,
            r#"{"sessionId":null,"state":null,"code":null}"#,
            r#"{"sessionId":"mock-session","state":"mock-state","code":null}"#,
        ] {
            assert!(parse_exchange_request(body).is_err(), "accepted body: {body}");
        }

        assert!(parse_exchange_request(r#"{}"#).is_ok());
        assert!(parse_exchange_request(
            r#"{"sessionId":"mock-session","state":"mock-state","code":"mock-code"}"#,
        )
        .is_ok());
    }

    #[tokio::test]
    async fn mock_lifecycle_serialized_responses_are_sanitized() {
        let dir = temp_dir();
        let start = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let pending = super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .unwrap();
        let exchange = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest {
                session_id: Some(pending.session_id.clone()),
                state: Some(pending.state.clone()),
                code: Some(format!("mock-code-{}", pending.session_id)),
            },
        )
        .await
        .unwrap();
        let status = super::status(&dir, "openai").await.unwrap();
        let disconnect = super::disconnect(&dir, "openai").await.unwrap();

        let forbidden = [
            pending.verifier.as_str(),
            "fake-access-token",
            "fake-refresh-token",
            "mock-code-",
            "sk-test",
            "/Users/example/private/auth.json",
        ];
        for response in [&start, &exchange, &status, &disconnect] {
            assert_response_sanitized(response, &forbidden);
        }
    }

    #[tokio::test]
    async fn mock_exchange_session_mismatch_preserves_pending_for_retry() {
        let dir = temp_dir();
        let start = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let error = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest {
                session_id: start.session_id.clone(),
                state: Some("wrong-state".to_string()),
                code: Some("mock-code-retry".to_string()),
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::SessionMismatch));
        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "pending");
        assert_eq!(status.session_id, start.session_id);
    }

    #[tokio::test]
    async fn mock_exchange_expired_session_clears_pending_and_does_not_connect() {
        let dir = temp_dir();
        let start = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ttl_seconds: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let pending = super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;

        let error = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest {
                session_id: start.session_id,
                state: Some(pending.state),
                code: Some("mock-code-expired".to_string()),
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::SessionExpired));
        let state = super::read_mock_state(&dir, "openai").await.unwrap();
        assert!(state.pending.is_none());
        assert!(state.connected.is_none());
        assert_eq!(
            super::status(&dir, "openai").await.unwrap().status,
            "login_unavailable"
        );
    }

    #[tokio::test]
    async fn empty_exchange_returns_mock_pending_status_with_success_false() {
        let dir = temp_dir();
        let start = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let response = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest::default(),
        )
        .await
        .unwrap();

        assert_eq!(response.status, "pending");
        assert_eq!(response.session_id, start.session_id);
        assert_eq!(response.success, Some(false));
    }

    #[tokio::test]
    async fn empty_exchange_returns_mock_connected_status_with_success_false() {
        let dir = temp_dir();
        create_mock_connected_state(&dir).await;

        let response = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest::default(),
        )
        .await
        .unwrap();

        assert_eq!(response.status, "connected");
        assert_eq!(response.auth_source, "oauth");
        assert_eq!(response.success, Some(false));
    }

    #[tokio::test]
    async fn empty_exchange_preserves_api_key_and_no_state_shape_with_success_false() {
        let dir = temp_dir();
        let none = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest::default(),
        )
        .await
        .unwrap();
        assert_eq!(none.status, "login_unavailable");
        assert_eq!(none.auth_source, "none");
        assert_eq!(none.success, Some(false));

        let api_dir = temp_dir();
        create_openai_api_key_provider(&api_dir).await;
        let api_key = super::exchange(
            &api_dir,
            "openai",
            super::ProviderAuthExchangeRequest::default(),
        )
        .await
        .unwrap();
        assert_eq!(api_key.status, "api_key_configured");
        assert_eq!(api_key.auth_source, "api_key");
        assert_eq!(api_key.success, Some(false));
        assert_response_sanitized(&api_key, &["sk-test-api-key-secret"]);
    }

    #[tokio::test]
    async fn empty_exchange_returns_codex_pending_status_with_success_false() {
        let dir = temp_dir();
        let pending = create_codex_pending_state(&dir).await;

        let response = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest::default(),
        )
        .await
        .unwrap();

        assert_eq!(response.status, "pending");
        assert_eq!(
            response.session_id.as_deref(),
            Some(pending.session_id.as_str())
        );
        assert_eq!(response.success, Some(false));
    }

    #[tokio::test]
    async fn mock_start_replaces_stale_connected_with_new_pending() {
        let dir = temp_dir();
        create_mock_connected_state(&dir).await;

        let response = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let state = super::read_mock_state(&dir, "openai").await.unwrap();
        assert_eq!(response.status, "pending");
        assert!(state.pending.is_some());
        assert!(state.connected.is_none());
        assert_eq!(
            super::status(&dir, "openai").await.unwrap().status,
            "pending"
        );
    }

    #[tokio::test]
    async fn mock_start_replaces_existing_pending_with_new_pending() {
        let dir = temp_dir();
        let first = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let second = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(second.status, "pending");
        assert_ne!(second.session_id, first.session_id);
        let state = super::read_mock_state(&dir, "openai").await.unwrap();
        assert_eq!(
            state.pending.unwrap().session_id,
            second.session_id.unwrap()
        );
        assert!(state.connected.is_none());
    }

    #[tokio::test]
    async fn experimental_endpoint_overrides_require_explicit_loopback_path() {
        let dir = temp_dir();
        let unsafe_without_experimental = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                token_endpoint_url: Some("https://example.com/token".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(
            unsafe_without_experimental,
            ProviderAuthError::InvalidRequest
        ));

        let unsafe_with_experimental = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                experimental_codex_like: true,
                token_endpoint_url: Some("https://example.com/token".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(
            unsafe_with_experimental,
            ProviderAuthError::InvalidRequest
        ));

        let allowed = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                experimental_codex_like: true,
                token_endpoint_url: Some("http://127.0.0.1:3456/token".to_string()),
                chat_endpoint_url: Some("http://localhost:3456/chat".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(allowed.status, "pending");
        assert_eq!(allowed.success, Some(true));
    }

    #[tokio::test]
    async fn mock_start_rejects_endpoint_overrides_before_state_mutation() {
        let dir = temp_dir();

        let token_override = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                token_endpoint_url: Some("http://127.0.0.1:3456/token".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        let chat_override = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                chat_endpoint_url: Some("http://127.0.0.1:3456/chat".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(token_override, ProviderAuthError::InvalidRequest));
        assert!(matches!(chat_override, ProviderAuthError::InvalidRequest));
        assert!(super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
    }

    #[tokio::test]
    async fn mock_start_rejects_experimental_codex_like_before_state_mutation() {
        let dir = temp_dir();

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                experimental_codex_like: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        assert!(super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
    }

    #[tokio::test]
    async fn mock_start_rejects_existing_codex_oauth_secrets_without_mutation() {
        let dir = temp_dir();
        create_codex_oauth_connection(&dir).await;
        let before = codex_secret_values(&dir).await;

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        let mock = super::read_mock_state(&dir, "openai").await.unwrap();
        assert!(mock.pending.is_none());
        assert!(mock.connected.is_none());
        assert_eq!(codex_secret_values(&dir).await, before);
        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "connected");
        assert_ne!(status.redacted.as_deref(), Some("mock-oauth-...connected"));
    }

    #[tokio::test]
    async fn codex_start_rejects_existing_connected_secrets_without_mutation() {
        let dir = temp_dir();
        create_codex_oauth_connection(&dir).await;
        let before = codex_secret_values(&dir).await;

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                experimental_codex_like: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert_eq!(codex_secret_values(&dir).await, before);
        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "connected");
        assert_eq!(status.account_label.as_deref(), Some("Codex Test Account"));
    }

    #[tokio::test]
    async fn codex_start_rejects_existing_expired_secrets_without_mutation() {
        let dir = temp_dir();
        create_expired_codex_oauth_connection(&dir).await;
        let before = codex_secret_values(&dir).await;

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                experimental_codex_like: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert_eq!(codex_secret_values(&dir).await, before);
        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "expired");
        assert_eq!(status.account_label.as_deref(), Some("Codex Test Account"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_start_fails_closed_on_secret_read_failure_without_pending_state() {
        let dir = temp_dir();
        let secret_dir = dir.join("provider-secrets").join("openai");
        std::fs::create_dir_all(&secret_dir).unwrap();
        let outside = temp_dir();
        std::fs::write(&outside, "codex-access-token-secret-must-not-leak").unwrap();
        std::os::unix::fs::symlink(&outside, secret_dir.join("oauth-access-token.json")).unwrap();

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                experimental_codex_like: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::Storage));
        let message = error.to_string();
        assert_eq!(message, "provider auth storage error");
        assert!(!message.contains("codex-access-token-secret-must-not-leak"));
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
    }

    #[tokio::test]
    async fn codex_start_rejects_existing_pending_even_with_secrets_and_status_is_pending() {
        let dir = temp_dir();
        let codex = create_codex_pending_state(&dir).await;
        create_codex_oauth_connection(&dir).await;
        let before = codex_secret_values(&dir).await;

        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "pending");
        assert_eq!(
            status.session_id.as_deref(),
            Some(codex.session_id.as_str())
        );

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                experimental_codex_like: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        let pending = super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .unwrap();
        assert_eq!(pending.session_id, codex.session_id);
        assert_eq!(codex_secret_values(&dir).await, before);
        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "pending");
        assert_eq!(
            status.session_id.as_deref(),
            Some(codex.session_id.as_str())
        );
    }

    #[tokio::test]
    async fn mock_start_rejects_existing_codex_pending_without_mutation() {
        let dir = temp_dir();
        let codex = create_codex_pending_state(&dir).await;

        let error = super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        let mock = super::read_mock_state(&dir, "openai").await.unwrap();
        assert!(mock.pending.is_none());
        assert!(mock.connected.is_none());
        let pending = super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .unwrap();
        assert_eq!(pending.session_id, codex.session_id);
    }

    #[tokio::test]
    async fn mock_exchange_rejects_codex_secrets_race_and_does_not_mask_status() {
        let dir = temp_dir();
        super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let pending = super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .unwrap();
        create_codex_oauth_connection(&dir).await;
        let before = codex_secret_values(&dir).await;

        let error = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest {
                session_id: Some(pending.session_id.clone()),
                state: Some(pending.state.clone()),
                code: Some(format!("mock-code-{}", pending.session_id)),
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        let mock = super::read_mock_state(&dir, "openai").await.unwrap();
        assert!(mock.pending.is_none());
        assert!(mock.connected.is_none());
        assert_eq!(codex_secret_values(&dir).await, before);
        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "connected");
        assert_ne!(status.redacted.as_deref(), Some("mock-oauth-...connected"));
    }

    #[tokio::test]
    async fn openai_status_prioritizes_codex_over_stale_mock_connected_state() {
        let dir = temp_dir();
        super::write_mock_state(
            &dir,
            "openai",
            &super::MockOAuthState {
                pending: None,
                connected: Some(super::MockOAuthConnection {
                    provider: "openai".to_string(),
                    account_label: "Mock OAuth Account".to_string(),
                    scopes: vec!["mock:chat".to_string()],
                    expires_at: (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339(),
                    access_token: "fake-access-token".to_string(),
                    refresh_token: "fake-refresh-token".to_string(),
                }),
            },
        )
        .await
        .unwrap();
        create_codex_oauth_connection(&dir).await;

        let status = super::status(&dir, "openai").await.unwrap();

        assert_eq!(status.status, "connected");
        assert_eq!(status.account_label.as_deref(), Some("Codex Test Account"));
        assert_ne!(status.redacted.as_deref(), Some("mock-oauth-...connected"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_exchange_rolls_back_secrets_when_pending_clear_fails() {
        let dir = temp_dir();
        let state_path = super::provider_auth_state_path(&dir, "provider-auth-openai", "openai")
            .unwrap();
        let outside = temp_dir();
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("outside.json");
        std::fs::write(&target, "{}").unwrap();
        let token_endpoint_url = successful_codex_token_endpoint_with_hook({
            let state_path = state_path.clone();
            let target = target.clone();
            move || {
                std::fs::remove_file(&state_path).unwrap();
                std::os::unix::fs::symlink(&target, &state_path).unwrap();
            }
        })
        .await;
        let pending = create_codex_pending_state_with_token_endpoint(&dir, &token_endpoint_url).await;

        let error = super::exchange(
            &dir,
            "openai",
            super::ProviderAuthExchangeRequest {
                session_id: Some(pending.session_id),
                state: Some(pending.state),
                code: Some("codex-auth-code".to_string()),
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::Storage));
        let message = error.to_string();
        assert_eq!(message, "provider auth storage error");
        assert!(!message.contains("codex-exchange-access-token-secret"));
        assert!(!message.contains("codex-exchange-refresh-token-secret"));
        assert_eq!(codex_secret_values(&dir).await, (None, None, None));
        assert!(std::fs::symlink_metadata(&state_path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(target).unwrap(), "{}");
    }

    #[tokio::test]
    async fn codex_token_endpoint_malicious_scope_fails_closed_without_leak() {
        for malicious_scope in [
            "openid sk-raw-token-secret-abcd",
            "openid eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2NvdW50In0.signature1",
            "openid account_opaque_12345",
            "openid secret/codex-access-token-secret-abcd",
        ] {
            let token = super::CodexTokenResponse {
                access_token: "codex-access-token-secret-abcd".to_string(),
                refresh_token: "codex-refresh-token-secret-wxyz".to_string(),
                expires_in: Some(3600),
                scope: Some(malicious_scope.to_string()),
                account_label: Some("Codex Test Account".to_string()),
            };

            let error = super::codex_token_scopes(token.scope.as_deref(), &super::codex_scopes())
                .unwrap_err();

            assert!(matches!(error, ProviderAuthError::TokenExchange));
            let message = error.to_string();
            assert_eq!(message, "provider auth token exchange failed");
            assert!(!message.contains("codex-access-token-secret-abcd"));
            assert!(!message.contains(malicious_scope));
            let serialized = serde_json::to_string(&serde_json::json!({ "error": message })).unwrap();
            assert!(!serialized.contains(malicious_scope));
            assert!(!serialized.contains("sk-raw-token-secret-abcd"));
            assert!(!serialized.contains("eyJhbGciOiJIUzI1NiJ9"));
            assert!(!serialized.contains("account_opaque_12345"));
        }
    }

    #[test]
    fn codex_token_scope_subset_is_deduped_in_requested_order() {
        let scopes = super::codex_token_scopes(
            Some("email openid email offline_access"),
            &super::codex_scopes(),
        )
        .unwrap();

        assert_eq!(scopes, vec!["openid", "email", "offline_access"]);
        assert_eq!(
            super::codex_token_scopes(None, &super::codex_scopes()).unwrap(),
            super::codex_scopes()
        );
    }

    #[tokio::test]
    async fn malicious_stored_codex_metadata_scope_is_not_gui_facing() {
        let dir = temp_dir();
        let malicious_scope = "secret/codex-refresh-token-secret";
        create_malicious_codex_metadata_scope(&dir, malicious_scope).await;

        let error = super::status(&dir, "openai").await.unwrap_err();

        assert!(matches!(error, ProviderAuthError::Storage));
        let message = error.to_string();
        assert_eq!(message, "provider auth storage error");
        assert!(!message.contains(malicious_scope));
        assert!(!message.contains("codex-refresh-token-secret"));
    }

    #[tokio::test]
    async fn malicious_stored_codex_metadata_gui_fields_are_resanitized_for_connected_status() {
        let dir = temp_dir();
        create_malicious_codex_metadata_gui_fields(
            &dir,
            chrono::Utc::now() + chrono::Duration::hours(1),
        )
        .await;

        let status = super::status(&dir, "openai").await.unwrap();

        assert_eq!(status.status, "connected");
        assert_eq!(status.account_label.as_deref(), Some("OpenAI account"));
        assert_eq!(
            status.redacted.as_deref(),
            Some(crate::secret_store::redact_secret("codex-access-token-secret-gui-safe").as_str())
        );
        assert_response_sanitized(
            &status,
            &[
                "sk-raw-account-label-secret",
                "sk-raw-redacted-token-secret",
                "/Users/alice/.codex/auth.json",
                "cookie=session",
            ],
        );
    }

    #[tokio::test]
    async fn malicious_stored_codex_metadata_gui_fields_are_resanitized_for_expired_status() {
        let dir = temp_dir();
        create_malicious_codex_metadata_gui_fields(
            &dir,
            chrono::Utc::now() - chrono::Duration::hours(1),
        )
        .await;

        let status = super::status(&dir, "openai").await.unwrap();

        assert_eq!(status.status, "expired");
        assert_eq!(status.account_label.as_deref(), Some("OpenAI account"));
        assert_eq!(
            status.redacted.as_deref(),
            Some(crate::secret_store::redact_secret("codex-access-token-secret-gui-safe").as_str())
        );
        assert_response_sanitized(
            &status,
            &[
                "sk-raw-account-label-secret",
                "sk-raw-redacted-token-secret",
                "/Users/alice/.codex/auth.json",
                "cookie=session",
            ],
        );
    }

    #[tokio::test]
    async fn refresh_token_reused_clears_codex_secrets_and_pending_without_leak() {
        let dir = temp_dir();
        let token_endpoint_url = refresh_token_reused_loopback_endpoint().await;
        create_expired_codex_pending_state(&dir).await;
        create_near_expired_codex_oauth_connection_with_token_endpoint(&dir, &token_endpoint_url)
            .await;

        let error = super::refresh_experimental_codex_chat_auth_if_needed(&dir)
            .await
            .unwrap_err();

        assert!(matches!(error, ProviderAuthError::TokenExchange));
        let message = error.to_string();
        assert_eq!(message, "provider auth token exchange failed");
        assert!(!message.contains("codex-access-token-secret"));
        assert!(!message.contains("codex-refresh-token-secret"));
        assert_eq!(codex_secret_values(&dir).await, (None, None, None));
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        let status = super::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "login_unavailable");
        assert!(!status.configured);
        assert_response_sanitized(
            &status,
            &[
                "codex-access-token-secret",
                "codex-refresh-token-secret",
                "refresh_token_reused",
            ],
        );
    }

    #[tokio::test]
    async fn stored_codex_chat_model_secret_like_values_fail_closed() {
        for chat_model in [
            "sk-raw-chat-model-secret",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2NvdW50In0.signature1",
            "access_token=codex-access-token-secret",
            "/Users/example/auth.json",
        ] {
            let dir = temp_dir();
            create_codex_oauth_connection_with_chat_model(&dir, chat_model).await;

            let auth = super::experimental_codex_chat_auth(&dir).await.unwrap();
            assert!(auth.is_none(), "accepted chat model: {chat_model}");

            let error = super::refresh_experimental_codex_chat_auth_if_needed(&dir)
                .await
                .unwrap_err();
            assert!(matches!(error, ProviderAuthError::Storage));
            let message = error.to_string();
            assert_eq!(message, "provider auth storage error");
            assert!(!message.contains(chat_model));
            assert!(!message.contains("codex-access-token-secret"));
        }
    }

    #[tokio::test]
    async fn stored_codex_default_chat_endpoint_requires_exact_default_model() {
        let dir = temp_dir();
        create_codex_oauth_connection_with_expiry_and_metadata(
            &dir,
            chrono::Utc::now() + chrono::Duration::hours(1),
            |_, metadata| metadata.chat_model = "gpt-5-codex-safe-alt".to_string(),
        )
        .await;

        let auth = super::experimental_codex_chat_auth(&dir).await.unwrap();
        assert!(auth.is_none());

        let error = super::refresh_experimental_codex_chat_auth_if_needed(&dir)
            .await
            .unwrap_err();
        assert!(matches!(error, ProviderAuthError::Storage));
    }

    #[tokio::test]
    async fn stored_codex_loopback_chat_endpoint_allows_safe_alt_model() {
        let dir = temp_dir();
        create_codex_oauth_connection_with_expiry_and_metadata(
            &dir,
            chrono::Utc::now() + chrono::Duration::hours(1),
            |_, metadata| {
                metadata.chat_base_url = "http://127.0.0.1:3456/codex".to_string();
                metadata.chat_model = "gpt-5-codex-safe-alt".to_string();
            },
        )
        .await;

        let auth = super::experimental_codex_chat_auth(&dir)
            .await
            .unwrap()
            .expect("loopback safe alt model should be accepted");
        assert_eq!(auth.base_url, "http://127.0.0.1:3456/codex");
        assert_eq!(auth.model, "gpt-5-codex-safe-alt");
    }

    #[tokio::test]
    async fn experimental_codex_like_is_rejected_for_non_openai_provider() {
        let dir = temp_dir();

        let error = super::start(
            &dir,
            "openai-compatible",
            super::ProviderAuthStartRequest {
                experimental_codex_like: true,
                ..Default::default()
            },
        )
        .await
        .unwrap_err();

        assert!(matches!(error, ProviderAuthError::InvalidRequest));
        assert!(super::read_codex_state(&dir, "openai-compatible")
            .await
            .unwrap()
            .pending
            .is_none());
    }

    #[tokio::test]
    async fn disconnect_preserves_api_key_fallback_after_mock_state() {
        let dir = temp_dir();
        create_openai_api_key_provider(&dir).await;
        super::start(
            &dir,
            "openai",
            super::ProviderAuthStartRequest {
                mock: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let response = super::disconnect(&dir, "openai").await.unwrap();

        assert!(response.configured);
        assert_eq!(response.status, "api_key_configured");
        assert_eq!(response.auth_source, "api_key");
        assert_eq!(response.success, Some(true));
        assert_response_sanitized(&response, &["sk-test-api-key-secret"]);
    }

    #[tokio::test]
    async fn disconnect_clears_directly_mixed_mock_and_codex_state_without_api_key() {
        let dir = temp_dir();
        create_mock_connected_state(&dir).await;
        create_codex_pending_state(&dir).await;
        create_codex_oauth_connection(&dir).await;

        let response = super::disconnect(&dir, "openai").await.unwrap();

        assert!(!response.configured);
        assert_eq!(response.status, "revoked");
        assert_eq!(response.auth_source, "none");
        assert_eq!(response.success, Some(true));
        assert!(super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert!(super::read_mock_state(&dir, "openai")
            .await
            .unwrap()
            .connected
            .is_none());
        assert!(super::read_codex_state(&dir, "openai")
            .await
            .unwrap()
            .pending
            .is_none());
        assert!(!super::codex_has_secrets(&dir, "openai").await.unwrap());
        assert_eq!(
            super::status(&dir, "openai").await.unwrap().status,
            "login_unavailable"
        );
    }

    #[tokio::test]
    async fn disconnect_clears_directly_mixed_mock_and_codex_state_with_api_key_fallback() {
        let dir = temp_dir();
        create_openai_api_key_provider(&dir).await;
        create_mock_connected_state(&dir).await;
        create_codex_pending_state(&dir).await;
        create_codex_oauth_connection(&dir).await;

        let response = super::disconnect(&dir, "openai").await.unwrap();

        assert!(response.configured);
        assert_eq!(response.status, "api_key_configured");
        assert_eq!(response.auth_source, "api_key");
        assert_eq!(response.success, Some(true));
        assert!(!super::codex_has_secrets(&dir, "openai").await.unwrap());
        assert_eq!(
            super::status(&dir, "openai").await.unwrap().status,
            "api_key_configured"
        );
        assert_response_sanitized(
            &response,
            &["sk-test-api-key-secret", "codex-access-token-secret"],
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_refresh_lock_rejects_directory_symlink_escape() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("provider-auth-openai")).unwrap();

        assert!(matches!(
            super::acquire_codex_refresh_file_lock(&dir, "openai").await,
            Err(ProviderAuthError::Storage)
        ));
        assert!(std::fs::read_dir(outside).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_refresh_lock_rejects_final_file_symlink() {
        let dir = temp_dir();
        let outside = temp_dir();
        let path = super::codex_refresh_lock_path(&dir, "openai").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("outside.lock");
        std::fs::write(&target, "outside").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();

        assert!(matches!(
            super::acquire_codex_refresh_file_lock(&dir, "openai").await,
            Err(ProviderAuthError::Storage)
        ));
        assert_eq!(std::fs::read_to_string(target).unwrap(), "outside");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_refresh_lock_times_out_when_already_locked() {
        use std::os::unix::fs::OpenOptionsExt;

        let dir = temp_dir();
        let path = super::codex_refresh_lock_path(&dir, "openai").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        let rc = unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&file), libc::LOCK_EX) };
        assert_eq!(rc, 0);

        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(100),
            super::acquire_codex_refresh_file_lock(&dir, "openai")
        )
        .await
        .is_err());
        let _ = unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&file), libc::LOCK_UN) };
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_refresh_lock_waits_beyond_legacy_timeout_and_succeeds() {
        use std::os::unix::fs::OpenOptionsExt;

        let dir = temp_dir();
        let path = super::codex_refresh_lock_path(&dir, "openai").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        let rc = unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&file), libc::LOCK_EX) };
        assert_eq!(rc, 0);
        let unlock_file = file.try_clone().unwrap();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let _ = unsafe {
                libc::flock(std::os::fd::AsRawFd::as_raw_fd(&unlock_file), libc::LOCK_UN)
            };
        });

        let started = std::time::Instant::now();
        let _guard = super::acquire_codex_refresh_file_lock(&dir, "openai")
            .await
            .unwrap();
        let elapsed = started.elapsed();
        assert!(elapsed >= std::time::Duration::from_millis(250));
        assert!(elapsed < std::time::Duration::from_secs(2));
    }

    #[tokio::test]
    async fn provider_auth_state_missing_and_corrupt_are_safe() {
        let dir = temp_dir();
        let missing = super::read_codex_state(&dir, "openai").await.unwrap();
        assert!(missing.pending.is_none());

        let path = super::provider_auth_state_path(&dir, "provider-auth-openai", "openai").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"pending":{"state":"codex-state-secret-abcd""#).unwrap();
        assert!(matches!(
            super::read_codex_state(&dir, "openai").await,
            Err(ProviderAuthError::Storage)
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn provider_auth_state_writes_private_directory_and_file_modes() {
        let dir = temp_dir();
        super::write_codex_state(&dir, "openai", &CodexOAuthState::default())
            .await
            .unwrap();
        let root = dir.join("provider-auth-openai");
        let path = super::provider_auth_state_path(&dir, "provider-auth-openai", "openai").unwrap();

        assert_eq!(file_mode(&root), 0o700);
        assert_eq!(file_mode(&path), 0o600);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn provider_auth_state_rejects_directory_symlink_escape() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("provider-auth-openai")).unwrap();

        assert!(matches!(
            super::write_codex_state(&dir, "openai", &CodexOAuthState::default()).await,
            Err(ProviderAuthError::Storage)
        ));
        assert!(!outside.join("openai.json").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn provider_auth_state_rejects_config_dir_symlink_escape_for_read_and_write() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, &dir).unwrap();

        assert!(matches!(
            super::read_codex_state(&dir, "openai").await,
            Err(ProviderAuthError::Storage)
        ));
        assert!(matches!(
            super::write_codex_state(&dir, "openai", &CodexOAuthState::default()).await,
            Err(ProviderAuthError::Storage)
        ));
        assert!(std::fs::read_dir(outside).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn provider_auth_state_rejects_intermediate_ancestor_symlink_escape_for_read_and_write() {
        let root = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let config_dir = root.join("link").join("config");

        assert!(matches!(
            super::read_codex_state(&config_dir, "openai").await,
            Err(ProviderAuthError::Storage)
        ));
        assert!(matches!(
            super::write_codex_state(&config_dir, "openai", &CodexOAuthState::default()).await,
            Err(ProviderAuthError::Storage)
        ));
        assert!(std::fs::read_dir(outside).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn provider_auth_state_rejects_final_file_symlink_and_cleans_temp() {
        let dir = temp_dir();
        let outside = temp_dir();
        let path = super::provider_auth_state_path(&dir, "provider-auth-openai", "openai").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("outside.json");
        std::fs::write(&target, "{}").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();

        assert!(matches!(
            super::write_codex_state(&dir, "openai", &CodexOAuthState::default()).await,
            Err(ProviderAuthError::Storage)
        ));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "{}");
        let temp_files: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(temp_files.is_empty());
    }
}

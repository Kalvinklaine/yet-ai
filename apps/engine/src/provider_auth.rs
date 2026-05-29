use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use base64::Engine;
use chrono::{Duration, Utc};
use http::StatusCode;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::providers::{self, AuthType, ProviderKind, StoredProviderConfig};
use crate::secret_store::{FileSecretStore, ProviderSecretStore, SecretKind, SecretStoreError};

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
static MOCK_COUNTER: AtomicU64 = AtomicU64::new(1);
static PROVIDER_AUTH_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static CODEX_EXCHANGE_IN_FLIGHT: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

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
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthStartRequest {
    #[serde(default)]
    pub mock: bool,
    #[serde(default)]
    pub experimental_codex_like: bool,
    pub ttl_seconds: Option<i64>,
    pub token_endpoint_url: Option<String>,
    pub chat_endpoint_url: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthExchangeRequest {
    pub session_id: Option<String>,
    pub state: Option<String>,
    pub code: Option<String>,
}

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

pub async fn status(
    config_dir: &Path,
    provider: &str,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let provider = normalize_supported_provider(provider)?;
    let mock = read_mock_state(config_dir, provider).await?;
    if let Some(connection) = mock.connected {
        if parse_time(&connection.expires_at)? > Utc::now() {
            return Ok(mock_connected_response(
                provider,
                connection.scopes,
                Some(true),
            ));
        }
    }
    if let Some(session) = mock.pending {
        if parse_time(&session.expires_at)? > Utc::now() {
            return Ok(mock_pending_response(provider, &session, None));
        }
    }
    if provider == "openai" {
        if let Some(response) = codex_connected_status(config_dir, provider).await? {
            return Ok(response);
        }
        let codex = read_codex_state(config_dir, provider).await?;
        if let Some(session) = codex.pending {
            if parse_time(&session.expires_at)? > Utc::now() {
                return Ok(codex_pending_response(provider, &session, None));
            }
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
    if request.mock {
        let ttl_seconds = validate_ttl_seconds(request.ttl_seconds.unwrap_or(MOCK_TTL_SECONDS))?;
        let session = new_mock_session(provider, ttl_seconds);
        let mut state = read_mock_state(config_dir, provider).await?;
        state.pending = Some(session.clone());
        write_mock_state(config_dir, provider, &state).await?;
        return Ok(mock_pending_response(provider, &session, Some(true)));
    }
    if request.experimental_codex_like && provider == "openai" {
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

pub async fn exchange(
    config_dir: &Path,
    provider: &str,
    request: ProviderAuthExchangeRequest,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let provider = normalize_supported_provider(provider)?;
    if request.session_id.is_none() && request.state.is_none() && request.code.is_none() {
        return Ok(status_response(
            provider,
            configured_api_key(config_dir, provider).await?,
            Some(false),
        ));
    }
    let session_id = required_value(request.session_id)?;
    let state_value = required_value(request.state)?;
    let code = required_value(request.code)?;
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
    if mock.pending.is_some() || mock.connected.is_some() {
        write_mock_state(config_dir, provider, &MockOAuthState::default()).await?;
        let mut response = status_response(provider, None, Some(true));
        response.status = "revoked";
        response.message = MOCK_DISCONNECTED_MESSAGE.to_string();
        return Ok(response);
    }
    if provider == "openai" {
        let codex = read_codex_state(config_dir, provider).await?;
        let had_codex = codex.pending.is_some() || codex_has_secrets(config_dir, provider).await?;
        if had_codex {
            write_codex_state(config_dir, provider, &CodexOAuthState::default()).await?;
            delete_codex_secrets(config_dir, provider).await?;
            let configured = configured_api_key(config_dir, provider).await?;
            let mut response = status_response(provider, configured, Some(true));
            if response.configured {
                response.message = DISCONNECT_MESSAGE.to_string();
            } else {
                response.status = "revoked";
                response.message = DISCONNECT_MESSAGE.to_string();
            }
            return Ok(response);
        }
    }
    let configured = configured_api_key(config_dir, provider).await?;
    let mut response = status_response(provider, configured, Some(true));
    if response.configured {
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
    let value = value.trim();
    let parsed = reqwest::Url::parse(value).map_err(|_| ProviderAuthError::InvalidRequest)?;
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
    if token.access_token.trim().is_empty() {
        codex.pending = Some(session);
        write_codex_state(config_dir, provider, &codex).await?;
        return Err(ProviderAuthError::TokenExchange);
    }
    let scopes = token
        .scope
        .as_deref()
        .map(|value| value.split_whitespace().map(str::to_string).collect())
        .unwrap_or_else(|| session.scopes.clone());
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
    };
    store_codex_connection(config_dir, provider, &token, &metadata).await?;
    write_codex_state(config_dir, provider, &CodexOAuthState::default()).await?;
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
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(
        CODEX_TOKEN_EXCHANGE_TIMEOUT_SECONDS,
    ));
    if reqwest::Url::parse(&session.token_endpoint_url)
        .ok()
        .is_some_and(|url| is_allowed_loopback_host(&url))
    {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|_| ProviderAuthError::TokenExchange)?;
    let response = client
        .post(&session.token_endpoint_url)
        .json(&body)
        .send()
        .await
        .map_err(|_| ProviderAuthError::TokenExchange)?;
    if !response.status().is_success() {
        return Err(ProviderAuthError::TokenExchange);
    }
    response
        .json::<CodexTokenResponse>()
        .await
        .map_err(|_| ProviderAuthError::TokenExchange)
}

fn validate_codex_token_expires_in(value: Option<i64>) -> Result<i64, ProviderAuthError> {
    let value = value.unwrap_or(CODEX_TOKEN_DEFAULT_EXPIRES_IN_SECONDS);
    if value <= 0 || value > MAX_CODEX_TOKEN_EXPIRES_IN_SECONDS {
        return Err(ProviderAuthError::TokenExchange);
    }
    Ok(value)
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
    let store = FileSecretStore::new(config_dir);
    let prior_access = store
        .get_secret(provider, SecretKind::OAuthAccessToken)
        .await?;
    let prior_refresh = store
        .get_secret(provider, SecretKind::OAuthRefreshToken)
        .await?;
    let prior_metadata = store.get_secret(provider, SecretKind::AuthMetadata).await?;
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
        restore_codex_secret(&store, provider, SecretKind::OAuthAccessToken, prior_access).await?;
        restore_codex_secret(
            &store,
            provider,
            SecretKind::OAuthRefreshToken,
            prior_refresh,
        )
        .await?;
        restore_codex_secret(&store, provider, SecretKind::AuthMetadata, prior_metadata).await?;
    }
    result
}

async fn restore_codex_secret(
    store: &FileSecretStore,
    provider: &str,
    kind: SecretKind,
    value: Option<String>,
) -> Result<(), ProviderAuthError> {
    match value {
        Some(value) => store.put_secret(provider, kind, &value).await?,
        None => store.delete_secret(provider, kind).await?,
    }
    Ok(())
}

async fn codex_connected_status(
    config_dir: &Path,
    provider: &str,
) -> Result<Option<ProviderAuthResponse>, ProviderAuthError> {
    let store = FileSecretStore::new(config_dir);
    let Some(metadata) = store.get_secret(provider, SecretKind::AuthMetadata).await? else {
        return Ok(None);
    };
    let metadata: CodexAuthMetadata =
        serde_json::from_str(&metadata).map_err(|_| ProviderAuthError::Storage)?;
    validate_codex_metadata(provider, &metadata)?;
    if !codex_has_complete_secrets(&store, provider).await? {
        return Ok(None);
    }
    if parse_time(&metadata.expires_at)? <= Utc::now() {
        return Ok(Some(codex_expired_response(provider, metadata)));
    }
    Ok(Some(codex_connected_response(provider, metadata, None)))
}

pub async fn experimental_codex_chat_auth(
    config_dir: &Path,
) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
    let provider = "openai";
    let store = FileSecretStore::new(config_dir);
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

async fn codex_has_complete_secrets(
    store: &FileSecretStore,
    provider: &str,
) -> Result<bool, ProviderAuthError> {
    let has_access = store
        .get_secret(provider, SecretKind::OAuthAccessToken)
        .await?
        .is_some_and(|value| !value.trim().is_empty());
    let has_refresh = store
        .get_secret(provider, SecretKind::OAuthRefreshToken)
        .await?
        .is_some_and(|value| !value.trim().is_empty());
    Ok(has_access && has_refresh)
}

fn validate_codex_metadata(
    provider: &str,
    metadata: &CodexAuthMetadata,
) -> Result<(), ProviderAuthError> {
    if metadata.provider != provider {
        return Err(ProviderAuthError::Storage);
    }
    if metadata.chat_base_url.trim_end_matches('/') == CODEX_CHAT_BASE_URL {
        return Ok(());
    }
    validate_experimental_endpoint_url(&metadata.chat_base_url, true).map(|_| ())
}

fn default_codex_chat_base_url() -> String {
    CODEX_CHAT_BASE_URL.to_string()
}

fn default_codex_chat_model() -> String {
    CODEX_CHAT_MODEL.to_string()
}

async fn codex_has_secrets(config_dir: &Path, provider: &str) -> Result<bool, ProviderAuthError> {
    let store = FileSecretStore::new(config_dir);
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

async fn delete_codex_secrets(config_dir: &Path, provider: &str) -> Result<(), ProviderAuthError> {
    let store = FileSecretStore::new(config_dir);
    for kind in [
        SecretKind::OAuthAccessToken,
        SecretKind::OAuthRefreshToken,
        SecretKind::AuthMetadata,
    ] {
        store.delete_secret(provider, kind).await?;
    }
    Ok(())
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

fn required_value(value: Option<String>) -> Result<String, ProviderAuthError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or(ProviderAuthError::InvalidRequest)
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
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| ProviderAuthError::Storage)?;
    ensure_provider_auth_root(root, true).await.map(|_| ())
}

async fn ensure_existing_provider_auth_directory(path: &Path) -> Result<(), ProviderAuthError> {
    let root = path.parent().ok_or(ProviderAuthError::Storage)?;
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
            set_private_directory_permissions(root).await?;
            Ok(true)
        }
        Err(_) => Err(ProviderAuthError::Storage),
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

    #[cfg(unix)]
    fn file_mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::symlink_metadata(path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777
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

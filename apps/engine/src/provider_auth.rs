use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{Duration, Utc};
use http::StatusCode;
use serde::{Deserialize, Serialize};

use crate::providers::{self, AuthType, ProviderKind, StoredProviderConfig};

const LOGIN_UNAVAILABLE_MESSAGE: &str = "OpenAI account login is not available for this local provider path. Create an API key in the provider console and paste it once into Yet AI.";
const API_KEY_CONFIGURED_MESSAGE: &str = "API-key authentication is configured locally.";
const DISCONNECT_MESSAGE: &str = "Provider login credentials were disconnected and removed from local engine storage. API-key provider configuration was left unchanged.";
const MOCK_PENDING_MESSAGE: &str = "Mock OAuth login is pending in local test state.";
const MOCK_CONNECTED_MESSAGE: &str = "Mock OAuth login is connected in local test state.";
const MOCK_DISCONNECTED_MESSAGE: &str = "Mock OAuth login state was disconnected and removed from local test state.";
const MOCK_TTL_SECONDS: i64 = 600;
static MOCK_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthStartRequest {
    #[serde(default)]
    pub mock: bool,
    pub ttl_seconds: Option<i64>,
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
        }
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

pub async fn status(
    config_dir: &Path,
    provider: &str,
) -> Result<ProviderAuthResponse, ProviderAuthError> {
    let provider = normalize_supported_provider(provider)?;
    let mock = read_mock_state(config_dir, provider).await?;
    if let Some(connection) = mock.connected {
        if parse_time(&connection.expires_at)? > Utc::now() {
            return Ok(mock_connected_response(provider, connection.scopes, Some(true)));
        }
    }
    if let Some(session) = mock.pending {
        if parse_time(&session.expires_at)? > Utc::now() {
            return Ok(mock_pending_response(provider, &session, None));
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
        let session = new_mock_session(provider, request.ttl_seconds.unwrap_or(MOCK_TTL_SECONDS));
        let mut state = read_mock_state(config_dir, provider).await?;
        state.pending = Some(session.clone());
        write_mock_state(config_dir, provider, &state).await?;
        return Ok(mock_pending_response(provider, &session, Some(true)));
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
    if !code.starts_with("mock-code-") {
        return Err(ProviderAuthError::InvalidRequest);
    }

    let mut mock = read_mock_state(config_dir, provider).await?;
    let Some(session) = mock.pending.take() else {
        return Err(ProviderAuthError::SessionNotFound);
    };
    if session.provider != provider || session.session_id != session_id || session.state != state_value {
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

fn mock_state_path(config_dir: &Path, provider: &str) -> PathBuf {
    config_dir
        .join("provider-auth-mock")
        .join(format!("{provider}.json"))
}

async fn read_mock_state(
    config_dir: &Path,
    provider: &str,
) -> Result<MockOAuthState, ProviderAuthError> {
    let path = mock_state_path(config_dir, provider);
    match tokio::fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| ProviderAuthError::Storage),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(MockOAuthState::default()),
        Err(_) => Err(ProviderAuthError::Storage),
    }
}

async fn write_mock_state(
    config_dir: &Path,
    provider: &str,
    state: &MockOAuthState,
) -> Result<(), ProviderAuthError> {
    let path = mock_state_path(config_dir, provider);
    let parent = path.parent().ok_or(ProviderAuthError::Storage)?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| ProviderAuthError::Storage)?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|_| ProviderAuthError::Storage)?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|_| ProviderAuthError::Storage)
}

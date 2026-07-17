use http::StatusCode;
use serde::{Deserialize, Serialize};

use crate::providers;
use crate::secret_store::SecretStoreError;

use super::validation::deserialize_optional_non_null;

pub(super) struct CodexExchangeGuard {
    pub(super) key: String,
}

impl Drop for CodexExchangeGuard {
    fn drop(&mut self) {
        if let Ok(mut keys) = super::CODEX_EXCHANGE_IN_FLIGHT.lock() {
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
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
    #[error("provider auth callback listener is unavailable")]
    CallbackUnavailable,
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
            Self::CallbackUnavailable => StatusCode::SERVICE_UNAVAILABLE,
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
pub(super) struct MockOAuthState {
    pub(super) pending: Option<MockOAuthSession>,
    pub(super) connected: Option<MockOAuthConnection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct MockOAuthSession {
    pub(super) provider: String,
    pub(super) session_id: String,
    pub(super) state: String,
    pub(super) verifier: String,
    pub(super) challenge: String,
    pub(super) expires_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MockOAuthConnection {
    pub(super) provider: String,
    pub(super) account_label: String,
    pub(super) scopes: Vec<String>,
    pub(super) expires_at: String,
    pub(super) access_token: String,
    pub(super) refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexOAuthState {
    pub(super) pending: Option<CodexOAuthSession>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexOAuthSession {
    pub(super) provider: String,
    pub(super) session_id: String,
    pub(super) state: String,
    pub(super) verifier: String,
    pub(super) challenge: String,
    pub(super) expires_at: String,
    pub(super) scopes: Vec<String>,
    pub(super) token_endpoint_url: String,
    pub(super) chat_base_url: String,
    pub(super) chat_model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexAuthMetadata {
    pub(super) provider: String,
    pub(super) account_label: String,
    pub(super) scopes: Vec<String>,
    pub(super) expires_at: String,
    pub(super) redacted: String,
    pub(super) chatgpt_account_id: String,
    pub(super) chat_base_url: String,
    pub(super) chat_model: String,
    pub(super) token_endpoint_url: String,
}

#[derive(Debug, Clone)]
pub struct ExperimentalCodexChatAuth {
    pub access_token: String,
    pub chatgpt_account_id: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) struct CodexTokenResponse {
    #[serde(default)]
    pub(super) access_token: String,
    #[serde(default)]
    pub(super) refresh_token: Option<String>,
    #[serde(default)]
    pub(super) expires_in: Option<i64>,
    #[serde(default)]
    pub(super) scope: Option<String>,
    #[serde(default)]
    pub(super) id_token: Option<String>,
    #[serde(default)]
    pub(super) account_label: Option<String>,
}

#[derive(Debug)]
pub(super) enum CodexTokenEndpointError {
    Failed,
    RefreshTokenReused,
}

impl From<CodexTokenEndpointError> for ProviderAuthError {
    fn from(_: CodexTokenEndpointError) -> Self {
        ProviderAuthError::TokenExchange
    }
}

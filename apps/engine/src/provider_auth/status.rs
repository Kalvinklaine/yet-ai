use chrono::{Duration, Utc};

use super::types::{CodexAuthMetadata, CodexOAuthSession, MockOAuthSession, ProviderAuthResponse};
use super::{
    API_KEY_CONFIGURED_MESSAGE, CODEX_CONNECTED_MESSAGE, CODEX_EXPIRED_MESSAGE,
    LOGIN_UNAVAILABLE_MESSAGE, MOCK_CONNECTED_MESSAGE, MOCK_PENDING_MESSAGE,
};

pub(super) fn status_response(
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

pub(super) fn mock_pending_response(
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

pub(super) fn mock_connected_response(
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

pub(super) fn codex_pending_response(
    provider: &str,
    session: &CodexOAuthSession,
    authorization_url: String,
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
        authorization_url: Some(authorization_url),
        verification_url: None,
        session_id: Some(session.session_id.clone()),
        expires_at: Some(session.expires_at.clone()),
        scopes: Some(session.scopes.clone()),
        poll_interval_seconds: Some(3),
        message: super::CODEX_PENDING_MESSAGE.to_string(),
    }
}

pub(super) fn codex_connected_response(
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

pub(super) fn codex_expired_response(
    provider: &str,
    metadata: CodexAuthMetadata,
) -> ProviderAuthResponse {
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

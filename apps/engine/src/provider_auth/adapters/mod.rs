#![allow(dead_code)]

use std::future::Future;
use std::pin::Pin;

use super::types::{ProviderAuthError, ProviderAuthResponse};

pub(super) type AdapterFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ProviderOAuthProviderId(&'static str);

impl ProviderOAuthProviderId {
    pub(super) const fn new(value: &'static str) -> Self {
        Self(value)
    }

    pub(super) const fn as_str(self) -> &'static str {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProviderOAuthAuthMode {
    BrowserPkce,
    DeviceCode,
    ManualCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProviderOAuthStatusKind {
    Unavailable,
    LoginAvailable,
    Pending,
    Connected,
    Expired,
    Revoked,
    ProviderError,
    ExchangeFailed,
    StorageError,
}

impl ProviderOAuthStatusKind {
    pub(super) const fn wire_status(self) -> &'static str {
        match self {
            Self::Unavailable => "login_unavailable",
            Self::LoginAvailable => "login_available",
            Self::Pending => "pending",
            Self::Connected => "connected",
            Self::Expired => "expired",
            Self::Revoked => "revoked",
            Self::ProviderError => "provider_error",
            Self::ExchangeFailed => "exchange_failed",
            Self::StorageError => "storage_error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthPolicyGate {
    pub(super) name: &'static str,
    pub(super) allowed: bool,
    pub(super) message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthCapabilities {
    pub(super) provider_id: ProviderOAuthProviderId,
    pub(super) display_label: String,
    pub(super) auth_modes: Vec<ProviderOAuthAuthMode>,
    pub(super) policy_gates: Vec<ProviderOAuthPolicyGate>,
    pub(super) supports_refresh: bool,
    pub(super) supports_disconnect: bool,
    pub(super) supports_chat_auth_snapshot: bool,
}

impl ProviderOAuthCapabilities {
    pub(super) fn supports_mode(&self, mode: ProviderOAuthAuthMode) -> bool {
        self.auth_modes.contains(&mode)
    }

    pub(super) fn login_allowed(&self) -> bool {
        self.policy_gates.iter().all(|gate| gate.allowed)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthStatusView {
    pub(super) provider_id: ProviderOAuthProviderId,
    pub(super) kind: ProviderOAuthStatusKind,
    pub(super) configured: bool,
    pub(super) auth_source: &'static str,
    pub(super) supports_login: bool,
    pub(super) supports_api_key: bool,
    pub(super) cloud_required: bool,
    pub(super) success: Option<bool>,
    pub(super) account_label: Option<String>,
    pub(super) redacted: Option<String>,
    pub(super) authorization_url: Option<String>,
    pub(super) verification_url: Option<String>,
    pub(super) session_id: Option<String>,
    pub(super) expires_at: Option<String>,
    pub(super) scopes: Option<Vec<String>>,
    pub(super) poll_interval_seconds: Option<u64>,
    pub(super) message: String,
}

impl ProviderOAuthStatusView {
    pub(super) fn to_response(&self) -> ProviderAuthResponse {
        ProviderAuthResponse {
            provider: self.provider_id.as_str().to_string(),
            configured: self.configured,
            status: self.kind.wire_status(),
            auth_source: self.auth_source,
            supports_login: self.supports_login,
            supports_api_key: self.supports_api_key,
            cloud_required: self.cloud_required,
            success: self.success,
            account_label: self.account_label.clone(),
            redacted: self.redacted.clone(),
            authorization_url: self.authorization_url.clone(),
            verification_url: self.verification_url.clone(),
            session_id: self.session_id.clone(),
            expires_at: self.expires_at.clone(),
            scopes: self.scopes.clone(),
            poll_interval_seconds: self.poll_interval_seconds,
            message: self.message.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthStartSessionRequest {
    pub(super) mode: ProviderOAuthAuthMode,
    pub(super) ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthStartSession {
    pub(super) status: ProviderOAuthStatusView,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthExchangeCodeRequest {
    pub(super) session_id: String,
    pub(super) state: String,
    pub(super) code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthRefreshRequest {
    pub(super) rejected_access_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthRefreshOutcome {
    pub(super) status: ProviderOAuthStatusView,
    pub(super) chat_auth_snapshot: Option<ProviderOAuthChatAuthSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthChatAuthSnapshot {
    pub(super) access_token: String,
    pub(super) account_id: String,
    pub(super) base_url: String,
    pub(super) model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ProviderOAuthAdapterError {
    UnsupportedMode,
    PolicyBlocked,
    ProviderRejected,
    InvalidSession,
    SessionExpired,
    ExchangeFailed,
    Storage,
}

impl From<ProviderOAuthAdapterError> for ProviderAuthError {
    fn from(error: ProviderOAuthAdapterError) -> Self {
        match error {
            ProviderOAuthAdapterError::UnsupportedMode => ProviderAuthError::UnsupportedProvider,
            ProviderOAuthAdapterError::PolicyBlocked => ProviderAuthError::InvalidRequest,
            ProviderOAuthAdapterError::ProviderRejected => ProviderAuthError::TokenExchange,
            ProviderOAuthAdapterError::InvalidSession => ProviderAuthError::SessionMismatch,
            ProviderOAuthAdapterError::SessionExpired => ProviderAuthError::SessionExpired,
            ProviderOAuthAdapterError::ExchangeFailed => ProviderAuthError::TokenExchange,
            ProviderOAuthAdapterError::Storage => ProviderAuthError::Storage,
        }
    }
}

pub(super) trait ProviderOAuthAdapter: Send + Sync {
    fn provider_id(&self) -> ProviderOAuthProviderId;
    fn display_label(&self) -> &'static str;
    fn capabilities(&self) -> ProviderOAuthCapabilities;
    fn status<'a>(
        &'a self,
    ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>>;
    fn start_session<'a>(
        &'a self,
        request: ProviderOAuthStartSessionRequest,
    ) -> AdapterFuture<'a, Result<ProviderOAuthStartSession, ProviderOAuthAdapterError>>;
    fn exchange_code<'a>(
        &'a self,
        request: ProviderOAuthExchangeCodeRequest,
    ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>>;
    fn refresh<'a>(
        &'a self,
        request: ProviderOAuthRefreshRequest,
    ) -> AdapterFuture<'a, Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError>>;
    fn disconnect<'a>(
        &'a self,
    ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>>;
    fn chat_auth_snapshot<'a>(
        &'a self,
    ) -> AdapterFuture<'a, Result<Option<ProviderOAuthChatAuthSnapshot>, ProviderOAuthAdapterError>>;
}

pub(in crate::provider_auth) mod openai_codex {
    use std::path::{Path, PathBuf};

    use super::{
        AdapterFuture, ProviderOAuthAdapter, ProviderOAuthAdapterError, ProviderOAuthAuthMode,
        ProviderOAuthCapabilities, ProviderOAuthChatAuthSnapshot, ProviderOAuthExchangeCodeRequest,
        ProviderOAuthPolicyGate, ProviderOAuthProviderId, ProviderOAuthRefreshOutcome,
        ProviderOAuthRefreshRequest, ProviderOAuthStartSession, ProviderOAuthStartSessionRequest,
        ProviderOAuthStatusKind, ProviderOAuthStatusView,
    };
    use crate::provider_auth::types::{
        ExperimentalCodexChatAuth, ProviderAuthError, ProviderAuthResponse,
    };

    const PROVIDER_ID: ProviderOAuthProviderId = ProviderOAuthProviderId::new("openai");

    pub(in crate::provider_auth) struct OpenAiCodexOAuthAdapter {
        config_dir: PathBuf,
        provider: &'static str,
    }

    impl OpenAiCodexOAuthAdapter {
        pub(in crate::provider_auth) fn new(config_dir: &Path, provider: &'static str) -> Self {
            Self {
                config_dir: config_dir.to_path_buf(),
                provider,
            }
        }

        pub(in crate::provider_auth) async fn status_response(
            &self,
        ) -> Result<Option<ProviderAuthResponse>, ProviderAuthError> {
            let codex =
                crate::provider_auth::read_codex_state(&self.config_dir, self.provider).await?;
            if let Some(session) = codex.pending {
                if crate::provider_auth::parse_time(&session.expires_at)? > chrono::Utc::now() {
                    crate::provider_auth::ensure_codex_pending_callback_state(
                        &self.config_dir,
                        &session,
                    )
                    .await?;
                    return Ok(Some(crate::provider_auth::status::codex_pending_response(
                        self.provider,
                        &session,
                        crate::provider_auth::codex_authorization_url(&session),
                        None,
                    )));
                }
                crate::provider_auth_callback::forget_pending_state(&session.state);
                crate::provider_auth::remove_codex_registry_session(
                    &self.config_dir,
                    self.provider,
                    &session.session_id,
                )
                .await?;
                crate::provider_auth::write_codex_state(
                    &self.config_dir,
                    self.provider,
                    &crate::provider_auth::types::CodexOAuthState::default(),
                )
                .await?;
            }
            crate::provider_auth::codex_connected_status(&self.config_dir, self.provider).await
        }

        pub(in crate::provider_auth) async fn start_response(
            &self,
            ttl_seconds: Option<i64>,
            token_endpoint_url: Option<&str>,
            chat_endpoint_url: Option<&str>,
        ) -> Result<ProviderAuthResponse, ProviderAuthError> {
            crate::provider_auth_callback::ensure_started(&self.config_dir)
                .await
                .map_err(|_| ProviderAuthError::CallbackUnavailable)?;
            crate::provider_auth::reject_codex_mock_coexistence(&self.config_dir, self.provider)
                .await?;
            if let Some(response) =
                crate::provider_auth::prepare_codex_start(&self.config_dir, self.provider).await?
            {
                crate::provider_auth::register_codex_pending_callback_state(
                    &self.config_dir,
                    self.provider,
                )
                .await?;
                return Ok(response);
            }
            let session = crate::provider_auth::new_codex_session(
                ttl_seconds.unwrap_or(crate::provider_auth::CODEX_TTL_SECONDS),
                token_endpoint_url,
                chat_endpoint_url,
            )?;
            crate::provider_auth::write_codex_state(
                &self.config_dir,
                self.provider,
                &crate::provider_auth::types::CodexOAuthState {
                    pending: Some(session.clone()),
                },
            )
            .await?;
            crate::provider_auth::ensure_codex_pending_callback_state(&self.config_dir, &session)
                .await?;
            Ok(crate::provider_auth::status::codex_pending_response(
                self.provider,
                &session,
                crate::provider_auth::codex_authorization_url(&session),
                Some(true),
            ))
        }

        pub(in crate::provider_auth) async fn exchange_response(
            &self,
            session_id: String,
            state: String,
            code: String,
        ) -> Result<ProviderAuthResponse, ProviderAuthError> {
            crate::provider_auth::codex_exchange(
                &self.config_dir,
                self.provider,
                session_id,
                state,
                code,
            )
            .await
        }

        pub(in crate::provider_auth) async fn callback_exchange(
            &self,
            state: String,
            code: String,
        ) -> Result<ProviderAuthResponse, ProviderAuthError> {
            let codex =
                crate::provider_auth::read_codex_state(&self.config_dir, self.provider).await?;
            let Some(session) = codex.pending else {
                return Err(ProviderAuthError::SessionNotFound);
            };
            if session.state != state {
                return Err(ProviderAuthError::SessionMismatch);
            }
            self.exchange_response(session.session_id, state, code)
                .await
        }

        pub(in crate::provider_auth) async fn callback_error(
            &self,
            state: String,
        ) -> Result<(), ProviderAuthError> {
            crate::provider_auth::codex_callback_error_impl(&self.config_dir, self.provider, state)
                .await
        }

        pub(in crate::provider_auth) async fn disconnect_cleanup(
            &self,
        ) -> Result<bool, ProviderAuthError> {
            let codex =
                crate::provider_auth::read_codex_state(&self.config_dir, self.provider).await?;
            if let Some(session) = codex.pending.as_ref() {
                crate::provider_auth_callback::forget_pending_state(&session.state);
                crate::provider_auth::remove_codex_registry_session(
                    &self.config_dir,
                    self.provider,
                    &session.session_id,
                )
                .await?;
            }
            let had_codex = codex.pending.is_some()
                || crate::provider_auth::codex_has_secrets(&self.config_dir, self.provider).await?;
            if had_codex {
                crate::provider_auth::write_codex_state(
                    &self.config_dir,
                    self.provider,
                    &crate::provider_auth::types::CodexOAuthState::default(),
                )
                .await?;
                crate::provider_auth::delete_codex_secrets(&self.config_dir, self.provider).await?;
            }
            Ok(had_codex)
        }

        pub(in crate::provider_auth) async fn chat_auth_snapshot(
            &self,
        ) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
            crate::provider_auth::experimental_codex_chat_auth_impl(&self.config_dir, self.provider)
                .await
        }

        pub(in crate::provider_auth) async fn refresh_chat_auth(
            &self,
            rejected_access_token: Option<&str>,
        ) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
            crate::provider_auth::refresh_experimental_codex_chat_auth_impl(
                &self.config_dir,
                self.provider,
                rejected_access_token,
            )
            .await
        }

        pub(in crate::provider_auth) async fn refresh_chat_auth_if_needed(
            &self,
        ) -> Result<Option<ExperimentalCodexChatAuth>, ProviderAuthError> {
            if crate::provider_auth::codex_pending_session_is_unexpired(
                &self.config_dir,
                self.provider,
            )
            .await?
            {
                return Ok(None);
            }
            let Some(snapshot) = crate::provider_auth::read_codex_chat_auth_snapshot(
                &self.config_dir,
                self.provider,
            )
            .await?
            else {
                return Ok(None);
            };
            if crate::provider_auth::metadata_needs_refresh(&snapshot.metadata)? {
                self.refresh_chat_auth(None).await
            } else {
                Ok(Some(snapshot.auth))
            }
        }

        fn status_view_from_response(response: ProviderAuthResponse) -> ProviderOAuthStatusView {
            let kind = match response.status {
                "pending" => ProviderOAuthStatusKind::Pending,
                "connected" => ProviderOAuthStatusKind::Connected,
                "expired" => ProviderOAuthStatusKind::Expired,
                "revoked" => ProviderOAuthStatusKind::Revoked,
                "api_key_configured" => ProviderOAuthStatusKind::Unavailable,
                _ => ProviderOAuthStatusKind::Unavailable,
            };
            ProviderOAuthStatusView {
                provider_id: PROVIDER_ID,
                kind,
                configured: response.configured,
                auth_source: response.auth_source,
                supports_login: response.supports_login,
                supports_api_key: response.supports_api_key,
                cloud_required: response.cloud_required,
                success: response.success,
                account_label: response.account_label,
                redacted: response.redacted,
                authorization_url: response.authorization_url,
                verification_url: response.verification_url,
                session_id: response.session_id,
                expires_at: response.expires_at,
                scopes: response.scopes,
                poll_interval_seconds: response.poll_interval_seconds,
                message: response.message,
            }
        }
    }

    impl ProviderOAuthAdapter for OpenAiCodexOAuthAdapter {
        fn provider_id(&self) -> ProviderOAuthProviderId {
            PROVIDER_ID
        }

        fn display_label(&self) -> &'static str {
            "Experimental OpenAI Codex-like login"
        }

        fn capabilities(&self) -> ProviderOAuthCapabilities {
            ProviderOAuthCapabilities {
                provider_id: PROVIDER_ID,
                display_label: self.display_label().to_string(),
                auth_modes: vec![
                    ProviderOAuthAuthMode::BrowserPkce,
                    ProviderOAuthAuthMode::ManualCode,
                ],
                policy_gates: vec![ProviderOAuthPolicyGate {
                    name: "experimental-codex-like",
                    allowed: true,
                    message: Some(crate::provider_auth::CODEX_PENDING_MESSAGE.to_string()),
                }],
                supports_refresh: true,
                supports_disconnect: true,
                supports_chat_auth_snapshot: true,
            }
        }

        fn status<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                let response = self
                    .status_response()
                    .await
                    .map_err(|error| match error {
                        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                        ProviderAuthError::TokenExchange => {
                            ProviderOAuthAdapterError::ExchangeFailed
                        }
                        _ => ProviderOAuthAdapterError::ProviderRejected,
                    })?
                    .unwrap_or_else(|| {
                        crate::provider_auth::status::status_response(self.provider, None, None)
                    });
                Ok(Self::status_view_from_response(response))
            })
        }

        fn start_session<'a>(
            &'a self,
            request: ProviderOAuthStartSessionRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStartSession, ProviderOAuthAdapterError>>
        {
            Box::pin(async move {
                if !matches!(
                    request.mode,
                    ProviderOAuthAuthMode::BrowserPkce | ProviderOAuthAuthMode::ManualCode
                ) {
                    return Err(ProviderOAuthAdapterError::UnsupportedMode);
                }
                let status = self
                    .start_response(request.ttl_seconds, None, None)
                    .await
                    .map_err(|error| match error {
                        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                        ProviderAuthError::InvalidRequest => {
                            ProviderOAuthAdapterError::PolicyBlocked
                        }
                        _ => ProviderOAuthAdapterError::ProviderRejected,
                    })?;
                Ok(ProviderOAuthStartSession {
                    status: Self::status_view_from_response(status),
                })
            })
        }

        fn exchange_code<'a>(
            &'a self,
            request: ProviderOAuthExchangeCodeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                let response = self
                    .exchange_response(request.session_id, request.state, request.code)
                    .await
                    .map_err(|error| match error {
                        ProviderAuthError::SessionExpired => {
                            ProviderOAuthAdapterError::SessionExpired
                        }
                        ProviderAuthError::SessionMismatch | ProviderAuthError::SessionNotFound => {
                            ProviderOAuthAdapterError::InvalidSession
                        }
                        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                        _ => ProviderOAuthAdapterError::ExchangeFailed,
                    })?;
                Ok(Self::status_view_from_response(response))
            })
        }

        fn refresh<'a>(
            &'a self,
            request: ProviderOAuthRefreshRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError>>
        {
            Box::pin(async move {
                let auth = self
                    .refresh_chat_auth(request.rejected_access_token.as_deref())
                    .await
                    .map_err(|error| match error {
                        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                        _ => ProviderOAuthAdapterError::ExchangeFailed,
                    })?;
                let status = self
                    .status_response()
                    .await
                    .map_err(|_| ProviderOAuthAdapterError::Storage)?
                    .unwrap_or_else(|| {
                        crate::provider_auth::status::status_response(self.provider, None, None)
                    });
                Ok(ProviderOAuthRefreshOutcome {
                    status: Self::status_view_from_response(status),
                    chat_auth_snapshot: auth.map(|auth| ProviderOAuthChatAuthSnapshot {
                        access_token: auth.access_token,
                        account_id: auth.chatgpt_account_id,
                        base_url: auth.base_url,
                        model: auth.model,
                    }),
                })
            })
        }

        fn disconnect<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                self.disconnect_cleanup()
                    .await
                    .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                Ok(ProviderOAuthStatusView {
                    provider_id: PROVIDER_ID,
                    kind: ProviderOAuthStatusKind::Revoked,
                    configured: false,
                    auth_source: "none",
                    supports_login: true,
                    supports_api_key: true,
                    cloud_required: false,
                    success: Some(true),
                    account_label: None,
                    redacted: None,
                    authorization_url: None,
                    verification_url: None,
                    session_id: None,
                    expires_at: None,
                    scopes: None,
                    poll_interval_seconds: None,
                    message: crate::provider_auth::DISCONNECT_MESSAGE.to_string(),
                })
            })
        }

        fn chat_auth_snapshot<'a>(
            &'a self,
        ) -> AdapterFuture<
            'a,
            Result<Option<ProviderOAuthChatAuthSnapshot>, ProviderOAuthAdapterError>,
        > {
            Box::pin(async move {
                Ok(self
                    .chat_auth_snapshot()
                    .await
                    .map_err(|_| ProviderOAuthAdapterError::Storage)?
                    .map(|auth| ProviderOAuthChatAuthSnapshot {
                        access_token: auth.access_token,
                        account_id: auth.chatgpt_account_id,
                        base_url: auth.base_url,
                        model: auth.model,
                    }))
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PROVIDER: ProviderOAuthProviderId = ProviderOAuthProviderId::new("openai");

    struct TestAdapter;

    impl TestAdapter {
        fn pending_status(success: Option<bool>) -> ProviderOAuthStatusView {
            ProviderOAuthStatusView {
                provider_id: TEST_PROVIDER,
                kind: ProviderOAuthStatusKind::Pending,
                configured: false,
                auth_source: "oauth",
                supports_login: true,
                supports_api_key: true,
                cloud_required: false,
                success,
                account_label: None,
                redacted: None,
                authorization_url: Some("http://127.0.0.1/auth?state=safe-state".to_string()),
                verification_url: Some("http://127.0.0.1/verify".to_string()),
                session_id: Some("safe-session".to_string()),
                expires_at: Some("2030-01-01T00:00:00Z".to_string()),
                scopes: Some(vec!["mock:chat".to_string()]),
                poll_interval_seconds: Some(1),
                message: "Mock adapter login is pending.".to_string(),
            }
        }

        fn connected_status(success: Option<bool>) -> ProviderOAuthStatusView {
            ProviderOAuthStatusView {
                provider_id: TEST_PROVIDER,
                kind: ProviderOAuthStatusKind::Connected,
                configured: true,
                auth_source: "oauth",
                supports_login: true,
                supports_api_key: true,
                cloud_required: false,
                success,
                account_label: Some("Mock Adapter Account".to_string()),
                redacted: Some("oauth-token-...redacted".to_string()),
                authorization_url: None,
                verification_url: None,
                session_id: None,
                expires_at: Some("2030-01-01T00:00:00Z".to_string()),
                scopes: Some(vec!["mock:chat".to_string()]),
                poll_interval_seconds: None,
                message: "Mock adapter login is connected.".to_string(),
            }
        }
    }

    impl ProviderOAuthAdapter for TestAdapter {
        fn provider_id(&self) -> ProviderOAuthProviderId {
            TEST_PROVIDER
        }

        fn display_label(&self) -> &'static str {
            "Mock Provider"
        }

        fn capabilities(&self) -> ProviderOAuthCapabilities {
            ProviderOAuthCapabilities {
                provider_id: TEST_PROVIDER,
                display_label: self.display_label().to_string(),
                auth_modes: vec![
                    ProviderOAuthAuthMode::BrowserPkce,
                    ProviderOAuthAuthMode::DeviceCode,
                ],
                policy_gates: vec![ProviderOAuthPolicyGate {
                    name: "test-only",
                    allowed: true,
                    message: None,
                }],
                supports_refresh: true,
                supports_disconnect: true,
                supports_chat_auth_snapshot: true,
            }
        }

        fn status<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async { Ok(Self::pending_status(None)) })
        }

        fn start_session<'a>(
            &'a self,
            request: ProviderOAuthStartSessionRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStartSession, ProviderOAuthAdapterError>>
        {
            Box::pin(async move {
                if !self.capabilities().supports_mode(request.mode) {
                    return Err(ProviderOAuthAdapterError::UnsupportedMode);
                }
                Ok(ProviderOAuthStartSession {
                    status: Self::pending_status(Some(true)),
                })
            })
        }

        fn exchange_code<'a>(
            &'a self,
            request: ProviderOAuthExchangeCodeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                if request.code.contains("secret") {
                    return Err(ProviderOAuthAdapterError::ExchangeFailed);
                }
                Ok(Self::connected_status(Some(true)))
            })
        }

        fn refresh<'a>(
            &'a self,
            request: ProviderOAuthRefreshRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError>>
        {
            Box::pin(async move {
                let access_token = request
                    .rejected_access_token
                    .map(|_| "replacement-access-token-secret".to_string())
                    .unwrap_or_else(|| "current-access-token-secret".to_string());
                Ok(ProviderOAuthRefreshOutcome {
                    status: Self::connected_status(Some(true)),
                    chat_auth_snapshot: Some(ProviderOAuthChatAuthSnapshot {
                        access_token,
                        account_id: "acct-secret-internal".to_string(),
                        base_url: "http://127.0.0.1/chat".to_string(),
                        model: "mock-model".to_string(),
                    }),
                })
            })
        }

        fn disconnect<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async {
                Ok(ProviderOAuthStatusView {
                    provider_id: TEST_PROVIDER,
                    kind: ProviderOAuthStatusKind::Revoked,
                    configured: false,
                    auth_source: "none",
                    supports_login: true,
                    supports_api_key: true,
                    cloud_required: false,
                    success: Some(true),
                    account_label: None,
                    redacted: None,
                    authorization_url: None,
                    verification_url: None,
                    session_id: None,
                    expires_at: None,
                    scopes: None,
                    poll_interval_seconds: None,
                    message: "Mock adapter login was disconnected.".to_string(),
                })
            })
        }

        fn chat_auth_snapshot<'a>(
            &'a self,
        ) -> AdapterFuture<
            'a,
            Result<Option<ProviderOAuthChatAuthSnapshot>, ProviderOAuthAdapterError>,
        > {
            Box::pin(async {
                Ok(Some(ProviderOAuthChatAuthSnapshot {
                    access_token: "snapshot-access-token-secret".to_string(),
                    account_id: "acct-secret-internal".to_string(),
                    base_url: "http://127.0.0.1/chat".to_string(),
                    model: "mock-model".to_string(),
                }))
            })
        }
    }

    fn assert_response_has_no_secret(response: &ProviderAuthResponse) {
        let json = serde_json::to_string(response).unwrap();
        for forbidden in [
            "access-token-secret",
            "refresh-token-secret",
            "acct-secret-internal",
            "code-verifier-secret",
            "authorization-code-secret",
        ] {
            assert!(
                !json.contains(forbidden),
                "response leaked {forbidden}: {json}"
            );
        }
        assert!(
            !json.contains("access_token"),
            "response leaked token key: {json}"
        );
        assert!(
            !json.contains("refresh_token"),
            "response leaked token key: {json}"
        );
    }

    #[test]
    fn openai_codex_adapter_declares_browser_manual_refresh_and_secret_snapshot_support() {
        let dir = std::env::temp_dir().join("yet-ai-openai-codex-adapter-capabilities-test");
        let adapter = openai_codex::OpenAiCodexOAuthAdapter::new(&dir, "openai");
        let capabilities = adapter.capabilities();

        assert_eq!(adapter.provider_id().as_str(), "openai");
        assert!(capabilities.supports_mode(ProviderOAuthAuthMode::BrowserPkce));
        assert!(capabilities.supports_mode(ProviderOAuthAuthMode::ManualCode));
        assert!(!capabilities.supports_mode(ProviderOAuthAuthMode::DeviceCode));
        assert!(capabilities.supports_refresh);
        assert!(capabilities.supports_disconnect);
        assert!(capabilities.supports_chat_auth_snapshot);
        assert!(capabilities.login_allowed());
    }

    #[test]
    fn capability_projection_declares_modes_and_policy_gates() {
        let adapter = TestAdapter;
        let capabilities = adapter.capabilities();

        assert_eq!(adapter.provider_id().as_str(), "openai");
        assert_eq!(capabilities.provider_id.as_str(), "openai");
        assert_eq!(capabilities.display_label, "Mock Provider");
        assert!(capabilities.supports_mode(ProviderOAuthAuthMode::BrowserPkce));
        assert!(capabilities.supports_mode(ProviderOAuthAuthMode::DeviceCode));
        assert!(!capabilities.supports_mode(ProviderOAuthAuthMode::ManualCode));
        assert!(capabilities.login_allowed());
        assert!(capabilities.supports_refresh);
        assert!(capabilities.supports_disconnect);
        assert!(capabilities.supports_chat_auth_snapshot);
    }

    #[tokio::test]
    async fn adapter_status_projection_serializes_without_secret_material() {
        let adapter = TestAdapter;
        let start = adapter
            .start_session(ProviderOAuthStartSessionRequest {
                mode: ProviderOAuthAuthMode::BrowserPkce,
                ttl_seconds: Some(600),
            })
            .await
            .unwrap();
        let response = start.status.to_response();

        assert_eq!(response.provider, "openai");
        assert_eq!(response.status, "pending");
        assert_eq!(response.auth_source, "oauth");
        assert_eq!(response.success, Some(true));
        assert_response_has_no_secret(&response);
    }

    #[tokio::test]
    async fn adapter_secret_snapshot_stays_out_of_gui_response_projection() {
        let adapter = TestAdapter;
        let refresh = adapter
            .refresh(ProviderOAuthRefreshRequest {
                rejected_access_token: Some("rejected-access-token-secret".to_string()),
            })
            .await
            .unwrap();
        let snapshot = refresh.chat_auth_snapshot.unwrap();

        assert_eq!(snapshot.access_token, "replacement-access-token-secret");
        assert_eq!(snapshot.account_id, "acct-secret-internal");
        let response = refresh.status.to_response();
        assert_eq!(response.status, "connected");
        assert_eq!(
            response.redacted.as_deref(),
            Some("oauth-token-...redacted")
        );
        assert_response_has_no_secret(&response);
    }

    #[tokio::test]
    async fn unsupported_adapter_mode_maps_to_existing_provider_auth_error() {
        let adapter = TestAdapter;
        let error = adapter
            .start_session(ProviderOAuthStartSessionRequest {
                mode: ProviderOAuthAuthMode::ManualCode,
                ttl_seconds: None,
            })
            .await
            .unwrap_err();
        let public_error: ProviderAuthError = error.into();

        assert!(matches!(
            public_error,
            ProviderAuthError::UnsupportedProvider
        ));
    }
}

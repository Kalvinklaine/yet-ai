use std::future::Future;
use std::pin::Pin;

use super::types::{CodexTokenExchangeCategory, ProviderAuthError, ProviderAuthResponse};

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

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProviderOAuthAuthMode {
    BrowserPkce,
    DeviceCode,
    ManualCode,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProviderOAuthStatusKind {
    Unavailable,
    ApiKeyConfigured,
    LoginAvailable,
    Pending,
    Connected,
    Expired,
    Revoked,
    ProviderError,
    ExchangeFailed(CodexTokenExchangeCategory),
    StorageError,
}

impl ProviderOAuthStatusKind {
    pub(super) const fn wire_status(self) -> &'static str {
        match self {
            Self::Unavailable => "login_unavailable",
            Self::ApiKeyConfigured => "api_key_configured",
            Self::LoginAvailable => "login_available",
            Self::Pending => "pending",
            Self::Connected => "connected",
            Self::Expired => "expired",
            Self::Revoked => "revoked",
            Self::ProviderError | Self::ExchangeFailed(_) | Self::StorageError => "error",
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthPolicyGate {
    pub(super) name: &'static str,
    pub(super) allowed: bool,
    pub(super) message: Option<String>,
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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
    pub(super) last_error: Option<String>,
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
            last_error: self.last_error.clone(),
            message: self.message.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthStartSessionRequest {
    pub(super) mode: ProviderOAuthAuthMode,
    pub(super) ttl_seconds: Option<i64>,
    pub(super) token_endpoint_url: Option<String>,
    pub(super) chat_endpoint_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthStartSession {
    pub(super) status: ProviderOAuthStatusView,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthExchangeCodeRequest {
    pub(super) session_id: String,
    pub(super) state: String,
    pub(super) code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthCallbackExchangeRequest {
    pub(super) state: String,
    pub(super) code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthCallbackErrorRequest {
    pub(super) state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthCallbackStateRequest {
    pub(super) state: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthRefreshRequest {
    pub(super) rejected_access_token: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProviderOAuthRefreshOutcome {
    pub(super) status: ProviderOAuthStatusView,
    pub(super) chat_auth_snapshot: Option<ProviderOAuthChatAuthSnapshot>,
}

#[allow(dead_code)]
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
    SessionNotFound,
    SessionExpired,
    ExchangeFailed(CodexTokenExchangeCategory),
    ExchangeFailedDetail(CodexTokenExchangeCategory, String),
    Storage,
}

impl From<ProviderOAuthAdapterError> for ProviderAuthError {
    fn from(error: ProviderOAuthAdapterError) -> Self {
        match error {
            ProviderOAuthAdapterError::UnsupportedMode => ProviderAuthError::InvalidRequest,
            ProviderOAuthAdapterError::PolicyBlocked => ProviderAuthError::InvalidRequest,
            ProviderOAuthAdapterError::ProviderRejected => ProviderAuthError::token_exchange(
                crate::provider_auth::types::CodexTokenExchangeCategory::TokenHttpStatus(0),
            ),
            ProviderOAuthAdapterError::InvalidSession => ProviderAuthError::SessionMismatch,
            ProviderOAuthAdapterError::SessionNotFound => ProviderAuthError::SessionNotFound,
            ProviderOAuthAdapterError::SessionExpired => ProviderAuthError::SessionExpired,
            ProviderOAuthAdapterError::ExchangeFailed(category) => {
                ProviderAuthError::token_exchange(category)
            }
            ProviderOAuthAdapterError::ExchangeFailedDetail(category, detail) => {
                ProviderAuthError::token_exchange_with_detail(category, detail)
            }
            ProviderOAuthAdapterError::Storage => ProviderAuthError::Storage,
        }
    }
}

#[allow(dead_code)]
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
    fn callback_exchange<'a>(
        &'a self,
        request: ProviderOAuthCallbackExchangeRequest,
    ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>>;
    fn callback_error<'a>(
        &'a self,
        request: ProviderOAuthCallbackErrorRequest,
    ) -> AdapterFuture<'a, Result<(), ProviderOAuthAdapterError>>;
    fn callback_state_pending<'a>(
        &'a self,
        request: ProviderOAuthCallbackStateRequest,
    ) -> AdapterFuture<'a, Result<bool, ProviderOAuthAdapterError>>;
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

pub(super) struct ProviderOAuthAdapterDispatch<'a> {
    adapters: Vec<&'a dyn ProviderOAuthAdapter>,
}

impl<'a> ProviderOAuthAdapterDispatch<'a> {
    pub(super) fn single(adapter: &'a dyn ProviderOAuthAdapter) -> Self {
        Self {
            adapters: vec![adapter],
        }
    }

    #[cfg(test)]
    fn new(adapters: Vec<&'a dyn ProviderOAuthAdapter>) -> Self {
        Self { adapters }
    }

    fn select(
        &self,
        provider: &str,
    ) -> Result<&'a dyn ProviderOAuthAdapter, ProviderOAuthAdapterError> {
        self.adapters
            .iter()
            .copied()
            .find(|adapter| adapter.provider_id().as_str() == provider)
            .ok_or(ProviderOAuthAdapterError::UnsupportedMode)
    }

    pub(super) async fn status(
        &self,
        provider: &str,
    ) -> Result<ProviderOAuthStatusView, ProviderOAuthAdapterError> {
        self.select(provider)?.status().await
    }

    pub(super) async fn start_session(
        &self,
        provider: &str,
        request: ProviderOAuthStartSessionRequest,
    ) -> Result<ProviderOAuthStartSession, ProviderOAuthAdapterError> {
        self.select(provider)?.start_session(request).await
    }

    pub(super) async fn exchange_code(
        &self,
        provider: &str,
        request: ProviderOAuthExchangeCodeRequest,
    ) -> Result<ProviderOAuthStatusView, ProviderOAuthAdapterError> {
        self.select(provider)?.exchange_code(request).await
    }

    pub(super) async fn callback_exchange(
        &self,
        provider: &str,
        request: ProviderOAuthCallbackExchangeRequest,
    ) -> Result<ProviderOAuthStatusView, ProviderOAuthAdapterError> {
        self.select(provider)?.callback_exchange(request).await
    }

    pub(super) async fn callback_error(
        &self,
        provider: &str,
        request: ProviderOAuthCallbackErrorRequest,
    ) -> Result<(), ProviderOAuthAdapterError> {
        self.select(provider)?.callback_error(request).await
    }

    pub(super) async fn callback_state_pending(
        &self,
        provider: &str,
        request: ProviderOAuthCallbackStateRequest,
    ) -> Result<bool, ProviderOAuthAdapterError> {
        self.select(provider)?.callback_state_pending(request).await
    }

    pub(super) async fn refresh(
        &self,
        provider: &str,
        request: ProviderOAuthRefreshRequest,
    ) -> Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError> {
        self.select(provider)?.refresh(request).await
    }

    pub(super) async fn chat_auth_snapshot(
        &self,
        provider: &str,
    ) -> Result<Option<ProviderOAuthChatAuthSnapshot>, ProviderOAuthAdapterError> {
        self.select(provider)?.chat_auth_snapshot().await
    }
}

pub(in crate::provider_auth) mod openai_codex {
    use std::path::{Path, PathBuf};

    use super::{
        AdapterFuture, ProviderOAuthAdapter, ProviderOAuthAdapterError, ProviderOAuthAuthMode,
        ProviderOAuthCallbackErrorRequest, ProviderOAuthCallbackExchangeRequest,
        ProviderOAuthCallbackStateRequest, ProviderOAuthCapabilities,
        ProviderOAuthChatAuthSnapshot, ProviderOAuthExchangeCodeRequest, ProviderOAuthPolicyGate,
        ProviderOAuthProviderId, ProviderOAuthRefreshOutcome, ProviderOAuthRefreshRequest,
        ProviderOAuthStartSession, ProviderOAuthStartSessionRequest, ProviderOAuthStatusKind,
        ProviderOAuthStatusView,
    };
    use crate::provider_auth::types::{
        CodexAuthMetadata, CodexOAuthSession, CodexOAuthState, CodexTokenExchangeCategory,
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

        async fn discover_model(
            &self,
            session: &CodexOAuthSession,
            access_token: &str,
            account_id: &str,
        ) -> Result<String, ProviderAuthError> {
            crate::provider_auth::discover_codex_model(
                &session.chat_base_url,
                access_token,
                account_id,
            )
            .await
        }

        async fn store_connection(
            &self,
            token: &crate::provider_auth::types::CodexTokenResponse,
            metadata: &CodexAuthMetadata,
        ) -> Result<(), ProviderAuthError> {
            crate::provider_auth::store_codex_connection(
                &self.config_dir,
                self.provider,
                token,
                metadata,
            )
            .await
        }

        async fn clear_pending_after_success(
            &self,
            state: &str,
            session_id: &str,
        ) -> Result<(), ProviderAuthError> {
            if crate::provider_auth::write_codex_state(
                &self.config_dir,
                self.provider,
                &CodexOAuthState::default(),
            )
            .await
            .is_err()
            {
                crate::provider_auth::delete_codex_secrets(&self.config_dir, self.provider).await?;
                return Err(ProviderAuthError::Storage);
            }
            crate::provider_auth_callback::forget_pending_state(state);
            crate::provider_auth::complete_codex_registry_session(
                &self.config_dir,
                self.provider,
                session_id,
            )
            .await
        }

        pub(in crate::provider_auth) async fn complete_exchange_with_token(
            &self,
            session: CodexOAuthSession,
            session_id: &str,
            state: &str,
            token: crate::provider_auth::types::CodexTokenResponse,
        ) -> Result<ProviderAuthResponse, ProviderAuthError> {
            let account_id = crate::provider_auth::extract_codex_account_id(&token)?;
            let chat_model = match self
                .discover_model(&session, &token.access_token, &account_id)
                .await
            {
                Ok(model) => model,
                Err(_) => {
                    crate::provider_auth::validate_codex_chat_model(&session.chat_model)?;
                    session.chat_model.clone()
                }
            };
            let scopes =
                crate::provider_auth::codex_token_scopes(token.scope.as_deref(), &session.scopes)?;
            let expires_in =
                crate::provider_auth::validate_codex_token_expires_in(token.expires_in)?;
            let expires_at =
                (chrono::Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339();
            let metadata = CodexAuthMetadata {
                provider: self.provider.to_string(),
                account_label: crate::provider_auth::sanitized_account_label(
                    token.account_label.as_deref(),
                ),
                scopes,
                expires_at,
                redacted: crate::secret_store::redact_secret(&token.access_token),
                chatgpt_account_id: account_id,
                chat_base_url: session.chat_base_url,
                chat_model,
                token_endpoint_url: session.token_endpoint_url,
            };
            self.store_connection(&token, &metadata).await?;
            self.clear_pending_after_success(state, session_id).await?;
            Ok(crate::provider_auth::status::codex_connected_response(
                self.provider,
                metadata,
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

        pub(in crate::provider_auth) async fn callback_state_pending(
            &self,
            state: String,
        ) -> Result<bool, ProviderAuthError> {
            crate::provider_auth::codex_callback_state_is_pending_impl(
                &self.config_dir,
                self.provider,
                &state,
            )
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
                "api_key_configured" => ProviderOAuthStatusKind::ApiKeyConfigured,
                "error" => ProviderOAuthStatusKind::ProviderError,
                "login_available" => ProviderOAuthStatusKind::LoginAvailable,
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
                last_error: response.last_error,
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
                let response = match self.status_response().await.map_err(|error| match error {
                    ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                    ProviderAuthError::InvalidRequest => ProviderOAuthAdapterError::PolicyBlocked,
                    ProviderAuthError::TokenExchange(category, _) => {
                        ProviderOAuthAdapterError::ExchangeFailed(category)
                    }
                    _ => ProviderOAuthAdapterError::ProviderRejected,
                })? {
                    Some(response) => response,
                    None => crate::provider_auth::status::status_response(
                        self.provider,
                        crate::provider_auth::configured_api_key(&self.config_dir, self.provider)
                            .await
                            .map_err(|_| ProviderOAuthAdapterError::Storage)?,
                        None,
                    ),
                };
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
                    .start_response(
                        request.ttl_seconds,
                        request.token_endpoint_url.as_deref(),
                        request.chat_endpoint_url.as_deref(),
                    )
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
                        ProviderAuthError::SessionMismatch => {
                            ProviderOAuthAdapterError::InvalidSession
                        }
                        ProviderAuthError::SessionNotFound => {
                            ProviderOAuthAdapterError::SessionNotFound
                        }
                        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                        ProviderAuthError::TokenExchange(category, Some(detail)) => {
                            ProviderOAuthAdapterError::ExchangeFailedDetail(category, detail)
                        }
                        ProviderAuthError::TokenExchange(category, None) => {
                            ProviderOAuthAdapterError::ExchangeFailed(category)
                        }
                        _ => ProviderOAuthAdapterError::ExchangeFailed(
                            CodexTokenExchangeCategory::TokenHttpStatus(0),
                        ),
                    })?;
                Ok(Self::status_view_from_response(response))
            })
        }

        fn callback_exchange<'a>(
            &'a self,
            request: ProviderOAuthCallbackExchangeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                let response = self
                    .callback_exchange(request.state, request.code)
                    .await
                    .map_err(|error| match error {
                        ProviderAuthError::SessionExpired => {
                            ProviderOAuthAdapterError::SessionExpired
                        }
                        ProviderAuthError::SessionMismatch => {
                            ProviderOAuthAdapterError::InvalidSession
                        }
                        ProviderAuthError::SessionNotFound => {
                            ProviderOAuthAdapterError::SessionNotFound
                        }
                        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                        ProviderAuthError::TokenExchange(category, Some(detail)) => {
                            ProviderOAuthAdapterError::ExchangeFailedDetail(category, detail)
                        }
                        ProviderAuthError::TokenExchange(category, None) => {
                            ProviderOAuthAdapterError::ExchangeFailed(category)
                        }
                        _ => ProviderOAuthAdapterError::ExchangeFailed(
                            CodexTokenExchangeCategory::TokenHttpStatus(0),
                        ),
                    })?;
                Ok(Self::status_view_from_response(response))
            })
        }

        fn callback_error<'a>(
            &'a self,
            request: ProviderOAuthCallbackErrorRequest,
        ) -> AdapterFuture<'a, Result<(), ProviderOAuthAdapterError>> {
            Box::pin(async move {
                self.callback_error(request.state)
                    .await
                    .map_err(|error| match error {
                        ProviderAuthError::SessionExpired => {
                            ProviderOAuthAdapterError::SessionExpired
                        }
                        ProviderAuthError::SessionMismatch => {
                            ProviderOAuthAdapterError::InvalidSession
                        }
                        ProviderAuthError::SessionNotFound => {
                            ProviderOAuthAdapterError::SessionNotFound
                        }
                        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                        _ => ProviderOAuthAdapterError::ProviderRejected,
                    })
            })
        }

        fn callback_state_pending<'a>(
            &'a self,
            request: ProviderOAuthCallbackStateRequest,
        ) -> AdapterFuture<'a, Result<bool, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                self.callback_state_pending(request.state)
                    .await
                    .map_err(|_| ProviderOAuthAdapterError::Storage)
            })
        }

        fn refresh<'a>(
            &'a self,
            request: ProviderOAuthRefreshRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError>>
        {
            Box::pin(async move {
                let auth = if request.rejected_access_token.is_some() {
                    self.refresh_chat_auth(request.rejected_access_token.as_deref())
                        .await
                } else {
                    self.refresh_chat_auth_if_needed().await
                }
                .map_err(|error| match error {
                    ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                    ProviderAuthError::InvalidRequest => ProviderOAuthAdapterError::PolicyBlocked,
                    _ => ProviderOAuthAdapterError::ExchangeFailed(
                        CodexTokenExchangeCategory::TokenHttpStatus(0),
                    ),
                })?;
                let status = if auth.is_some() {
                    self.status_response()
                        .await
                        .map_err(|_| ProviderOAuthAdapterError::Storage)?
                        .unwrap_or_else(|| {
                            crate::provider_auth::status::status_response(self.provider, None, None)
                        })
                } else {
                    crate::provider_auth::status::status_response(self.provider, None, None)
                };
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
                    last_error: None,
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

    const DEVICE_TEST_PROVIDER: ProviderOAuthProviderId =
        ProviderOAuthProviderId::new("openai-compatible");

    struct DeviceFlowProofAdapter {
        config_dir: std::path::PathBuf,
    }

    impl DeviceFlowProofAdapter {
        fn new(config_dir: std::path::PathBuf) -> Self {
            Self { config_dir }
        }

        fn expires_at() -> String {
            (chrono::Utc::now() + chrono::Duration::minutes(10)).to_rfc3339()
        }

        fn pending_status(
            session: &crate::provider_auth::session_registry::ProviderAuthPendingSession,
        ) -> ProviderOAuthStatusView {
            ProviderOAuthStatusView {
                provider_id: DEVICE_TEST_PROVIDER,
                kind: ProviderOAuthStatusKind::Pending,
                configured: false,
                auth_source: "device",
                supports_login: true,
                supports_api_key: true,
                cloud_required: false,
                success: Some(true),
                account_label: None,
                redacted: None,
                authorization_url: None,
                verification_url: Some(
                    "http://127.0.0.1/mock-device/verify?user_code=YET-MOCK".to_string(),
                ),
                session_id: Some(session.session_id.clone()),
                expires_at: Some(session.expires_at.clone()),
                scopes: Some(vec!["mock:device".to_string()]),
                poll_interval_seconds: Some(5),
                last_error: None,
                message: "Mock device login is pending.".to_string(),
            }
        }

        fn connected_status() -> ProviderOAuthStatusView {
            ProviderOAuthStatusView {
                provider_id: DEVICE_TEST_PROVIDER,
                kind: ProviderOAuthStatusKind::Connected,
                configured: true,
                auth_source: "device",
                supports_login: true,
                supports_api_key: true,
                cloud_required: false,
                success: Some(true),
                account_label: Some("Mock Device Account".to_string()),
                redacted: Some("device-token-...redacted".to_string()),
                authorization_url: None,
                verification_url: None,
                session_id: None,
                expires_at: Some(Self::expires_at()),
                scopes: Some(vec!["mock:device".to_string()]),
                poll_interval_seconds: None,
                last_error: None,
                message: "Mock device login is connected.".to_string(),
            }
        }
    }

    impl ProviderOAuthAdapter for DeviceFlowProofAdapter {
        fn provider_id(&self) -> ProviderOAuthProviderId {
            DEVICE_TEST_PROVIDER
        }

        fn display_label(&self) -> &'static str {
            "Mock Device Provider"
        }

        fn capabilities(&self) -> ProviderOAuthCapabilities {
            ProviderOAuthCapabilities {
                provider_id: DEVICE_TEST_PROVIDER,
                display_label: self.display_label().to_string(),
                auth_modes: vec![ProviderOAuthAuthMode::DeviceCode],
                policy_gates: vec![ProviderOAuthPolicyGate {
                    name: "test-device-only",
                    allowed: true,
                    message: None,
                }],
                supports_refresh: false,
                supports_disconnect: true,
                supports_chat_auth_snapshot: false,
            }
        }

        fn status<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                let registry = crate::provider_auth::session_store::read_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                if let Some(session) = registry
                    .lookup_by_state(
                        DEVICE_TEST_PROVIDER.as_str(),
                        "mock-device-state",
                        chrono::Utc::now(),
                    )
                    .map_err(|_| ProviderOAuthAdapterError::Storage)?
                {
                    return Ok(Self::pending_status(session));
                }
                Ok(ProviderOAuthStatusView {
                    provider_id: DEVICE_TEST_PROVIDER,
                    kind: ProviderOAuthStatusKind::LoginAvailable,
                    configured: false,
                    auth_source: "none",
                    supports_login: true,
                    supports_api_key: true,
                    cloud_required: false,
                    success: None,
                    account_label: None,
                    redacted: None,
                    authorization_url: None,
                    verification_url: None,
                    session_id: None,
                    expires_at: None,
                    scopes: None,
                    poll_interval_seconds: None,
                    last_error: None,
                    message: "Mock device login is available.".to_string(),
                })
            })
        }

        fn start_session<'a>(
            &'a self,
            request: ProviderOAuthStartSessionRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStartSession, ProviderOAuthAdapterError>>
        {
            Box::pin(async move {
                if request.mode != ProviderOAuthAuthMode::DeviceCode {
                    return Err(ProviderOAuthAdapterError::UnsupportedMode);
                }
                let session = crate::provider_auth::session_registry::ProviderAuthPendingSession {
                    provider: DEVICE_TEST_PROVIDER.as_str().to_string(),
                    session_id: "mock-device-session".to_string(),
                    state: "mock-device-state".to_string(),
                    mode: crate::provider_auth::session_registry::ProviderAuthPendingMode::Device,
                    expires_at: Self::expires_at(),
                    callback_owner: None,
                    token_endpoint_id: Some("mock-device".to_string()),
                };
                let mut registry = crate::provider_auth::session_store::read_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                registry.insert(session.clone());
                crate::provider_auth::session_store::write_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                    &registry,
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                Ok(ProviderOAuthStartSession {
                    status: Self::pending_status(&session),
                })
            })
        }

        fn exchange_code<'a>(
            &'a self,
            request: ProviderOAuthExchangeCodeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                if !request.code.starts_with("device-approved-") {
                    return Err(ProviderOAuthAdapterError::ExchangeFailed(
                        CodexTokenExchangeCategory::TokenHttpStatus(0),
                    ));
                }
                let mut registry = crate::provider_auth::session_store::read_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                let pending = registry
                    .lookup(
                        DEVICE_TEST_PROVIDER.as_str(),
                        &request.session_id,
                        &request.state,
                        chrono::Utc::now(),
                    )
                    .map_err(|_| ProviderOAuthAdapterError::Storage)?
                    .is_some();
                if !pending {
                    return Err(ProviderOAuthAdapterError::InvalidSession);
                }
                registry.complete_terminal(&request.session_id);
                crate::provider_auth::session_store::write_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                    &registry,
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                Ok(Self::connected_status())
            })
        }

        fn callback_exchange<'a>(
            &'a self,
            _request: ProviderOAuthCallbackExchangeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::UnsupportedMode) })
        }

        fn callback_error<'a>(
            &'a self,
            _request: ProviderOAuthCallbackErrorRequest,
        ) -> AdapterFuture<'a, Result<(), ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::UnsupportedMode) })
        }

        fn callback_state_pending<'a>(
            &'a self,
            request: ProviderOAuthCallbackStateRequest,
        ) -> AdapterFuture<'a, Result<bool, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                let registry = crate::provider_auth::session_store::read_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                Ok(registry
                    .lookup_by_state(
                        DEVICE_TEST_PROVIDER.as_str(),
                        &request.state,
                        chrono::Utc::now(),
                    )
                    .map_err(|_| ProviderOAuthAdapterError::Storage)?
                    .is_some())
            })
        }

        fn refresh<'a>(
            &'a self,
            _request: ProviderOAuthRefreshRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError>>
        {
            Box::pin(async { Err(ProviderOAuthAdapterError::UnsupportedMode) })
        }

        fn disconnect<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                let mut registry = crate::provider_auth::session_store::read_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                registry.complete_terminal("mock-device-session");
                crate::provider_auth::session_store::write_session_registry(
                    &self.config_dir,
                    DEVICE_TEST_PROVIDER.as_str(),
                    &registry,
                )
                .await
                .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                Ok(ProviderOAuthStatusView {
                    provider_id: DEVICE_TEST_PROVIDER,
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
                    last_error: None,
                    message: "Mock device login was disconnected.".to_string(),
                })
            })
        }

        fn chat_auth_snapshot<'a>(
            &'a self,
        ) -> AdapterFuture<
            'a,
            Result<Option<ProviderOAuthChatAuthSnapshot>, ProviderOAuthAdapterError>,
        > {
            Box::pin(async { Ok(None) })
        }
    }

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
                last_error: None,
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
                last_error: None,
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
                    return Err(ProviderOAuthAdapterError::ExchangeFailed(
                        CodexTokenExchangeCategory::TokenHttpStatus(0),
                    ));
                }
                Ok(Self::connected_status(Some(true)))
            })
        }

        fn callback_exchange<'a>(
            &'a self,
            request: ProviderOAuthCallbackExchangeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async move {
                if request.state != "safe-state" {
                    return Err(ProviderOAuthAdapterError::InvalidSession);
                }
                if request.code.contains("secret") {
                    return Err(ProviderOAuthAdapterError::ExchangeFailed(
                        CodexTokenExchangeCategory::TokenHttpStatus(0),
                    ));
                }
                Ok(Self::connected_status(Some(true)))
            })
        }

        fn callback_error<'a>(
            &'a self,
            request: ProviderOAuthCallbackErrorRequest,
        ) -> AdapterFuture<'a, Result<(), ProviderOAuthAdapterError>> {
            Box::pin(async move {
                if request.state == "safe-state" {
                    Ok(())
                } else {
                    Err(ProviderOAuthAdapterError::InvalidSession)
                }
            })
        }

        fn callback_state_pending<'a>(
            &'a self,
            request: ProviderOAuthCallbackStateRequest,
        ) -> AdapterFuture<'a, Result<bool, ProviderOAuthAdapterError>> {
            Box::pin(async move { Ok(request.state == "safe-state") })
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
                    last_error: None,
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
                token_endpoint_url: None,
                chat_endpoint_url: None,
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

    #[test]
    fn adapter_status_projection_preserves_api_key_configured_wire_status() {
        let response = ProviderOAuthStatusView {
            provider_id: TEST_PROVIDER,
            kind: ProviderOAuthStatusKind::ApiKeyConfigured,
            configured: true,
            auth_source: "api_key",
            supports_login: false,
            supports_api_key: true,
            cloud_required: false,
            success: None,
            account_label: None,
            redacted: Some("sk-...redacted".to_string()),
            authorization_url: None,
            verification_url: None,
            session_id: None,
            expires_at: None,
            scopes: None,
            poll_interval_seconds: None,
            last_error: None,
            message: "API-key authentication is configured locally.".to_string(),
        }
        .to_response();

        assert_eq!(response.status, "api_key_configured");
        assert!(response.configured);
        assert_eq!(response.auth_source, "api_key");
    }

    #[test]
    fn adapter_internal_terminal_states_map_to_public_error_wire_status() {
        for kind in [
            ProviderOAuthStatusKind::ProviderError,
            ProviderOAuthStatusKind::ExchangeFailed(CodexTokenExchangeCategory::TokenHttpStatus(0)),
            ProviderOAuthStatusKind::StorageError,
        ] {
            let response = ProviderOAuthStatusView {
                provider_id: TEST_PROVIDER,
                kind,
                configured: false,
                auth_source: "none",
                supports_login: true,
                supports_api_key: true,
                cloud_required: false,
                success: Some(false),
                account_label: None,
                redacted: None,
                authorization_url: None,
                verification_url: None,
                session_id: None,
                expires_at: None,
                scopes: None,
                poll_interval_seconds: None,
                last_error: None,
                message: "Mock adapter login failed safely.".to_string(),
            }
            .to_response();

            assert_eq!(response.status, "error");
            assert!(!response.configured);
            assert_eq!(response.auth_source, "none");
        }
    }

    #[tokio::test]
    async fn adapter_callback_hooks_are_part_of_lifecycle_contract() {
        let adapter = TestAdapter;

        assert!(adapter
            .callback_state_pending(ProviderOAuthCallbackStateRequest {
                state: "safe-state".to_string(),
            })
            .await
            .unwrap());
        adapter
            .callback_error(ProviderOAuthCallbackErrorRequest {
                state: "safe-state".to_string(),
            })
            .await
            .unwrap();
        let status = adapter
            .callback_exchange(ProviderOAuthCallbackExchangeRequest {
                state: "safe-state".to_string(),
                code: "authorization-code".to_string(),
            })
            .await
            .unwrap();

        assert_eq!(status.to_response().status, "connected");
    }

    #[tokio::test]
    async fn device_flow_adapter_proof_uses_shared_session_registry_and_status_contract() {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-device-flow-adapter-proof-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let adapter = DeviceFlowProofAdapter::new(dir.clone());
        let dispatch = ProviderOAuthAdapterDispatch::new(vec![&adapter]);
        let capabilities = adapter.capabilities();

        assert_eq!(adapter.provider_id().as_str(), "openai-compatible");
        assert!(capabilities.supports_mode(ProviderOAuthAuthMode::DeviceCode));
        assert!(!capabilities.supports_mode(ProviderOAuthAuthMode::BrowserPkce));
        assert!(capabilities.login_allowed());

        let start = dispatch
            .start_session(
                "openai-compatible",
                ProviderOAuthStartSessionRequest {
                    mode: ProviderOAuthAuthMode::DeviceCode,
                    ttl_seconds: Some(600),
                    token_endpoint_url: None,
                    chat_endpoint_url: None,
                },
            )
            .await
            .unwrap();
        let pending_response = start.status.to_response();

        assert_eq!(pending_response.provider, "openai-compatible");
        assert_eq!(pending_response.status, "pending");
        assert_eq!(pending_response.auth_source, "device");
        assert!(pending_response.authorization_url.is_none());
        assert!(pending_response.verification_url.is_some());
        assert_response_has_no_secret(&pending_response);

        let registry =
            crate::provider_auth::session_store::read_session_registry(&dir, "openai-compatible")
                .await
                .unwrap();
        let session = registry
            .lookup(
                "openai-compatible",
                "mock-device-session",
                "mock-device-state",
                chrono::Utc::now(),
            )
            .unwrap()
            .expect("device session should use shared registry");
        assert_eq!(
            session.mode,
            crate::provider_auth::session_registry::ProviderAuthPendingMode::Device
        );

        assert!(dispatch
            .callback_state_pending(
                "openai-compatible",
                ProviderOAuthCallbackStateRequest {
                    state: "mock-device-state".to_string(),
                },
            )
            .await
            .unwrap());
        let connected = dispatch
            .exchange_code(
                "openai-compatible",
                ProviderOAuthExchangeCodeRequest {
                    session_id: "mock-device-session".to_string(),
                    state: "mock-device-state".to_string(),
                    code: "device-approved-code".to_string(),
                },
            )
            .await
            .unwrap()
            .to_response();

        assert_eq!(connected.status, "connected");
        assert_eq!(connected.auth_source, "device");
        assert_response_has_no_secret(&connected);
        assert!(crate::provider_auth::session_store::read_session_registry(
            &dir,
            "openai-compatible",
        )
        .await
        .unwrap()
        .lookup_by_state("openai-compatible", "mock-device-state", chrono::Utc::now(),)
        .unwrap()
        .is_none());
    }

    #[tokio::test]
    async fn unsupported_adapter_mode_maps_to_existing_provider_auth_error() {
        let adapter = TestAdapter;
        let error = adapter
            .start_session(ProviderOAuthStartSessionRequest {
                mode: ProviderOAuthAuthMode::ManualCode,
                ttl_seconds: None,
                token_endpoint_url: None,
                chat_endpoint_url: None,
            })
            .await
            .unwrap_err();
        let public_error: ProviderAuthError = error.into();

        assert!(matches!(public_error, ProviderAuthError::InvalidRequest));
    }
}

use std::path::{Path, PathBuf};

use super::{
    AdapterFuture, ProviderOAuthAdapter, ProviderOAuthAdapterError, ProviderOAuthAuthMode,
    ProviderOAuthCallbackErrorRequest, ProviderOAuthCallbackExchangeRequest,
    ProviderOAuthCallbackStateRequest, ProviderOAuthCapabilities, ProviderOAuthChatAuthSnapshot,
    ProviderOAuthExchangeCodeRequest, ProviderOAuthPolicyGate, ProviderOAuthProviderId,
    ProviderOAuthRefreshOutcome, ProviderOAuthRefreshRequest, ProviderOAuthStartSession,
    ProviderOAuthStartSessionRequest, ProviderOAuthStatusKind, ProviderOAuthStatusView,
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
        let codex = crate::provider_auth::read_codex_state(&self.config_dir, self.provider).await?;
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
        callback_port: u16,
    ) -> Result<ProviderAuthResponse, ProviderAuthError> {
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
            callback_port,
        )?;
        crate::provider_auth::write_codex_state(
            &self.config_dir,
            self.provider,
            &crate::provider_auth::types::CodexOAuthState {
                pending: Some(session.clone()),
                ..Default::default()
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
            &session.session_id,
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
            Err(ProviderAuthError::TokenExchange(
                CodexTokenExchangeCategory::ModelDiscoveryFallback,
                _,
            )) => {
                crate::provider_auth::validate_codex_chat_model(&session.chat_model)?;
                session.chat_model.clone()
            }
            Err(error) => return Err(error),
        };
        let scopes =
            crate::provider_auth::codex_token_scopes(token.scope.as_deref(), &session.scopes)?;
        let expires_at =
            crate::provider_auth::codex_token_expires_at(token.expires_in)?.to_rfc3339();
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
        stage: &'static str,
        session_id: String,
        state: String,
        code: String,
    ) -> Result<ProviderAuthResponse, ProviderAuthError> {
        crate::provider_auth::codex_exchange(
            &self.config_dir,
            self.provider,
            stage,
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
        accepted_port: u16,
    ) -> Result<ProviderAuthResponse, ProviderAuthError> {
        let codex = crate::provider_auth::read_codex_state(&self.config_dir, self.provider).await?;
        let Some(session) = codex.pending else {
            return Err(ProviderAuthError::SessionNotFound);
        };
        if session.state != state {
            return Err(ProviderAuthError::SessionMismatch);
        }
        crate::provider_auth::validate_codex_callback_port(&session, accepted_port)?;
        self.exchange_response("callback", session.session_id, state, code)
            .await
    }

    pub(in crate::provider_auth) async fn callback_error(
        &self,
        state: String,
        accepted_port: u16,
    ) -> Result<(), ProviderAuthError> {
        crate::provider_auth::codex_callback_error_impl(
            &self.config_dir,
            self.provider,
            state,
            accepted_port,
        )
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
        let codex = crate::provider_auth::read_codex_state(&self.config_dir, self.provider).await?;
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
            || codex.terminal_diagnostic.is_some()
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
        self.refresh_chat_auth(None).await
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
            verification_url: None,
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
            let mut response = match self
                .status_response()
                .await
                .map_err(super::adapter_error_from_provider_auth)?
            {
                Some(response) => response,
                None => crate::provider_auth::status::status_response(
                    self.provider,
                    crate::provider_auth::configured_api_key(&self.config_dir, self.provider)
                        .await
                        .map_err(|_| ProviderOAuthAdapterError::Storage)?,
                    None,
                ),
            };
            if response.status != "pending" && response.status != "connected" {
                let codex = crate::provider_auth::read_codex_state(&self.config_dir, self.provider)
                    .await
                    .map_err(|_| ProviderOAuthAdapterError::Storage)?;
                if let Some(last_error) = codex
                    .terminal_diagnostic
                    .as_ref()
                    .and_then(crate::provider_auth::terminal_codex_last_error)
                {
                    response.last_error = Some(last_error);
                    if response.status == "login_unavailable" {
                        response.status = "error";
                        response.supports_login = true;
                        response.message = "Provider account login failed permanently. Start a fresh login or use the API-key fallback.".to_string();
                    }
                }
            }
            Ok(Self::status_view_from_response(response))
        })
    }

    fn start_session<'a>(
        &'a self,
        request: ProviderOAuthStartSessionRequest,
    ) -> AdapterFuture<'a, Result<ProviderOAuthStartSession, ProviderOAuthAdapterError>> {
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
                    request.callback_port,
                )
                .await
                .map_err(super::adapter_error_from_provider_auth)?;
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
                .exchange_response(
                    "manual_exchange",
                    request.session_id,
                    request.state,
                    request.code,
                )
                .await
                .map_err(|error| match error {
                    ProviderAuthError::SessionExpired => ProviderOAuthAdapterError::SessionExpired,
                    ProviderAuthError::SessionMismatch => ProviderOAuthAdapterError::InvalidSession,
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
                        CodexTokenExchangeCategory::AdapterFailure,
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
                .callback_exchange(request.state, request.code, request.accepted_port)
                .await
                .map_err(|error| match error {
                    ProviderAuthError::SessionExpired => ProviderOAuthAdapterError::SessionExpired,
                    ProviderAuthError::SessionMismatch => ProviderOAuthAdapterError::InvalidSession,
                    ProviderAuthError::SessionNotFound => {
                        ProviderOAuthAdapterError::SessionNotFound
                    }
                    ProviderAuthError::CallbackPortMismatch => {
                        ProviderOAuthAdapterError::CallbackPortMismatch
                    }
                    ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
                    ProviderAuthError::TokenExchange(category, Some(detail)) => {
                        ProviderOAuthAdapterError::ExchangeFailedDetail(category, detail)
                    }
                    ProviderAuthError::TokenExchange(category, None) => {
                        ProviderOAuthAdapterError::ExchangeFailed(category)
                    }
                    _ => ProviderOAuthAdapterError::ExchangeFailed(
                        CodexTokenExchangeCategory::AdapterFailure,
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
            self.callback_error(request.state, request.accepted_port)
                .await
                .map_err(|error| match error {
                    ProviderAuthError::SessionExpired => ProviderOAuthAdapterError::SessionExpired,
                    ProviderAuthError::SessionMismatch => ProviderOAuthAdapterError::InvalidSession,
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
                    ProviderAuthError::CallbackUnavailable => {
                        ProviderOAuthAdapterError::CallbackUnavailable
                    }
                    ProviderAuthError::CallbackPortMismatch => {
                        ProviderOAuthAdapterError::CallbackPortMismatch
                    }
                    _ => ProviderOAuthAdapterError::AdapterFailure,
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
    ) -> AdapterFuture<'a, Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError>> {
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
                ProviderAuthError::TokenExchange(category, Some(detail)) => {
                    ProviderOAuthAdapterError::ExchangeFailedDetail(category, detail)
                }
                ProviderAuthError::TokenExchange(category, None) => {
                    ProviderOAuthAdapterError::ExchangeFailed(category)
                }
                _ => ProviderOAuthAdapterError::ExchangeFailed(
                    CodexTokenExchangeCategory::AdapterFailure,
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
    ) -> AdapterFuture<'a, Result<Option<ProviderOAuthChatAuthSnapshot>, ProviderOAuthAdapterError>>
    {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_codex_adapter_declares_browser_manual_refresh_and_secret_snapshot_support() {
        let dir = std::env::temp_dir().join("yet-ai-openai-codex-adapter-capabilities-test");
        let adapter = OpenAiCodexOAuthAdapter::new(&dir, "openai");
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
}

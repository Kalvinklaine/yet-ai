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
        let auth_source = match self.auth_source {
            "api_key" => "api_key",
            "oauth" => "oauth",
            _ => "none",
        };
        ProviderAuthResponse {
            provider: self.provider_id.as_str().to_string(),
            configured: self.configured,
            status: self.kind.wire_status(),
            auth_source,
            supports_login: self.supports_login,
            supports_api_key: self.supports_api_key,
            cloud_required: self.cloud_required,
            success: self.success,
            account_label: self.account_label.clone(),
            redacted: self.redacted.clone(),
            authorization_url: self.authorization_url.clone(),
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
    pub(super) callback_port: Option<u16>,
}

impl Default for ProviderOAuthStartSessionRequest {
    fn default() -> Self {
        Self {
            mode: ProviderOAuthAuthMode::BrowserPkce,
            ttl_seconds: None,
            token_endpoint_url: None,
            chat_endpoint_url: None,
            callback_port: None,
        }
    }
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

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ProviderOAuthAdapterError {
    UnsupportedMode,
    PolicyBlocked,
    ProviderRejected,
    CallbackUnavailable,
    AdapterFailure,
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
            ProviderOAuthAdapterError::ProviderRejected => {
                ProviderAuthError::token_exchange(CodexTokenExchangeCategory::ProviderRejected)
            }
            ProviderOAuthAdapterError::CallbackUnavailable => {
                ProviderAuthError::CallbackUnavailable
            }
            ProviderOAuthAdapterError::AdapterFailure => {
                ProviderAuthError::token_exchange(CodexTokenExchangeCategory::AdapterFailure)
            }
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

fn adapter_error_from_provider_auth(error: ProviderAuthError) -> ProviderOAuthAdapterError {
    match error {
        ProviderAuthError::Storage => ProviderOAuthAdapterError::Storage,
        ProviderAuthError::InvalidRequest => ProviderOAuthAdapterError::PolicyBlocked,
        ProviderAuthError::CallbackUnavailable => ProviderOAuthAdapterError::CallbackUnavailable,
        ProviderAuthError::TokenExchange(category, Some(detail)) => {
            ProviderOAuthAdapterError::ExchangeFailedDetail(category, detail)
        }
        ProviderAuthError::TokenExchange(category, None) => {
            ProviderOAuthAdapterError::ExchangeFailed(category)
        }
        _ => ProviderOAuthAdapterError::AdapterFailure,
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

pub(in crate::provider_auth) mod openai_codex;

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PROVIDER: ProviderOAuthProviderId = ProviderOAuthProviderId::new("openai");

    struct TestAdapter;

    struct CallbackUnavailableAdapter;

    impl ProviderOAuthAdapter for CallbackUnavailableAdapter {
        fn provider_id(&self) -> ProviderOAuthProviderId {
            TEST_PROVIDER
        }

        fn display_label(&self) -> &'static str {
            "Unavailable Callback Provider"
        }

        fn capabilities(&self) -> ProviderOAuthCapabilities {
            TestAdapter.capabilities()
        }

        fn status<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::CallbackUnavailable) })
        }

        fn start_session<'a>(
            &'a self,
            _request: ProviderOAuthStartSessionRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStartSession, ProviderOAuthAdapterError>>
        {
            Box::pin(async { Err(ProviderOAuthAdapterError::CallbackUnavailable) })
        }

        fn exchange_code<'a>(
            &'a self,
            _request: ProviderOAuthExchangeCodeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::AdapterFailure) })
        }

        fn callback_exchange<'a>(
            &'a self,
            _request: ProviderOAuthCallbackExchangeRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::AdapterFailure) })
        }

        fn callback_error<'a>(
            &'a self,
            _request: ProviderOAuthCallbackErrorRequest,
        ) -> AdapterFuture<'a, Result<(), ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::AdapterFailure) })
        }

        fn callback_state_pending<'a>(
            &'a self,
            _request: ProviderOAuthCallbackStateRequest,
        ) -> AdapterFuture<'a, Result<bool, ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::AdapterFailure) })
        }

        fn refresh<'a>(
            &'a self,
            _request: ProviderOAuthRefreshRequest,
        ) -> AdapterFuture<'a, Result<ProviderOAuthRefreshOutcome, ProviderOAuthAdapterError>>
        {
            Box::pin(async { Err(ProviderOAuthAdapterError::AdapterFailure) })
        }

        fn disconnect<'a>(
            &'a self,
        ) -> AdapterFuture<'a, Result<ProviderOAuthStatusView, ProviderOAuthAdapterError>> {
            Box::pin(async { Err(ProviderOAuthAdapterError::AdapterFailure) })
        }

        fn chat_auth_snapshot<'a>(
            &'a self,
        ) -> AdapterFuture<
            'a,
            Result<Option<ProviderOAuthChatAuthSnapshot>, ProviderOAuthAdapterError>,
        > {
            Box::pin(async { Err(ProviderOAuthAdapterError::AdapterFailure) })
        }
    }

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
                    return Err(ProviderOAuthAdapterError::ProviderRejected);
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
                    return Err(ProviderOAuthAdapterError::ProviderRejected);
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
                    return Err(ProviderOAuthAdapterError::ProviderRejected);
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
                callback_port: None,
            })
            .await
            .unwrap();
        let response = start.status.to_response();

        assert_eq!(response.provider, "openai");
        assert_eq!(response.status, "pending");
        assert_eq!(response.auth_source, "oauth");
        assert_eq!(response.success, Some(true));
        let json = serde_json::to_value(&response).unwrap();
        assert!(json.get("verificationUrl").is_none());
        assert_eq!(json["pollIntervalSeconds"], 1);
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
    fn adapter_status_projection_rejects_internal_flow_sources() {
        for auth_source in ["device", "browser"] {
            let response = ProviderOAuthStatusView {
                provider_id: TEST_PROVIDER,
                kind: ProviderOAuthStatusKind::Pending,
                configured: false,
                auth_source,
                supports_login: true,
                supports_api_key: true,
                cloud_required: false,
                success: None,
                account_label: None,
                redacted: None,
                authorization_url: None,
                verification_url: Some("http://127.0.0.1/internal-verification".to_string()),
                session_id: Some("safe-session".to_string()),
                expires_at: Some("2030-01-01T00:00:00Z".to_string()),
                scopes: None,
                poll_interval_seconds: Some(5),
                last_error: None,
                message: "Mock adapter login is pending.".to_string(),
            }
            .to_response();
            let json = serde_json::to_value(response).unwrap();

            assert_eq!(json["authSource"], "none");
            assert!(json.get("verificationUrl").is_none());
            assert_eq!(json["pollIntervalSeconds"], 5);
        }
    }

    #[test]
    fn adapter_internal_terminal_states_map_to_public_error_wire_status() {
        for kind in [
            ProviderOAuthStatusKind::ProviderError,
            ProviderOAuthStatusKind::ExchangeFailed(CodexTokenExchangeCategory::AdapterFailure),
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
                    callback_port: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(start.status.provider_id.as_str(), "openai-compatible");
        assert_eq!(start.status.kind, ProviderOAuthStatusKind::Pending);
        assert_eq!(start.status.auth_source, "device");
        assert!(start.status.authorization_url.is_none());
        assert!(start.status.verification_url.is_some());
        assert_eq!(start.status.poll_interval_seconds, Some(5));

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
            .unwrap();

        assert_eq!(connected.kind, ProviderOAuthStatusKind::Connected);
        assert_eq!(connected.auth_source, "device");
        assert!(connected.verification_url.is_none());
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
                callback_port: None,
            })
            .await
            .unwrap_err();
        let public_error: ProviderAuthError = error.into();

        assert!(matches!(public_error, ProviderAuthError::InvalidRequest));
    }

    #[tokio::test]
    async fn adapter_status_and_start_preserve_callback_unavailable_semantics() {
        let adapter = CallbackUnavailableAdapter;
        let dispatch = ProviderOAuthAdapterDispatch::single(&adapter);

        let status_error: ProviderAuthError = dispatch.status("openai").await.unwrap_err().into();
        assert!(matches!(
            status_error,
            ProviderAuthError::CallbackUnavailable
        ));
        assert_eq!(status_error.status(), http::StatusCode::SERVICE_UNAVAILABLE);

        let start_error: ProviderAuthError = dispatch
            .start_session(
                "openai",
                ProviderOAuthStartSessionRequest {
                    mode: ProviderOAuthAuthMode::BrowserPkce,
                    ttl_seconds: None,
                    token_endpoint_url: None,
                    chat_endpoint_url: None,
                    callback_port: None,
                },
            )
            .await
            .unwrap_err()
            .into();
        assert!(matches!(
            start_error,
            ProviderAuthError::CallbackUnavailable
        ));
        assert_eq!(start_error.status(), http::StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn adapter_error_mapping_preserves_exchange_taxonomy_and_storage_semantics() {
        let cases = [
            (
                ProviderOAuthAdapterError::ProviderRejected,
                CodexTokenExchangeCategory::ProviderRejected,
                None,
            ),
            (
                ProviderOAuthAdapterError::ExchangeFailed(
                    CodexTokenExchangeCategory::RefreshTokenReused,
                ),
                CodexTokenExchangeCategory::RefreshTokenReused,
                None,
            ),
            (
                ProviderOAuthAdapterError::ExchangeFailedDetail(
                    CodexTokenExchangeCategory::TokenHttpStatus(429),
                    "http_status=429; oauth_error=slow_down".to_string(),
                ),
                CodexTokenExchangeCategory::TokenHttpStatus(429),
                Some("http_status=429; oauth_error=slow_down"),
            ),
        ];

        for (adapter_error, expected_category, expected_detail) in cases {
            let public_error: ProviderAuthError = adapter_error.into();
            match public_error {
                ProviderAuthError::TokenExchange(category, detail) => {
                    assert_eq!(category, expected_category);
                    assert_eq!(detail.as_deref(), expected_detail);
                    assert_eq!(public_error_status(category), http::StatusCode::BAD_GATEWAY);
                }
                other => panic!("unexpected mapped error: {other:?}"),
            }
        }

        let storage: ProviderAuthError = ProviderOAuthAdapterError::Storage.into();
        assert!(matches!(&storage, ProviderAuthError::Storage));
        assert_eq!(storage.status(), http::StatusCode::INTERNAL_SERVER_ERROR);
    }

    fn public_error_status(category: CodexTokenExchangeCategory) -> http::StatusCode {
        ProviderAuthError::token_exchange(category).status()
    }
}

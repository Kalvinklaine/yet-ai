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

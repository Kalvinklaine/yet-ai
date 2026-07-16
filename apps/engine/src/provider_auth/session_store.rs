use std::path::Path;

use chrono::Utc;

use super::session_registry::{ProviderAuthSessionRegistry, ProviderAuthSessionRegistryState};
use super::{read_provider_auth_state, write_provider_auth_state, ProviderAuthError};

const PROVIDER_AUTH_SESSION_REGISTRY_TREE: &str = "provider-auth-sessions";

pub(super) async fn read_session_registry(
    config_dir: &Path,
    provider: &str,
) -> Result<ProviderAuthSessionRegistry, ProviderAuthError> {
    let state: ProviderAuthSessionRegistryState =
        read_provider_auth_state(config_dir, PROVIDER_AUTH_SESSION_REGISTRY_TREE, provider).await?;
    ProviderAuthSessionRegistry::from_state(state, Utc::now())
}

pub(super) async fn write_session_registry(
    config_dir: &Path,
    provider: &str,
    registry: &ProviderAuthSessionRegistry,
) -> Result<(), ProviderAuthError> {
    write_provider_auth_state(
        config_dir,
        PROVIDER_AUTH_SESSION_REGISTRY_TREE,
        provider,
        &registry.to_state(),
    )
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_auth::session_registry::{
        ProviderAuthPendingMode, ProviderAuthPendingSession,
    };

    static TEST_DIR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-provider-auth-session-store-test-{}-{}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn session(session_id: &str, state: &str, seconds: i64) -> ProviderAuthPendingSession {
        ProviderAuthPendingSession {
            provider: "openai".to_string(),
            session_id: session_id.to_string(),
            state: state.to_string(),
            mode: ProviderAuthPendingMode::BrowserPkce,
            expires_at: (Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339(),
            callback_owner: Some("loopback".to_string()),
            token_endpoint_id: Some("codex-like".to_string()),
        }
    }

    #[tokio::test]
    async fn registry_store_round_trips_rehydratable_pending_sessions() {
        let dir = temp_dir();
        let now = Utc::now();
        let mut registry = ProviderAuthSessionRegistry::default();
        registry.insert(session("s1", "state-1", 60));

        write_session_registry(&dir, "openai", &registry)
            .await
            .unwrap();
        let loaded = read_session_registry(&dir, "openai").await.unwrap();

        assert!(loaded
            .lookup("openai", "s1", "state-1", now)
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn registry_store_prunes_expired_sessions_on_rehydration() {
        let dir = temp_dir();
        let mut registry = ProviderAuthSessionRegistry::default();
        registry.insert(session("expired", "old", -60));
        registry.insert(session("fresh", "new", 60));

        write_session_registry(&dir, "openai", &registry)
            .await
            .unwrap();
        let loaded = read_session_registry(&dir, "openai").await.unwrap();

        assert!(loaded
            .lookup_by_state("openai", "old", Utc::now())
            .unwrap()
            .is_none());
        assert!(loaded
            .lookup_by_state("openai", "new", Utc::now())
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn registry_store_persists_terminal_cleanup() {
        let dir = temp_dir();
        let mut registry = ProviderAuthSessionRegistry::default();
        registry.insert(session("s1", "state-1", 60));
        write_session_registry(&dir, "openai", &registry)
            .await
            .unwrap();

        let mut loaded = read_session_registry(&dir, "openai").await.unwrap();
        assert!(loaded.complete_terminal("s1"));
        write_session_registry(&dir, "openai", &loaded)
            .await
            .unwrap();
        let reloaded = read_session_registry(&dir, "openai").await.unwrap();

        assert!(reloaded
            .lookup_by_state("openai", "state-1", Utc::now())
            .unwrap()
            .is_none());
    }
}

#![allow(dead_code)]

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{parse_time, ProviderAuthError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ProviderAuthPendingMode {
    BrowserPkce,
    Device,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ProviderAuthPendingRetention {
    Terminal,
    Retryable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProviderAuthPendingSession {
    pub(super) provider: String,
    pub(super) session_id: String,
    pub(super) state: String,
    pub(super) mode: ProviderAuthPendingMode,
    pub(super) expires_at: String,
    pub(super) callback_owner: Option<String>,
    pub(super) token_endpoint_id: Option<String>,
}

impl ProviderAuthPendingSession {
    pub(super) fn expires_at(&self) -> Result<DateTime<Utc>, ProviderAuthError> {
        parse_time(&self.expires_at)
    }

    fn is_unexpired_at(&self, now: DateTime<Utc>) -> Result<bool, ProviderAuthError> {
        Ok(self.expires_at()? > now)
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProviderAuthSessionRegistryState {
    pub(super) pending: Vec<ProviderAuthPendingSession>,
}

#[derive(Debug, Default, Clone)]
pub(super) struct ProviderAuthSessionRegistry {
    sessions: HashMap<String, ProviderAuthPendingSession>,
    states: HashMap<String, String>,
}

impl ProviderAuthSessionRegistry {
    pub(super) fn from_state(
        state: ProviderAuthSessionRegistryState,
        now: DateTime<Utc>,
    ) -> Result<Self, ProviderAuthError> {
        let mut registry = Self::default();
        for session in state.pending {
            if session.is_unexpired_at(now)? {
                registry.insert(session);
            }
        }
        Ok(registry)
    }

    pub(super) fn to_state(&self) -> ProviderAuthSessionRegistryState {
        ProviderAuthSessionRegistryState {
            pending: self.sessions.values().cloned().collect(),
        }
    }

    pub(super) fn insert(&mut self, session: ProviderAuthPendingSession) {
        if let Some(previous) = self.sessions.remove(&session.session_id) {
            self.states.remove(&previous.state);
        }
        if let Some(previous_session_id) = self.states.remove(&session.state) {
            self.sessions.remove(&previous_session_id);
        }
        self.states
            .insert(session.state.clone(), session.session_id.clone());
        self.sessions.insert(session.session_id.clone(), session);
    }

    pub(super) fn lookup_by_state(
        &self,
        provider: &str,
        state: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<&ProviderAuthPendingSession>, ProviderAuthError> {
        let Some(session_id) = self.states.get(state) else {
            return Ok(None);
        };
        let Some(session) = self.sessions.get(session_id) else {
            return Ok(None);
        };
        if session.provider == provider && session.is_unexpired_at(now)? {
            Ok(Some(session))
        } else {
            Ok(None)
        }
    }

    pub(super) fn lookup(
        &self,
        provider: &str,
        session_id: &str,
        state: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<&ProviderAuthPendingSession>, ProviderAuthError> {
        let Some(session) = self.sessions.get(session_id) else {
            return Ok(None);
        };
        if session.provider == provider && session.state == state && session.is_unexpired_at(now)? {
            Ok(Some(session))
        } else {
            Ok(None)
        }
    }

    pub(super) fn complete_terminal(&mut self, session_id: &str) -> bool {
        let Some(session) = self.sessions.remove(session_id) else {
            return false;
        };
        self.states.remove(&session.state);
        true
    }

    pub(super) fn retain_after_exchange_failure(
        &mut self,
        session_id: &str,
        retention: ProviderAuthPendingRetention,
        now: DateTime<Utc>,
    ) -> Result<bool, ProviderAuthError> {
        match retention {
            ProviderAuthPendingRetention::Terminal => Ok(self.complete_terminal(session_id)),
            ProviderAuthPendingRetention::Retryable => {
                let Some(session) = self.sessions.get(session_id) else {
                    return Ok(false);
                };
                if session.is_unexpired_at(now)? {
                    Ok(true)
                } else {
                    Ok(self.complete_terminal(session_id))
                }
            }
        }
    }

    pub(super) fn prune_expired(
        &mut self,
        now: DateTime<Utc>,
    ) -> Result<Vec<ProviderAuthPendingSession>, ProviderAuthError> {
        let mut expired = Vec::new();
        let mut expired_ids = Vec::new();
        for session in self.sessions.values() {
            if !session.is_unexpired_at(now)? {
                expired_ids.push(session.session_id.clone());
            }
        }
        for session_id in expired_ids {
            if let Some(session) = self.sessions.remove(&session_id) {
                self.states.remove(&session.state);
                expired.push(session);
            }
        }
        Ok(expired)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn future(seconds: i64) -> String {
        (Utc::now() + chrono::Duration::seconds(seconds)).to_rfc3339()
    }

    fn session(
        provider: &str,
        session_id: &str,
        state: &str,
        seconds: i64,
    ) -> ProviderAuthPendingSession {
        ProviderAuthPendingSession {
            provider: provider.to_string(),
            session_id: session_id.to_string(),
            state: state.to_string(),
            mode: ProviderAuthPendingMode::BrowserPkce,
            expires_at: future(seconds),
            callback_owner: Some("loopback".to_string()),
            token_endpoint_id: Some("codex-like".to_string()),
        }
    }

    #[test]
    fn direct_state_lookup_is_provider_scoped_and_unexpired() {
        let now = Utc::now();
        let mut registry = ProviderAuthSessionRegistry::default();
        registry.insert(session("openai", "s1", "state-1", 60));

        assert_eq!(
            registry
                .lookup_by_state("openai", "state-1", now)
                .unwrap()
                .map(|session| session.session_id.as_str()),
            Some("s1")
        );
        assert!(registry
            .lookup_by_state("openai-compatible", "state-1", now)
            .unwrap()
            .is_none());
        assert!(registry
            .lookup("openai", "s1", "wrong-state", now)
            .unwrap()
            .is_none());
    }

    #[test]
    fn duplicate_session_or_state_replaces_old_mapping() {
        let now = Utc::now();
        let mut registry = ProviderAuthSessionRegistry::default();
        registry.insert(session("openai", "s1", "state-1", 60));
        registry.insert(session("openai", "s1", "state-2", 60));
        registry.insert(session("openai", "s2", "state-2", 60));

        assert!(registry
            .lookup_by_state("openai", "state-1", now)
            .unwrap()
            .is_none());
        assert!(registry
            .lookup("openai", "s1", "state-2", now)
            .unwrap()
            .is_none());
        assert_eq!(
            registry
                .lookup_by_state("openai", "state-2", now)
                .unwrap()
                .map(|session| session.session_id.as_str()),
            Some("s2")
        );
    }

    #[test]
    fn expired_sessions_are_pruned_on_rehydration_and_explicit_cleanup() {
        let now = Utc::now();
        let state = ProviderAuthSessionRegistryState {
            pending: vec![
                session("openai", "expired", "old", -60),
                session("openai", "fresh", "new", 60),
            ],
        };
        let mut registry = ProviderAuthSessionRegistry::from_state(state, now).unwrap();

        assert!(registry
            .lookup_by_state("openai", "old", now)
            .unwrap()
            .is_none());
        assert!(registry
            .lookup_by_state("openai", "new", now)
            .unwrap()
            .is_some());

        let later = now + chrono::Duration::seconds(120);
        let expired = registry.prune_expired(later).unwrap();
        assert_eq!(expired.len(), 1);
        assert!(registry
            .lookup_by_state("openai", "new", later)
            .unwrap()
            .is_none());
    }

    #[test]
    fn retryable_retention_preserves_unexpired_session_but_terminal_removes() {
        let now = Utc::now();
        let mut registry = ProviderAuthSessionRegistry::default();
        registry.insert(session("openai", "s1", "state-1", 60));

        assert!(registry
            .retain_after_exchange_failure("s1", ProviderAuthPendingRetention::Retryable, now)
            .unwrap());
        assert!(registry
            .lookup_by_state("openai", "state-1", now)
            .unwrap()
            .is_some());

        assert!(registry
            .retain_after_exchange_failure("s1", ProviderAuthPendingRetention::Terminal, now)
            .unwrap());
        assert!(registry
            .lookup_by_state("openai", "state-1", now)
            .unwrap()
            .is_none());
    }

    #[test]
    fn state_round_trip_preserves_rehydration_shape() {
        let now = Utc::now();
        let mut registry = ProviderAuthSessionRegistry::default();
        registry.insert(session("openai", "s1", "state-1", 60));
        registry.insert(ProviderAuthPendingSession {
            mode: ProviderAuthPendingMode::Device,
            callback_owner: None,
            token_endpoint_id: None,
            ..session("openai-compatible", "s2", "state-2", 60)
        });

        let state = registry.to_state();
        let rehydrated = ProviderAuthSessionRegistry::from_state(state, now).unwrap();

        assert!(rehydrated
            .lookup("openai", "s1", "state-1", now)
            .unwrap()
            .is_some());
        assert!(rehydrated
            .lookup("openai-compatible", "s2", "state-2", now)
            .unwrap()
            .is_some());
    }
}

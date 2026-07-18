use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use sha2::{Digest, Sha256};

use super::types::CodexTokenExchangeCategory;

static QUARANTINED_REFRESH_TOKENS: LazyLock<Mutex<HashMap<[u8; 32], CodexTokenExchangeCategory>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn token_key(config_dir: &Path, provider: &str, refresh_token: &str) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(config_dir.as_os_str().as_encoded_bytes());
    digest.update([0]);
    digest.update(provider.as_bytes());
    digest.update([0]);
    digest.update(refresh_token.as_bytes());
    digest.finalize().into()
}

pub(super) fn quarantine(
    config_dir: &Path,
    provider: &str,
    refresh_token: &str,
    category: CodexTokenExchangeCategory,
) {
    if refresh_token.is_empty() {
        return;
    }
    if let Ok(mut tokens) = QUARANTINED_REFRESH_TOKENS.lock() {
        tokens.insert(token_key(config_dir, provider, refresh_token), category);
    }
}

pub(super) fn quarantined_category(
    config_dir: &Path,
    provider: &str,
    refresh_token: &str,
) -> Option<CodexTokenExchangeCategory> {
    if refresh_token.is_empty() {
        return None;
    }
    QUARANTINED_REFRESH_TOKENS
        .lock()
        .ok()?
        .get(&token_key(config_dir, provider, refresh_token))
        .copied()
}

#[cfg(test)]
mod tests {
    #[test]
    fn quarantine_is_scoped_by_provider_and_token() {
        let token = format!("refresh-guard-test-{}", std::process::id());
        let config_dir = std::path::Path::new("refresh-guard-config-a");
        super::quarantine(
            config_dir,
            "openai",
            &token,
            crate::provider_auth::CodexTokenExchangeCategory::ProviderRejected,
        );

        assert_eq!(
            super::quarantined_category(config_dir, "openai", &token),
            Some(crate::provider_auth::CodexTokenExchangeCategory::ProviderRejected)
        );
        assert_eq!(
            super::quarantined_category(config_dir, "openai-compatible", &token),
            None
        );
        assert_eq!(
            super::quarantined_category(config_dir, "openai", "different-token"),
            None
        );
        assert_eq!(
            super::quarantined_category(
                std::path::Path::new("refresh-guard-config-b"),
                "openai",
                &token,
            ),
            None
        );
    }

    #[test]
    fn quarantine_key_is_a_config_scoped_hash_without_raw_token_bytes() {
        let token = "refresh-guard-raw-token-must-not-be-stored";
        let first = super::token_key(
            std::path::Path::new("refresh-guard-config-a"),
            "openai",
            token,
        );
        let second = super::token_key(
            std::path::Path::new("refresh-guard-config-b"),
            "openai",
            token,
        );

        assert_ne!(first, second);
        assert_ne!(first.as_slice(), token.as_bytes());
        assert_eq!(first.len(), 32);
    }
}

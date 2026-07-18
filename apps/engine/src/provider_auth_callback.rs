use std::collections::{HashMap, HashSet};
#[cfg(not(test))]
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use http::StatusCode;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::provider_auth;

#[cfg(not(test))]
const CALLBACK_PORT: u16 = 1455;
const CALLBACK_READ_MAX_BYTES: usize = 8192;
const CALLBACK_SUCCESS_TEXT: &str = "Login received. Return to Yet AI.";
const CALLBACK_FAILURE_TEXT: &str = "Login could not be completed. Return to Yet AI and try again.";
const CALLBACK_NOT_FOUND_TEXT: &str =
    "Login request was not found or expired. Return to Yet AI and try again.";
const CALLBACK_PROVIDER_ERROR_TEXT: &str =
    "Login was cancelled by the provider. Return to Yet AI and start login again.";
const CALLBACK_EXCHANGE_FAILURE_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (token_http_status). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_HTTP_FAILED_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (token_http_failed_or_timeout). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_PROVIDER_REJECTED_TEXT: &str =
    "Login reached Yet AI but the provider rejected credential exchange (provider_rejected). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_REFRESH_REJECTED_TEXT: &str =
    "Login reached Yet AI but the refresh token was reused (refresh_token_reused). Return to Yet AI and reconnect login or use API-key fallback.";
const CALLBACK_EXCHANGE_ADAPTER_FAILURE_TEXT: &str =
    "Login reached Yet AI but the provider adapter failed (adapter_failure). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_JSON_INVALID_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (token_json_invalid). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_ACCESS_MISSING_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (token_access_missing). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_ACCOUNT_MISSING_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (account_id_missing). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_EXPIRES_INVALID_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (expires_invalid). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_SCOPES_INVALID_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (scopes_invalid). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_STORAGE_FAILED_TEXT: &str =
    "Login reached Yet AI but credential exchange failed (storage_failed). Return to Yet AI and retry login or use API-key fallback.";
const CALLBACK_EXCHANGE_MODEL_FALLBACK_TEXT: &str =
    "Login reached Yet AI but credential exchange used a safe model discovery fallback (model_discovery_fallback). Return to Yet AI.";
const CALLBACK_STORAGE_FAILURE_TEXT: &str =
    "Login reached Yet AI but local credential storage failed. Return to Yet AI and retry after checking local storage access.";
const CALLBACK_UNAVAILABLE_TEXT: &str =
    "Login callback listener is unavailable. Return to Yet AI, restart the local runtime, and retry login.";
const CALLBACK_AMBIGUOUS_STATE_TEXT: &str =
    "Login could not be matched safely. Return to Yet AI and start login again.";

static CALLBACK_STATE: LazyLock<Mutex<CallbackState>> =
    LazyLock::new(|| Mutex::new(CallbackState::default()));
#[cfg(not(test))]
static CALLBACK_START_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Default)]
struct CallbackState {
    started: bool,
    pending_states: HashMap<String, PathBuf>,
    known_config_dirs: HashSet<PathBuf>,
}

#[derive(Debug)]
pub(crate) struct CallbackStartError;

pub(crate) async fn ensure_started(config_dir: &Path) -> Result<(), CallbackStartError> {
    {
        let mut state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
        state.known_config_dirs.insert(config_dir.to_path_buf());
        if state.started {
            return Ok(());
        }
    }

    #[cfg(test)]
    {
        let mut state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
        state.started = true;
        return Ok(());
    }

    #[cfg(not(test))]
    {
        let _guard = CALLBACK_START_LOCK.lock().await;
        {
            let state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
            if state.started {
                return Ok(());
            }
        }

        let listeners = bind_loopback_listeners().await?;
        serve_listeners_in_owner_thread(listeners)?;

        let mut state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
        state.known_config_dirs.insert(config_dir.to_path_buf());
        state.started = true;
        Ok(())
    }
}

pub(crate) fn register_pending_state(
    state_value: &str,
    config_dir: &Path,
) -> Result<(), CallbackStartError> {
    let mut state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
    state.known_config_dirs.insert(config_dir.to_path_buf());
    state
        .pending_states
        .insert(state_value.to_string(), config_dir.to_path_buf());
    Ok(())
}

pub(crate) fn forget_pending_state(state_value: &str) {
    if let Ok(mut state) = CALLBACK_STATE.lock() {
        state.pending_states.remove(state_value);
    }
}

#[cfg(not(test))]
struct LoopbackListeners {
    ipv4: TcpListener,
    ipv6: TcpListener,
}

#[cfg(not(test))]
async fn bind_loopback_listeners() -> Result<LoopbackListeners, CallbackStartError> {
    let ipv4 = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, CALLBACK_PORT)))
        .await
        .map_err(|_| CallbackStartError)?;
    let ipv6 = TcpListener::bind(SocketAddr::from((Ipv6Addr::LOCALHOST, CALLBACK_PORT)))
        .await
        .map_err(|_| CallbackStartError)?;
    Ok(LoopbackListeners { ipv4, ipv6 })
}

#[cfg(not(test))]
fn serve_listeners_in_owner_thread(listeners: LoopbackListeners) -> Result<(), CallbackStartError> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|_| CallbackStartError)?;
    std::thread::Builder::new()
        .name("yet-provider-auth-callback".to_string())
        .spawn(move || {
            runtime.block_on(serve_loopback_listeners(listeners));
        })
        .map(|_| ())
        .map_err(|_| CallbackStartError)
}

#[cfg(not(test))]
async fn serve_loopback_listeners(listeners: LoopbackListeners) {
    let LoopbackListeners { ipv4, ipv6 } = listeners;
    tokio::join!(accept_loop(ipv4), accept_loop(ipv6));
}

async fn accept_loop(listener: TcpListener) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        tokio::spawn(handle_stream(stream));
    }
}

async fn handle_stream(mut stream: TcpStream) {
    let mut buffer = vec![0_u8; CALLBACK_READ_MAX_BYTES];
    let Ok(read) =
        tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut buffer)).await
    else {
        return;
    };
    let Ok(read) = read else {
        return;
    };
    let request = String::from_utf8_lossy(&buffer[..read]);
    let first_line = request.lines().next().unwrap_or_default();
    let method = first_line.split_whitespace().next().unwrap_or_default();
    let path_and_query = first_line.split_whitespace().nth(1).unwrap_or_default();
    let (status, text) = callback_response(method, path_and_query).await;
    write_response(&mut stream, status, text).await;
}

async fn callback_response(method: &str, path_and_query: &str) -> (StatusCode, String) {
    if method != "GET" {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            CALLBACK_FAILURE_TEXT.to_string(),
        );
    }
    let Ok(parsed) = reqwest::Url::parse(&format!("http://localhost{path_and_query}")) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT.to_string());
    };
    if parsed.path() != "/auth/callback" {
        return (StatusCode::NOT_FOUND, CALLBACK_NOT_FOUND_TEXT.to_string());
    }
    let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
    if query.contains_key("error") {
        let Some(state) = bounded_query_value(&query, "state", 512) else {
            return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT.to_string());
        };
        let config_dir = match registered_config_dir_for_state(&state).await {
            Ok(Some(config_dir)) => config_dir,
            Ok(None) => return (StatusCode::BAD_REQUEST, CALLBACK_NOT_FOUND_TEXT.to_string()),
            Err(error) => return (error.status(), callback_failure_text(&error)),
        };
        let result = provider_auth::codex_callback_error(&config_dir, state.clone()).await;
        if callback_error_should_forget_mapping(&result) {
            forget_pending_state(&state);
        }
        let text = callback_error_text(&result);
        return match result {
            Ok(()) => (StatusCode::OK, text),
            Err(provider_auth::ProviderAuthError::SessionNotFound)
            | Err(provider_auth::ProviderAuthError::SessionExpired)
            | Err(provider_auth::ProviderAuthError::SessionMismatch) => (StatusCode::OK, text),
            Err(error) => (error.status(), text),
        };
    }
    let Some(state) = bounded_query_value(&query, "state", 512) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT.to_string());
    };
    let Some(code) = bounded_query_value(&query, "code", 4096) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT.to_string());
    };

    let config_dir = match registered_config_dir_for_state(&state).await {
        Ok(Some(config_dir)) => config_dir,
        Ok(None) => return (StatusCode::BAD_REQUEST, CALLBACK_NOT_FOUND_TEXT.to_string()),
        Err(error) => return (error.status(), callback_failure_text(&error)),
    };

    match provider_auth::codex_callback_exchange(&config_dir, state.clone(), code).await {
        Ok(_) => {
            forget_pending_state(&state);
            (StatusCode::OK, CALLBACK_SUCCESS_TEXT.to_string())
        }
        Err(provider_auth::ProviderAuthError::SessionNotFound)
        | Err(provider_auth::ProviderAuthError::SessionExpired) => {
            forget_pending_state(&state);
            (StatusCode::OK, CALLBACK_NOT_FOUND_TEXT.to_string())
        }
        Err(provider_auth::ProviderAuthError::SessionMismatch) => {
            forget_pending_state(&state);
            (StatusCode::OK, CALLBACK_AMBIGUOUS_STATE_TEXT.to_string())
        }
        Err(error) => (error.status(), callback_failure_text(&error)),
    }
}

fn callback_error_should_forget_mapping(
    result: &Result<(), provider_auth::ProviderAuthError>,
) -> bool {
    matches!(
        result,
        Ok(())
            | Err(provider_auth::ProviderAuthError::SessionNotFound)
            | Err(provider_auth::ProviderAuthError::SessionExpired)
            | Err(provider_auth::ProviderAuthError::SessionMismatch)
    )
}

fn callback_failure_text(error: &provider_auth::ProviderAuthError) -> String {
    match error {
        provider_auth::ProviderAuthError::SessionMismatch => {
            CALLBACK_AMBIGUOUS_STATE_TEXT.to_string()
        }
        provider_auth::ProviderAuthError::Storage
        | provider_auth::ProviderAuthError::Provider(_) => {
            CALLBACK_STORAGE_FAILURE_TEXT.to_string()
        }
        provider_auth::ProviderAuthError::CallbackUnavailable => {
            CALLBACK_UNAVAILABLE_TEXT.to_string()
        }
        provider_auth::ProviderAuthError::TokenExchange(category, _) => {
            let category = category.as_str();
            match category.as_str() {
                "token_http_failed_or_timeout" => CALLBACK_EXCHANGE_HTTP_FAILED_TEXT.to_string(),
                "provider_rejected" => CALLBACK_EXCHANGE_PROVIDER_REJECTED_TEXT.to_string(),
                "refresh_token_reused" => {
                    CALLBACK_EXCHANGE_REFRESH_REJECTED_TEXT.to_string()
                }
                "adapter_failure" => CALLBACK_EXCHANGE_ADAPTER_FAILURE_TEXT.to_string(),
                "token_json_invalid" => CALLBACK_EXCHANGE_JSON_INVALID_TEXT.to_string(),
                "token_access_missing" => CALLBACK_EXCHANGE_ACCESS_MISSING_TEXT.to_string(),
                "account_id_missing" => CALLBACK_EXCHANGE_ACCOUNT_MISSING_TEXT.to_string(),
                "expires_invalid" => CALLBACK_EXCHANGE_EXPIRES_INVALID_TEXT.to_string(),
                "scopes_invalid" => CALLBACK_EXCHANGE_SCOPES_INVALID_TEXT.to_string(),
                "storage_failed" => CALLBACK_EXCHANGE_STORAGE_FAILED_TEXT.to_string(),
                "model_discovery_fallback" => CALLBACK_EXCHANGE_MODEL_FALLBACK_TEXT.to_string(),
                _ if category.starts_with("token_http_status_") => format!(
                    "Login reached Yet AI but credential exchange failed ({category}). Return to Yet AI and retry login or use API-key fallback."
                ),
                _ => CALLBACK_EXCHANGE_FAILURE_TEXT.to_string(),
            }
        }
        _ => CALLBACK_FAILURE_TEXT.to_string(),
    }
}

fn callback_error_text(result: &Result<(), provider_auth::ProviderAuthError>) -> String {
    match result {
        Ok(()) => CALLBACK_PROVIDER_ERROR_TEXT.to_string(),
        Err(provider_auth::ProviderAuthError::SessionNotFound)
        | Err(provider_auth::ProviderAuthError::SessionExpired) => {
            CALLBACK_NOT_FOUND_TEXT.to_string()
        }
        Err(error) => callback_failure_text(error),
    }
}

async fn registered_config_dir_for_state(
    state_value: &str,
) -> Result<Option<PathBuf>, provider_auth::ProviderAuthError> {
    let config_dirs = {
        let state = CALLBACK_STATE
            .lock()
            .map_err(|_| provider_auth::ProviderAuthError::Storage)?;
        let mut config_dirs = state.known_config_dirs.iter().cloned().collect::<Vec<_>>();
        if let Some(config_dir) = state.pending_states.get(state_value) {
            config_dirs.push(config_dir.clone());
        }
        config_dirs
    };
    match provider_auth::resolve_codex_callback_config_dir(state_value, config_dirs).await {
        Ok(Some(config_dir)) => {
            register_pending_state(state_value, &config_dir)
                .map_err(|_| provider_auth::ProviderAuthError::CallbackUnavailable)?;
            Ok(Some(config_dir))
        }
        Ok(None) => {
            forget_pending_state(state_value);
            Ok(None)
        }
        Err(provider_auth::ProviderAuthError::SessionMismatch) => {
            forget_pending_state(state_value);
            Err(provider_auth::ProviderAuthError::SessionMismatch)
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
fn clear_registered_states_for_test() {
    if let Ok(mut state) = CALLBACK_STATE.lock() {
        state.pending_states.clear();
    }
}

#[cfg(test)]
fn clear_all_registered_state_for_test() {
    if let Ok(mut state) = CALLBACK_STATE.lock() {
        state.pending_states.clear();
        state.known_config_dirs.clear();
    }
}

#[cfg(test)]
fn directly_registered_config_dir_for_test(state_value: &str) -> Option<PathBuf> {
    CALLBACK_STATE
        .lock()
        .ok()
        .and_then(|state| state.pending_states.get(state_value).cloned())
}

fn bounded_query_value(
    query: &HashMap<String, String>,
    key: &str,
    max_chars: usize,
) -> Option<String> {
    let value = query.get(key)?;
    if value.trim() != value || value.trim().is_empty() || value.chars().count() > max_chars {
        return None;
    }
    if value
        .chars()
        .any(|value| matches!(value as u32, 0x00..=0x1f | 0x7f..=0x9f))
    {
        return None;
    }
    Some(value.to_string())
}

async fn write_response(stream: &mut TcpStream, status: StatusCode, text: String) {
    let body = html_escape(&text);
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Security-Policy: default-src 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_text_is_secret_free() {
        for text in [
            CALLBACK_SUCCESS_TEXT,
            CALLBACK_FAILURE_TEXT,
            CALLBACK_NOT_FOUND_TEXT,
            CALLBACK_PROVIDER_ERROR_TEXT,
            CALLBACK_EXCHANGE_FAILURE_TEXT,
            CALLBACK_EXCHANGE_HTTP_FAILED_TEXT,
            CALLBACK_EXCHANGE_PROVIDER_REJECTED_TEXT,
            CALLBACK_EXCHANGE_REFRESH_REJECTED_TEXT,
            CALLBACK_EXCHANGE_ADAPTER_FAILURE_TEXT,
            CALLBACK_EXCHANGE_JSON_INVALID_TEXT,
            CALLBACK_EXCHANGE_ACCESS_MISSING_TEXT,
            CALLBACK_EXCHANGE_ACCOUNT_MISSING_TEXT,
            CALLBACK_EXCHANGE_EXPIRES_INVALID_TEXT,
            CALLBACK_EXCHANGE_SCOPES_INVALID_TEXT,
            CALLBACK_EXCHANGE_STORAGE_FAILED_TEXT,
            CALLBACK_EXCHANGE_MODEL_FALLBACK_TEXT,
            CALLBACK_STORAGE_FAILURE_TEXT,
            CALLBACK_UNAVAILABLE_TEXT,
            CALLBACK_AMBIGUOUS_STATE_TEXT,
        ] {
            let lower = text.to_ascii_lowercase();
            assert!(!lower.contains("access_token"));
            assert!(!lower.contains("refresh_token="));
            assert!(!lower.contains("secret"));
            assert!(!lower.contains("/users/"));
            assert!(!lower.contains("access_denied"));
            assert!(!lower.contains("auth.json"));
        }
    }

    #[test]
    fn callback_failure_text_maps_actionable_sanitized_reasons() {
        let cases = [
            (
                provider_auth::ProviderAuthError::SessionMismatch,
                CALLBACK_AMBIGUOUS_STATE_TEXT,
            ),
            (
                provider_auth::ProviderAuthError::Storage,
                CALLBACK_STORAGE_FAILURE_TEXT,
            ),
            (
                provider_auth::ProviderAuthError::token_exchange(
                    crate::provider_auth::CodexTokenExchangeCategory::TokenHttpStatus(400),
                ),
                "Login reached Yet AI but credential exchange failed (token_http_status_400). Return to Yet AI and retry login or use API-key fallback.",
            ),
            (
                provider_auth::ProviderAuthError::CallbackUnavailable,
                CALLBACK_UNAVAILABLE_TEXT,
            ),
        ];

        for (error, expected) in cases {
            let text = callback_failure_text(&error);
            assert_eq!(text, expected);
            assert!(!text.contains("raw-denied-secret"));
            assert!(!text.contains("codex-code-secret"));
            assert!(!text.contains("codex-state-secret"));
        }
    }

    #[test]
    fn callback_failure_taxonomy_never_fabricates_http_status_zero() {
        let cases = [
            (
                crate::provider_auth::CodexTokenExchangeCategory::ProviderRejected,
                None,
                "provider_rejected",
            ),
            (
                crate::provider_auth::CodexTokenExchangeCategory::RefreshTokenReused,
                None,
                "refresh_token_reused",
            ),
            (
                crate::provider_auth::CodexTokenExchangeCategory::AdapterFailure,
                None,
                "adapter_failure",
            ),
            (
                crate::provider_auth::CodexTokenExchangeCategory::TokenHttpStatus(503),
                Some("http_status=503"),
                "token_http_status_503",
            ),
        ];

        for (category, detail, expected) in cases {
            let error = match detail {
                Some(detail) => provider_auth::ProviderAuthError::token_exchange_with_detail(
                    category,
                    detail.to_string(),
                ),
                None => provider_auth::ProviderAuthError::token_exchange(category),
            };
            let text = callback_failure_text(&error);
            assert!(text.contains(expected), "{text}");
        }
    }

    #[test]
    fn callback_failure_never_renders_exchange_detail() {
        let sensitive = [
            "code=authorization-secret",
            "state=callback-state",
            "id_token=header.payload.signature",
            "account_id=acct-private",
            "code_verifier=pkce-private",
            "pkce_challenge=private",
            "http://localhost:1455/auth/callback?code=private&state=private",
            "/Users/alice/.config/yet-ai/auth.json",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2NvdW50In0.signature1",
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-opaque-value",
            "access_token=private",
            "refresh_token=private",
            "Bearer private",
            "cookie=session-private",
            "authorization=Basic private",
            "<script>alert('private')</script>",
        ];
        for detail in sensitive {
            let text = callback_failure_text(
                &provider_auth::ProviderAuthError::token_exchange_with_detail(
                    crate::provider_auth::CodexTokenExchangeCategory::TokenHttpStatus(400),
                    detail.to_string(),
                ),
            );
            assert_eq!(
                text,
                "Login reached Yet AI but credential exchange failed (token_http_status_400). Return to Yet AI and retry login or use API-key fallback."
            );
            assert!(!text.contains(detail));
        }
    }

    #[test]
    fn callback_html_escaping_covers_active_markup() {
        assert_eq!(
            html_escape("<script src='private'>&\"</script>"),
            "&lt;script src=&#39;private&#39;&gt;&amp;&quot;&lt;/script&gt;"
        );
    }

    #[test]
    fn callback_provider_error_text_maps_without_provider_payload() {
        assert_eq!(callback_error_text(&Ok(())), CALLBACK_PROVIDER_ERROR_TEXT);
        assert_eq!(
            callback_error_text(&Err(provider_auth::ProviderAuthError::SessionExpired)),
            CALLBACK_NOT_FOUND_TEXT
        );
        assert_eq!(
            callback_error_text(&Err(provider_auth::ProviderAuthError::SessionMismatch)),
            CALLBACK_AMBIGUOUS_STATE_TEXT
        );
    }

    #[tokio::test]
    async fn callback_response_rejects_non_get_without_exchange() {
        let (status, text) = callback_response(
            "POST",
            "/auth/callback?code=codex-code-secret&state=codex-state-secret",
        )
        .await;

        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(text, CALLBACK_FAILURE_TEXT);
    }

    #[test]
    fn provider_error_callback_forget_decision_keeps_retryable_failures() {
        let cases = [
            (Ok(()), true),
            (Err(provider_auth::ProviderAuthError::SessionNotFound), true),
            (Err(provider_auth::ProviderAuthError::SessionExpired), true),
            (Err(provider_auth::ProviderAuthError::SessionMismatch), true),
            (Err(provider_auth::ProviderAuthError::Storage), false),
            (
                Err(provider_auth::ProviderAuthError::token_exchange(
                    crate::provider_auth::CodexTokenExchangeCategory::AdapterFailure,
                )),
                false,
            ),
            (
                Err(provider_auth::ProviderAuthError::CallbackUnavailable),
                false,
            ),
            (
                Err(provider_auth::ProviderAuthError::Provider(
                    crate::providers::ProviderError::Storage,
                )),
                false,
            ),
        ];

        for (result, should_forget) in cases {
            assert_eq!(callback_error_should_forget_mapping(&result), should_forget);
        }
    }

    static CALLBACK_TEST_COUNTER: std::sync::atomic::AtomicU64 =
        std::sync::atomic::AtomicU64::new(0);
    static CALLBACK_TEST_LOCK: LazyLock<tokio::sync::Mutex<()>> =
        LazyLock::new(|| tokio::sync::Mutex::new(()));

    fn callback_test_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-callback-routing-test-{}-{}-{label}",
            std::process::id(),
            CALLBACK_TEST_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    async fn start_codex_pending(
        dir: &Path,
        token_endpoint_url: &str,
    ) -> provider_auth::ProviderAuthResponse {
        start_codex_pending_with_ttl(dir, token_endpoint_url, None).await
    }

    async fn start_codex_pending_with_ttl(
        dir: &Path,
        token_endpoint_url: &str,
        ttl_seconds: Option<i64>,
    ) -> provider_auth::ProviderAuthResponse {
        provider_auth::start(
            dir,
            "openai",
            provider_auth::ProviderAuthStartRequest {
                experimental_codex_like: true,
                token_endpoint_url: Some(token_endpoint_url.to_string()),
                ttl_seconds,
                ..Default::default()
            },
        )
        .await
        .unwrap()
    }

    async fn codex_token_endpoint(status: StatusCode) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            for request_index in 0..2 {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut buffer = [0_u8; 2048];
                let read = stream.read(&mut buffer).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]);
                let is_models = request.starts_with("GET /backend-api/codex/models");
                let (response_status, body) = if is_models {
                    (StatusCode::OK, r#"{"data":[{"id":"gpt-5-codex"}]}"#)
                } else if status.is_success() || request_index == 0 {
                    (
                        status,
                        if status.is_success() {
                            r#"{"access_token":"codex-exchange-access-token-secret","refresh_token":"codex-exchange-refresh-token-secret","expires_in":3600,"scope":"openid profile email offline_access","id_token":"eyJhbGciOiJub25lIn0.eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJhY2N0LXRlc3QifQ.signature"}"#
                        } else {
                            r#"{"error":"temporary_failure"}"#
                        },
                    )
                } else {
                    (StatusCode::NOT_FOUND, r#"{}"#)
                };
                let response = format!(
                    "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    response_status.as_u16(),
                    response_status.canonical_reason().unwrap_or(""),
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes()).await;
                if !status.is_success() || is_models {
                    break;
                }
            }
        });
        url
    }

    fn callback_query(state: &str) -> String {
        format!("/auth/callback?code=codex-code-callback-test&state={state}")
    }

    fn callback_error_query(state: &str) -> String {
        format!(
            "/auth/callback?error=access_denied&error_description=raw-denied-secret&state={state}"
        )
    }

    fn rewrite_registry_state(dir: &Path, from: &str, to: &str) {
        let path = dir.join("provider-auth-sessions").join("openai.json");
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains(from));
        std::fs::write(path, content.replace(from, to)).unwrap();
    }

    #[tokio::test]
    async fn status_rehydrates_persisted_pending_callback_mapping() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_registered_states_for_test();
        let dir = callback_test_dir("rehydrate");
        let token_endpoint_url = codex_token_endpoint(StatusCode::OK).await;
        let start = start_codex_pending(&dir, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        clear_registered_states_for_test();
        assert!(directly_registered_config_dir_for_test(&state).is_none());

        let status = provider_auth::status(&dir, "openai").await.unwrap();

        assert_eq!(status.status, "pending");
        assert_eq!(
            registered_config_dir_for_state(&state).await.unwrap(),
            Some(dir.clone())
        );
        let (status, text) = callback_response("GET", &callback_query(&state)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(text, CALLBACK_SUCCESS_TEXT);
        assert!(registered_config_dir_for_state(&state)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn callback_rehydrates_from_registry_for_known_config_dir_without_status_poll() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;

        clear_registered_states_for_test();
        let dir = callback_test_dir("direct-rehydrate");
        let token_endpoint_url = codex_token_endpoint(StatusCode::OK).await;
        let start = start_codex_pending(&dir, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        clear_registered_states_for_test();
        assert!(directly_registered_config_dir_for_test(&state).is_none());

        let (status, text) = callback_response("GET", &callback_query(&state)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(text, CALLBACK_SUCCESS_TEXT);
        assert!(registered_config_dir_for_state(&state)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn callback_does_not_rehydrate_registry_for_unknown_config_dir() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let dir = callback_test_dir("unknown-rehydrate");
        let token_endpoint_url = codex_token_endpoint(StatusCode::OK).await;
        let start = start_codex_pending(&dir, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        clear_all_registered_state_for_test();

        let (status, text) = callback_response("GET", &callback_query(&state)).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_NOT_FOUND_TEXT);
        assert!(directly_registered_config_dir_for_test(&state).is_none());
    }

    #[tokio::test]
    async fn callback_fails_closed_when_registry_lookup_has_storage_error() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;

        clear_registered_states_for_test();
        let dir = callback_test_dir("storage-error");
        let token_endpoint_url = codex_token_endpoint(StatusCode::OK).await;
        let start = start_codex_pending(&dir, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        clear_registered_states_for_test();
        let registry_path = dir.join("provider-auth-sessions").join("openai.json");
        std::fs::write(&registry_path, r#"{"pending":[{"state":"broken""#).unwrap();

        let (status, text) = callback_response("GET", &callback_query(&state)).await;

        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(text, CALLBACK_STORAGE_FAILURE_TEXT);
        assert!(directly_registered_config_dir_for_test(&state).is_none());
    }

    #[tokio::test]
    async fn callback_fails_closed_when_multiple_config_dirs_match_state() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let first = callback_test_dir("duplicate-first");
        let second = callback_test_dir("duplicate-second");
        let first_start =
            start_codex_pending(&first, &codex_token_endpoint(StatusCode::OK).await).await;
        let duplicate_state =
            reqwest::Url::parse(first_start.authorization_url.as_deref().unwrap())
                .unwrap()
                .query_pairs()
                .find(|(key, _)| key == "state")
                .unwrap()
                .1
                .into_owned();
        let second_start =
            start_codex_pending(&second, &codex_token_endpoint(StatusCode::OK).await).await;
        let second_state = reqwest::Url::parse(second_start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        rewrite_registry_state(&second, &second_state, &duplicate_state);
        clear_registered_states_for_test();

        let (status, text) = callback_response("GET", &callback_query(&duplicate_state)).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_AMBIGUOUS_STATE_TEXT);
        assert!(directly_registered_config_dir_for_test(&duplicate_state).is_none());
    }

    #[tokio::test]
    async fn cached_callback_mapping_fails_closed_when_another_config_dir_matches_state() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let first = callback_test_dir("cached-duplicate-first");
        let second = callback_test_dir("cached-duplicate-second");
        let first_start =
            start_codex_pending(&first, &codex_token_endpoint(StatusCode::OK).await).await;
        let duplicate_state =
            reqwest::Url::parse(first_start.authorization_url.as_deref().unwrap())
                .unwrap()
                .query_pairs()
                .find(|(key, _)| key == "state")
                .unwrap()
                .1
                .into_owned();
        let second_start =
            start_codex_pending(&second, &codex_token_endpoint(StatusCode::OK).await).await;
        let second_state = reqwest::Url::parse(second_start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        rewrite_registry_state(&second, &second_state, &duplicate_state);
        register_pending_state(&duplicate_state, &first).unwrap();

        let (status, text) = callback_response("GET", &callback_query(&duplicate_state)).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_AMBIGUOUS_STATE_TEXT);
        assert!(directly_registered_config_dir_for_test(&duplicate_state).is_none());
    }

    #[tokio::test]
    async fn stale_cached_callback_mapping_cannot_bypass_registry() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let dir = callback_test_dir("stale-cache");
        let start = start_codex_pending(&dir, &codex_token_endpoint(StatusCode::OK).await).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        register_pending_state(&state, &dir).unwrap();
        rewrite_registry_state(&dir, &state, "replacement-state");

        let (status, text) = callback_response("GET", &callback_query(&state)).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_NOT_FOUND_TEXT);
        assert!(directly_registered_config_dir_for_test(&state).is_none());
    }

    #[tokio::test]
    async fn terminal_callback_failures_do_not_show_success_text() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let dir = callback_test_dir("terminal-failure");
        register_pending_state("missing-state", &dir).unwrap();

        let (status, text) = callback_response("GET", &callback_query("missing-state")).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_NOT_FOUND_TEXT);
        assert_ne!(text, CALLBACK_SUCCESS_TEXT);
        assert!(registered_config_dir_for_state("missing-state")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn callback_uses_direct_state_mapping_and_ignores_stale_corrupt_dir() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let stale = callback_test_dir("stale");
        let valid = callback_test_dir("valid");
        let stale_path = stale.join("provider-auth-openai").join("openai.json");
        std::fs::create_dir_all(stale_path.parent().unwrap()).unwrap();
        std::fs::write(&stale_path, r#"{"pending":{"state":"broken""#).unwrap();
        register_pending_state("stale-state", &stale).unwrap();
        let token_endpoint_url = codex_token_endpoint(StatusCode::BAD_GATEWAY).await;
        let start = start_codex_pending(&valid, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();

        let (status, text) = callback_response("GET", &callback_query(&state)).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(text.contains("token_http_status_502"), "{text}");
        assert!(registered_config_dir_for_state("stale-state")
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            registered_config_dir_for_state(&state).await.unwrap(),
            Some(valid)
        );
    }

    #[tokio::test]
    async fn callback_mapping_is_retained_on_retryable_exchange_failure() {
        {
            let _guard = CALLBACK_TEST_LOCK.lock().await;
            clear_all_registered_state_for_test();
            let dir = callback_test_dir("http-detail");
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let token_endpoint_url = format!("http://{}/token", listener.local_addr().unwrap());
            tokio::spawn(async move {
                if let Ok((mut stream, _)) = listener.accept().await {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buffer = [0_u8; 2048];
                    let _ = stream.read(&mut buffer).await;
                    let body = r#"{"error":"invalid_grant","error_description":"Authorization code is invalid or expired"}"#;
                    let response = format!(
                        "HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                }
            });
            let start = start_codex_pending(&dir, &token_endpoint_url).await;
            let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
                .unwrap()
                .query_pairs()
                .find(|(key, _)| key == "state")
                .unwrap()
                .1
                .into_owned();

            let (status, text) = callback_response("GET", &callback_query(&state)).await;

            assert_eq!(status, StatusCode::BAD_GATEWAY);
            assert!(text.contains("token_http_status_400"));
            assert!(!text.contains("http_status=400"));
            assert!(!text.contains("oauth_error=invalid_grant"));
            assert!(!text.contains("Authorization code is invalid or expired"));
            assert!(!text.contains("codex-code-callback-test"));
            assert!(!text.contains(&state));
        }

        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let dir = callback_test_dir("retry");
        let token_endpoint_url = codex_token_endpoint(StatusCode::BAD_GATEWAY).await;
        let start = start_codex_pending(&dir, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();

        let (status, text) = callback_response("GET", &callback_query(&state)).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(text.contains("token_http_status_502"), "{text}");
        assert_eq!(
            registered_config_dir_for_state(&state).await.unwrap(),
            Some(dir)
        );
    }

    #[tokio::test]
    async fn callback_mapping_is_removed_on_success() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let dir = callback_test_dir("success");
        let token_endpoint_url = codex_token_endpoint(StatusCode::OK).await;
        let start = start_codex_pending(&dir, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();

        let (status, text) = callback_response("GET", &callback_query(&state)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(text, CALLBACK_SUCCESS_TEXT);
        assert!(registered_config_dir_for_state(&state)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn callback_provider_error_clears_pending_and_mapping_without_exchange() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let dir = callback_test_dir("provider-error");
        let token_endpoint_url = codex_token_endpoint(StatusCode::OK).await;
        let start = start_codex_pending(&dir, &token_endpoint_url).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();

        let (status, text) = callback_response("GET", &callback_error_query(&state)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(text, CALLBACK_PROVIDER_ERROR_TEXT);
        assert!(!text.contains("access_denied"));
        assert!(!text.contains("raw-denied-secret"));
        assert!(!text.contains(&state));
        assert!(registered_config_dir_for_state(&state)
            .await
            .unwrap()
            .is_none());
        let status = provider_auth::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "login_unavailable");
        assert!(status.session_id.is_none());
    }

    #[tokio::test]
    async fn callback_provider_error_without_mapped_state_is_sanitized_and_not_terminalizing() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();

        let (status, text) = callback_response(
            "GET",
            "/auth/callback?error=access_denied&error_description=raw-denied-secret&state=missing-state-secret",
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_NOT_FOUND_TEXT);
        assert!(!text.contains("access_denied"));
        assert!(!text.contains("raw-denied-secret"));
        assert!(!text.contains("missing-state-secret"));
        assert!(registered_config_dir_for_state("missing-state-secret")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn expired_pending_status_forgets_callback_mapping() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let dir = callback_test_dir("expired-status");
        let token_endpoint_url = codex_token_endpoint(StatusCode::OK).await;
        let start = start_codex_pending_with_ttl(&dir, &token_endpoint_url, Some(1)).await;
        let state = reqwest::Url::parse(start.authorization_url.as_deref().unwrap())
            .unwrap()
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned();
        assert_eq!(
            registered_config_dir_for_state(&state).await.unwrap(),
            Some(dir.clone())
        );
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        let status = provider_auth::status(&dir, "openai").await.unwrap();

        assert_eq!(status.status, "login_unavailable");
        assert!(registered_config_dir_for_state(&state)
            .await
            .unwrap()
            .is_none());
    }

    async fn raw_loopback_callback(
        address: std::net::SocketAddr,
        path_and_query: &str,
    ) -> (StatusCode, String) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let mut stream = TcpStream::connect(address).await.unwrap();
        let request = format!(
            "GET {path_and_query} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.shutdown().await.unwrap();
        let mut bytes = Vec::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            stream.read_to_end(&mut bytes),
        )
        .await
        .unwrap()
        .unwrap();
        let response = String::from_utf8(bytes).unwrap();
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .and_then(|value| StatusCode::from_u16(value).ok())
            .unwrap();
        (status, body.to_string())
    }

    #[tokio::test]
    async fn real_loopback_callback_route_reaches_listener() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_all_registered_state_for_test();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(accept_loop(listener));

        let (status, text) = raw_loopback_callback(
            address,
            "/auth/callback?code=codex-code-real-loopback&state=real-loopback-state",
        )
        .await;

        server.abort();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_NOT_FOUND_TEXT);
        assert!(!text.contains("codex-code-real-loopback"));
        assert!(!text.contains("real-loopback-state"));
    }

    #[tokio::test]
    async fn ensure_started_is_safe_for_concurrent_calls() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        let base =
            std::env::temp_dir().join(format!("yet-ai-callback-start-test-{}", std::process::id()));
        let first = base.join("one");
        let second = base.join("two");

        let (first, second) = tokio::join!(ensure_started(&first), ensure_started(&second));

        assert!(first.is_ok());
        assert!(second.is_ok());
    }
}

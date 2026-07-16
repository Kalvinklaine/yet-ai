use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use http::StatusCode;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::provider_auth;

const CALLBACK_PORT: u16 = 1455;
const CALLBACK_READ_MAX_BYTES: usize = 8192;
const CALLBACK_SUCCESS_TEXT: &str = "Login received. Return to Yet AI.";
const CALLBACK_FAILURE_TEXT: &str = "Login could not be completed. Return to Yet AI and try again.";
const CALLBACK_NOT_FOUND_TEXT: &str =
    "Login request was not found or expired. Return to Yet AI and try again.";

static CALLBACK_STATE: LazyLock<Mutex<CallbackState>> =
    LazyLock::new(|| Mutex::new(CallbackState::default()));
static CALLBACK_START_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Default)]
struct CallbackState {
    started: bool,
    pending_states: HashMap<String, PathBuf>,
}

#[derive(Debug)]
pub(crate) struct CallbackStartError;

pub(crate) async fn ensure_started(config_dir: &Path) -> Result<(), CallbackStartError> {
    let _ = config_dir;
    {
        let state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
        if state.started {
            return Ok(());
        }
    }

    let _guard = CALLBACK_START_LOCK.lock().await;
    {
        let state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
        if state.started {
            return Ok(());
        }
    }

    let listeners = bind_loopback_listeners().await?;
    serve_listeners_in_threads(listeners)?;

    let mut state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
    state.started = true;
    Ok(())
}

pub(crate) fn register_pending_state(
    state_value: &str,
    config_dir: &Path,
) -> Result<(), CallbackStartError> {
    let mut state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
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

async fn bind_loopback_listeners() -> Result<Vec<TcpListener>, CallbackStartError> {
    let ipv4 = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, CALLBACK_PORT)))
        .await
        .map_err(|_| CallbackStartError)?;
    let ipv6 = TcpListener::bind(SocketAddr::from((Ipv6Addr::LOCALHOST, CALLBACK_PORT)))
        .await
        .map_err(|_| CallbackStartError)?;
    Ok(vec![ipv4, ipv6])
}

fn serve_listeners_in_threads(listeners: Vec<TcpListener>) -> Result<(), CallbackStartError> {
    for listener in listeners {
        serve_listener_in_thread(listener)?;
    }
    Ok(())
}

fn serve_listener_in_thread(listener: TcpListener) -> Result<(), CallbackStartError> {
    std::thread::Builder::new()
        .name("yet-provider-auth-callback".to_string())
        .spawn(move || {
            if let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                runtime.block_on(accept_loop(listener));
            }
        })
        .map(|_| ())
        .map_err(|_| CallbackStartError)
}

async fn accept_loop(listener: TcpListener) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        handle_stream(stream).await;
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

async fn callback_response(method: &str, path_and_query: &str) -> (StatusCode, &'static str) {
    if method != "GET" {
        return (StatusCode::METHOD_NOT_ALLOWED, CALLBACK_FAILURE_TEXT);
    }
    let Ok(parsed) = reqwest::Url::parse(&format!("http://localhost{path_and_query}")) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
    };
    if parsed.path() != "/auth/callback" {
        return (StatusCode::NOT_FOUND, CALLBACK_NOT_FOUND_TEXT);
    }
    let query: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
    if query.contains_key("error") {
        let Some(state) = bounded_query_value(&query, "state", 512) else {
            return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
        };
        let Some(config_dir) = registered_config_dir_for_state(&state) else {
            return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
        };
        let result = provider_auth::codex_callback_error(&config_dir, state.clone()).await;
        forget_pending_state(&state);
        return match result {
            Ok(())
            | Err(provider_auth::ProviderAuthError::SessionNotFound)
            | Err(provider_auth::ProviderAuthError::SessionExpired)
            | Err(provider_auth::ProviderAuthError::SessionMismatch) => {
                (StatusCode::OK, CALLBACK_FAILURE_TEXT)
            }
            Err(error) => (error.status(), CALLBACK_FAILURE_TEXT),
        };
    }
    let Some(state) = bounded_query_value(&query, "state", 512) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
    };
    let Some(code) = bounded_query_value(&query, "code", 4096) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
    };

    let Some(config_dir) = registered_config_dir_for_state(&state) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_NOT_FOUND_TEXT);
    };

    match provider_auth::codex_callback_exchange(&config_dir, state.clone(), code).await {
        Ok(_) => {
            forget_pending_state(&state);
            (StatusCode::OK, CALLBACK_SUCCESS_TEXT)
        }
        Err(provider_auth::ProviderAuthError::SessionNotFound)
        | Err(provider_auth::ProviderAuthError::SessionExpired)
        | Err(provider_auth::ProviderAuthError::SessionMismatch) => {
            forget_pending_state(&state);
            (StatusCode::OK, CALLBACK_SUCCESS_TEXT)
        }
        Err(provider_auth::ProviderAuthError::TokenExchange) => {
            (StatusCode::BAD_GATEWAY, CALLBACK_FAILURE_TEXT)
        }
        Err(error) => (error.status(), CALLBACK_FAILURE_TEXT),
    }
}

fn registered_config_dir_for_state(state_value: &str) -> Option<PathBuf> {
    CALLBACK_STATE
        .lock()
        .ok()
        .and_then(|state| state.pending_states.get(state_value).cloned())
}

#[cfg(test)]
fn clear_registered_states_for_test() {
    if let Ok(mut state) = CALLBACK_STATE.lock() {
        state.pending_states.clear();
    }
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

async fn write_response(stream: &mut TcpStream, status: StatusCode, text: &'static str) {
    let body = html_escape(text);
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
        ] {
            let lower = text.to_ascii_lowercase();
            assert!(!lower.contains("code"));
            assert!(!lower.contains("state"));
            assert!(!lower.contains("token"));
            assert!(!lower.contains("secret"));
            assert!(!lower.contains("/users/"));
        }
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

    #[tokio::test]
    async fn callback_uses_direct_state_mapping_and_ignores_stale_corrupt_dir() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_registered_states_for_test();
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
        assert_eq!(text, CALLBACK_FAILURE_TEXT);
        assert_eq!(registered_config_dir_for_state("stale-state"), Some(stale));
        assert_eq!(registered_config_dir_for_state(&state), Some(valid));
    }

    #[tokio::test]
    async fn callback_mapping_is_retained_on_retryable_exchange_failure() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_registered_states_for_test();
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
        assert_eq!(text, CALLBACK_FAILURE_TEXT);
        assert_eq!(registered_config_dir_for_state(&state), Some(dir));
    }

    #[tokio::test]
    async fn callback_mapping_is_removed_on_success() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_registered_states_for_test();
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
        assert!(registered_config_dir_for_state(&state).is_none());
    }

    #[tokio::test]
    async fn callback_provider_error_clears_pending_and_mapping_without_exchange() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_registered_states_for_test();
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
        assert_eq!(text, CALLBACK_FAILURE_TEXT);
        assert!(!text.contains("access_denied"));
        assert!(!text.contains("raw-denied-secret"));
        assert!(!text.contains(&state));
        assert!(registered_config_dir_for_state(&state).is_none());
        let status = provider_auth::status(&dir, "openai").await.unwrap();
        assert_eq!(status.status, "login_unavailable");
        assert!(status.session_id.is_none());
    }

    #[tokio::test]
    async fn callback_provider_error_without_mapped_state_is_sanitized_and_not_terminalizing() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_registered_states_for_test();

        let (status, text) = callback_response(
            "GET",
            "/auth/callback?error=access_denied&error_description=raw-denied-secret&state=missing-state-secret",
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text, CALLBACK_FAILURE_TEXT);
        assert!(!text.contains("access_denied"));
        assert!(!text.contains("raw-denied-secret"));
        assert!(!text.contains("missing-state-secret"));
        assert!(registered_config_dir_for_state("missing-state-secret").is_none());
    }

    #[tokio::test]
    async fn expired_pending_status_forgets_callback_mapping() {
        let _guard = CALLBACK_TEST_LOCK.lock().await;
        clear_registered_states_for_test();
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
        assert_eq!(registered_config_dir_for_state(&state), Some(dir.clone()));
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        let status = provider_auth::status(&dir, "openai").await.unwrap();

        assert_eq!(status.status, "login_unavailable");
        assert!(registered_config_dir_for_state(&state).is_none());
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

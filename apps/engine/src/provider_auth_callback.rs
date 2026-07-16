use std::collections::{HashMap, HashSet};
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
    config_dirs: HashSet<PathBuf>,
}

#[derive(Debug)]
pub(crate) struct CallbackStartError;

pub(crate) async fn ensure_started(config_dir: &Path) -> Result<(), CallbackStartError> {
    {
        let mut state = CALLBACK_STATE.lock().map_err(|_| CallbackStartError)?;
        state.config_dirs.insert(config_dir.to_path_buf());
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
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
    }
    let Some(state) = bounded_query_value(&query, "state", 512) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
    };
    let Some(code) = bounded_query_value(&query, "code", 4096) else {
        return (StatusCode::BAD_REQUEST, CALLBACK_FAILURE_TEXT);
    };

    let Some(config_dirs) = registered_config_dirs() else {
        return (StatusCode::SERVICE_UNAVAILABLE, CALLBACK_FAILURE_TEXT);
    };

    for config_dir in config_dirs {
        match provider_auth::codex_pending_session_matches_state(&config_dir, &state).await {
            Ok(true) => {
                return match provider_auth::codex_callback_exchange(
                    &config_dir,
                    state.clone(),
                    code.clone(),
                )
                .await
                {
                    Ok(_) | Err(provider_auth::ProviderAuthError::SessionNotFound) => {
                        (StatusCode::OK, CALLBACK_SUCCESS_TEXT)
                    }
                    Err(error) => (error.status(), CALLBACK_FAILURE_TEXT),
                };
            }
            Ok(false) => {}
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, CALLBACK_FAILURE_TEXT),
        }
    }

    (StatusCode::BAD_REQUEST, CALLBACK_NOT_FOUND_TEXT)
}

fn registered_config_dirs() -> Option<Vec<PathBuf>> {
    CALLBACK_STATE
        .lock()
        .ok()
        .map(|state| state.config_dirs.iter().cloned().collect())
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

    #[tokio::test]
    async fn ensure_started_is_safe_for_concurrent_calls() {
        let base =
            std::env::temp_dir().join(format!("yet-ai-callback-start-test-{}", std::process::id()));
        let first = base.join("one");
        let second = base.join("two");

        let (first, second) = tokio::join!(ensure_started(&first), ensure_started(&second));

        assert!(first.is_ok());
        assert!(second.is_ok());
    }
}

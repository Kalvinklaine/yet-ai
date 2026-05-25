use axum::body::Bytes;
use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request, StatusCode};
use axum::response::IntoResponse;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tower::ServiceExt;
use yet_lsp::identity::ProductIdentity;
use yet_lsp::secret_store::{FileSecretStore, ProviderSecretStore, SecretKind};
use yet_lsp::storage::{resolve_storage_paths, StoragePaths};
use yet_lsp::{app, default_bind_addr, AppState, AuthToken};
const TEST_TOKEN: &str = "test-token";
static TEST_STORAGE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn test_storage_paths() -> StoragePaths {
    let root = std::env::temp_dir().join(format!(
        "yet-ai-provider-test-{}-{}",
        std::process::id(),
        TEST_STORAGE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&root);
    let identity = ProductIdentity::load().unwrap();
    resolve_storage_paths(
        &identity,
        &root.join("project"),
        &root.join("config"),
        &root.join("cache"),
    )
}

fn test_app() -> axum::Router {
    app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        test_storage_paths(),
    ))
}

fn authed_request(method: Method, uri: &str, body: Body) -> Request<Body> {
    let has_json_body = matches!(method, Method::POST | Method::PATCH);
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {TEST_TOKEN}"));

    if has_json_body {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }

    builder.body(body).unwrap()
}

async fn json_response(request: Request<Body>) -> (StatusCode, Value) {
    json_response_from(test_app(), request).await
}

async fn json_response_from(app: axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn sse_text_from(app: axum::Router, uri: &str) -> String {
    let response = app
        .oneshot(authed_request(Method::GET, uri, Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "text/event-stream"
    );
    let bytes = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        http_body_util::BodyExt::collect(response.into_body()),
    )
    .await
    .unwrap()
    .unwrap()
    .to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

async fn configure_openai_provider(app: axum::Router, base_url: String, api_key: &str) {
    let provider = json!({
        "id": "openai-stream",
        "kind": "openai-compatible",
        "displayName": "OpenAI Stream",
        "enabled": true,
        "baseUrl": base_url,
        "auth": { "type": "api_key", "apiKey": api_key },
        "models": [{ "id": "gpt-test", "displayName": "GPT Test" }],
        "capabilities": { "chat": true, "completion": false, "embeddings": false }
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(!body.to_string().contains(api_key));
}

async fn configure_openai_provider_without_models(
    app: axum::Router,
    base_url: String,
    api_key: &str,
) {
    let provider = json!({
        "id": "openai-no-model",
        "kind": "openai-compatible",
        "displayName": "OpenAI No Model",
        "enabled": true,
        "baseUrl": base_url,
        "auth": { "type": "api_key", "apiKey": api_key },
        "models": [],
        "capabilities": { "chat": true, "completion": false, "embeddings": false }
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(!body.to_string().contains(api_key));
}

async fn configure_openai_api_provider(app: axum::Router, api_key: &str) {
    let provider = json!({
        "id": "openai-api",
        "kind": "openai-compatible",
        "displayName": "OpenAI API",
        "enabled": true,
        "baseUrl": "https://api.openai.com/v1",
        "auth": { "type": "api_key", "apiKey": api_key },
        "models": [{ "id": "gpt-test", "displayName": "GPT Test" }],
        "capabilities": { "chat": true, "completion": false, "embeddings": false }
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(!body.to_string().contains(api_key));
}

async fn start_mock_provider(
    status: StatusCode,
    stream_body: &'static str,
    _observed_auth_only: Option<&'static str>,
) -> (String, mpsc::Receiver<Option<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = mpsc::channel(4);
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let auth_sender = auth_sender.clone();
            async move {
                let auth = request
                    .headers()
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let _ = auth_sender.send(auth.clone()).await;
                (
                    status,
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    stream_body,
                )
                    .into_response()
            }
        };
        let app = axum::Router::new()
            .route("/chat/completions", axum::routing::post(handler.clone()))
            .route("/v1/chat/completions", axum::routing::post(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}"), auth_receiver)
}

async fn start_mock_models_provider(
    status: StatusCode,
    body: &'static str,
    _observed_auth_only: Option<&'static str>,
) -> (String, mpsc::Receiver<Option<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = mpsc::channel(4);
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let auth_sender = auth_sender.clone();
            async move {
                let auth = request
                    .headers()
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let _ = auth_sender.send(auth.clone()).await;
                (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
            }
        };
        let app = axum::Router::new()
            .route("/models", axum::routing::get(handler.clone()))
            .route("/v1/models", axum::routing::get(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}"), auth_receiver)
}

async fn start_slow_models_provider(
    _observed_auth_only: Option<&'static str>,
) -> (String, mpsc::Receiver<Option<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = mpsc::channel(4);
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let auth_sender = auth_sender.clone();
            async move {
                let auth = request
                    .headers()
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let _ = auth_sender.send(auth.clone()).await;
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    r#"{"data":[{"id":"gpt-test"}]}"#,
                )
                    .into_response()
            }
        };
        let app = axum::Router::new()
            .route("/models", axum::routing::get(handler.clone()))
            .route("/v1/models", axum::routing::get(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}"), auth_receiver)
}

async fn assert_received_exactly_one_auth(
    mut auth_receiver: mpsc::Receiver<Option<String>>,
    expected_auth: &'static str,
) {
    let auth = tokio::time::timeout(std::time::Duration::from_secs(2), auth_receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(auth.as_deref(), Some(expected_auth));
    assert!(tokio::time::timeout(std::time::Duration::from_millis(50), auth_receiver.recv())
        .await
        .is_err());
}

async fn assert_no_observed_auth(mut auth_receiver: mpsc::Receiver<Option<String>>) {
    assert!(tokio::time::timeout(std::time::Duration::from_millis(50), auth_receiver.recv())
        .await
        .is_err());
}

async fn start_accept_and_drop_loopback_base_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            drop(stream);
        }
    });
    format!("http://{address}/v1")
}

async fn start_slow_mock_provider(
    _observed_auth_only: Option<&'static str>,
) -> (
    String,
    mpsc::Receiver<Option<String>>,
    oneshot::Receiver<()>,
    oneshot::Sender<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = mpsc::channel(4);
    let (first_sender, first_receiver) = oneshot::channel();
    let (continue_sender, continue_receiver) = oneshot::channel();
    let first_sender = std::sync::Arc::new(std::sync::Mutex::new(Some(first_sender)));
    let continue_receiver = std::sync::Arc::new(std::sync::Mutex::new(Some(continue_receiver)));
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let auth_sender = auth_sender.clone();
            let first_sender = first_sender.clone();
            let continue_receiver = continue_receiver.clone();
            async move {
                let auth = request
                    .headers()
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let _ = auth_sender.send(auth.clone()).await;
                let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(8);
                tokio::spawn(async move {
                    let _ = tx
                        .send(Ok(Bytes::from_static(
                            b"data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n",
                        )))
                        .await;
                    if let Some(sender) = first_sender.lock().unwrap().take() {
                        let _ = sender.send(());
                    }
                    let receiver = continue_receiver.lock().unwrap().take();
                    if let Some(receiver) = receiver {
                        let _ = receiver.await;
                    }
                    let _ = tx
                        .send(Ok(Bytes::from_static(
                            b"data: {\"choices\":[{\"delta\":{\"content\":\"second\"}}]}\n\ndata: [DONE]\n\n",
                        )))
                        .await;
                });
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)),
                )
                    .into_response()
            }
        };
        let app = axum::Router::new()
            .route("/chat/completions", axum::routing::post(handler.clone()))
            .route("/v1/chat/completions", axum::routing::post(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (
        format!("http://{address}"),
        auth_receiver,
        first_receiver,
        continue_sender,
    )
}

async fn start_mock_codex_token_endpoint() -> (String, oneshot::Receiver<Value>) {
    start_mock_codex_token_endpoint_with(1800).await
}

async fn start_mock_codex_token_endpoint_with(
    expires_in: i64,
) -> (String, oneshot::Receiver<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (body_sender, body_receiver) = oneshot::channel();
    let body_sender = std::sync::Arc::new(std::sync::Mutex::new(Some(body_sender)));
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let body_sender = body_sender.clone();
            async move {
                let bytes = to_bytes(request.into_body(), usize::MAX).await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                if let Some(sender) = body_sender.lock().unwrap().take() {
                    let _ = sender.send(body);
                }
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    json!({
                        "access_token": "codex-access-token-secret-abcd",
                        "refresh_token": "codex-refresh-token-secret-wxyz",
                        "expires_in": expires_in,
                        "scope": "openid profile email offline_access",
                        "account_label": "mock-user@example.test"
                    })
                    .to_string(),
                )
                    .into_response()
            }
        };
        let app = axum::Router::new().route("/oauth/token", axum::routing::post(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}/oauth/token"), body_receiver)
}

async fn start_flaky_codex_token_endpoint() -> (String, mpsc::Receiver<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (body_sender, body_receiver) = mpsc::channel(4);
    let attempts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let body_sender = body_sender.clone();
            let attempts = attempts.clone();
            async move {
                let bytes = to_bytes(request.into_body(), usize::MAX).await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                let _ = body_sender.send(body).await;
                if attempts.fetch_add(1, std::sync::atomic::Ordering::Relaxed) == 0 {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        [(header::CONTENT_TYPE, "application/json")],
                        json!({
                            "error": "temporary failure codex-access-token-secret-abcd codex-code-retry"
                        })
                        .to_string(),
                    )
                        .into_response();
                }
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    json!({
                        "access_token": "codex-access-token-secret-abcd",
                        "refresh_token": "codex-refresh-token-secret-wxyz",
                        "expires_in": 1800,
                        "scope": "openid profile email offline_access",
                        "account_label": "mock-user@example.test"
                    })
                    .to_string(),
                )
                    .into_response()
            }
        };
        let app = axum::Router::new().route("/oauth/token", axum::routing::post(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}/oauth/token"), body_receiver)
}

async fn connect_experimental_openai_oauth(
    app: axum::Router,
    token_endpoint_url: String,
    chat_endpoint_url: String,
) {
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({
                    "experimentalCodexLike": true,
                    "tokenEndpointUrl": token_endpoint_url,
                    "chatEndpointUrl": chat_endpoint_url
                })
                .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let state = state_from_authorization_url(start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": start["sessionId"],
        "state": state,
        "code": "codex-code-success"
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "connected");
    assert_provider_auth_response_has_no_codex_secrets(&body);
}

fn state_from_authorization_url(value: &str) -> &str {
    value
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
}

fn sse_json_events(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .map(|data| serde_json::from_str(data).unwrap())
        .collect()
}

async fn send_user_message(app: axum::Router, chat_id: &str) {
    let command = json!({
        "requestId": format!("req-{chat_id}"),
        "type": "user_message",
        "payload": { "content": "hello" }
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            &format!("/v1/chats/{chat_id}/commands"),
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["accepted"], true);
}

async fn send_abort(app: axum::Router, chat_id: &str, request_id: &str) {
    let command = json!({
        "requestId": request_id,
        "type": "abort",
        "payload": {}
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            &format!("/v1/chats/{chat_id}/commands"),
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["accepted"], true);
    assert_eq!(body["type"], "abort");
}

fn find_error_event(events: &[Value]) -> &Value {
    events
        .iter()
        .find(|event| event["type"] == "error")
        .unwrap()
}

fn assert_sanitized_sse_error(text: &str) {
    let lower = text.to_lowercase();
    assert!(!text.contains("sk-"));
    assert!(!lower.contains("bearer "));
    assert!(!lower.contains("access_token"));
    assert!(!lower.contains("refresh_token"));
    assert!(!lower.contains("api_key"));
    assert!(!text.contains("user:pass@"));
    assert!(!text.contains("raw-provider-body"));
    assert!(!text.contains("codex-access-token-secret"));
    assert!(!text.contains("codex-refresh-token-secret"));
}

fn assert_provider_auth_response_has_no_codex_secrets(body: &Value) {
    let text = body.to_string().to_lowercase();
    assert!(!text.contains("verifier"));
    assert!(!text.contains("access_token"));
    assert!(!text.contains("refresh_token"));
    assert!(!text.contains("api_key"));
    assert!(!text.contains("bearer"));
    assert!(!text.contains("cookie"));
    assert!(!text.contains("auth.json"));
    assert!(!text.contains("client_secret"));
    assert!(!text.contains("authorization_code"));
    assert!(!text.contains("codex-access-token-secret"));
    assert!(!text.contains("codex-refresh-token-secret"));
    assert!(!text.contains("codex-code"));
}

async fn empty_response_from(app: axum::Router, request: Request<Body>) -> StatusCode {
    app.oneshot(request).await.unwrap().status()
}

async fn text_response_from(app: axum::Router, request: Request<Body>) -> (StatusCode, String) {
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

#[test]
fn identity_loading_matches_contract() {
    let identity = ProductIdentity::load().unwrap();
    let raw: Value = serde_json::from_str(include_str!("../../../product/identity.json")).unwrap();
    assert_eq!(identity.product.id, raw["product"]["id"]);
    assert_eq!(identity.product.display_name, raw["product"]["displayName"]);
    assert_eq!(identity.engine.rust_crate, "yet-lsp");
    assert_eq!(identity.engine.binary_name, "yet-lsp");
}

#[test]
fn storage_resolver_uses_yet_ai_names() {
    let identity = ProductIdentity::load().unwrap();
    let paths = resolve_storage_paths(
        &identity,
        "/project".as_ref(),
        "/config".as_ref(),
        "/cache".as_ref(),
    );
    assert_eq!(paths.project_dir, std::path::Path::new("/project/.yet-ai"));
    assert_eq!(paths.config_dir, std::path::Path::new("/config/yet-ai"));
    assert_eq!(paths.cache_dir, std::path::Path::new("/cache/yet-ai"));
}

#[test]
fn default_bind_is_loopback() {
    assert_eq!(
        default_bind_addr(8001).ip(),
        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
    );
}

#[tokio::test]
async fn unauthenticated_ping_returns_401() {
    let response = test_app()
        .oneshot(Request::get("/v1/ping").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn query_string_token_is_not_accepted() {
    let response = test_app()
        .oneshot(
            Request::get(format!("/v1/ping?token={TEST_TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn ping_returns_identity() {
    let (status, body) =
        json_response(authed_request(Method::GET, "/v1/ping", Body::empty())).await;
    let identity: Value =
        serde_json::from_str(include_str!("../../../product/identity.json")).unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["productId"], identity["product"]["id"]);
    assert_eq!(body["displayName"], identity["product"]["displayName"]);
    assert_eq!(body["ready"], true);
}

#[tokio::test]
async fn caps_returns_local_direct_runtime() {
    let (status, body) =
        json_response(authed_request(Method::GET, "/v1/caps", Body::empty())).await;
    let identity: Value =
        serde_json::from_str(include_str!("../../../product/identity.json")).unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["productId"], identity["product"]["id"]);
    assert_eq!(body["runtime"]["mode"], "local");
    assert_eq!(body["runtime"]["cloudRequired"], false);
    assert_eq!(body["runtime"]["providerAccess"], "direct");
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!("chat")));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!("sse")));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!("providers")));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!("bridge")));
}

#[tokio::test]
async fn provider_auth_endpoints_require_bearer_token() {
    for (method, uri) in [
        (Method::GET, "/v1/provider-auth/openai/status"),
        (Method::POST, "/v1/provider-auth/openai/start"),
        (Method::POST, "/v1/provider-auth/openai/exchange"),
        (Method::POST, "/v1/provider-auth/openai/disconnect"),
    ] {
        let response = test_app()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn provider_auth_query_string_token_is_not_accepted() {
    let response = test_app()
        .oneshot(
            Request::get(format!(
                "/v1/provider-auth/openai/status?token={TEST_TOKEN}"
            ))
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn provider_auth_openai_status_returns_login_unavailable_fallback() {
    let (status, body) = json_response(authed_request(
        Method::GET,
        "/v1/provider-auth/openai/status",
        Body::empty(),
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["provider"], "openai");
    assert_eq!(body["configured"], false);
    assert_eq!(body["status"], "login_unavailable");
    assert_eq!(body["authSource"], "none");
    assert_eq!(body["supportsLogin"], false);
    assert_eq!(body["supportsApiKey"], true);
    assert_eq!(body["cloudRequired"], false);
    assert!(body["message"].as_str().unwrap().contains("API key"));
}

#[tokio::test]
async fn provider_auth_openai_status_redacts_configured_api_key() {
    let app = test_app();
    let api_key = "sk-provider-auth-secret-abcd";
    configure_openai_api_provider(app.clone(), api_key).await;

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured"], true);
    assert_eq!(body["status"], "api_key_configured");
    assert_eq!(body["authSource"], "api_key");
    assert_eq!(body["supportsLogin"], false);
    assert_eq!(body["supportsApiKey"], true);
    assert_eq!(body["cloudRequired"], false);
    assert_eq!(body["redacted"], "sk--...abcd");
    let text = body.to_string();
    assert!(!text.contains(api_key));
    assert!(!text.contains("provider-auth-secret"));
}

#[tokio::test]
async fn provider_auth_start_exchange_disconnect_are_sanitized_schema_shaped() {
    for (method, uri, expected_success) in [
        (Method::POST, "/v1/provider-auth/openai/start", false),
        (Method::POST, "/v1/provider-auth/openai/exchange", false),
        (Method::POST, "/v1/provider-auth/openai/disconnect", true),
    ] {
        let (status, body) = json_response(authed_request(method, uri, Body::from("{}"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["provider"], "openai");
        assert_eq!(body["configured"], false);
        assert_eq!(body["authSource"], "none");
        assert_eq!(body["supportsLogin"], false);
        assert_eq!(body["supportsApiKey"], true);
        assert_eq!(body["cloudRequired"], false);
        assert_eq!(body["success"], expected_success);
        let text = body.to_string().to_lowercase();
        assert!(!text.contains("access_token"));
        assert!(!text.contains("refresh_token"));
        assert!(!text.contains("cookie"));
        assert!(!text.contains("session"));
    }
}

#[tokio::test]
async fn provider_auth_openai_default_start_still_returns_login_unavailable() {
    let (status, body) = json_response(authed_request(
        Method::POST,
        "/v1/provider-auth/openai/start",
        Body::from("{}"),
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["provider"], "openai");
    assert_eq!(body["configured"], false);
    assert_eq!(body["status"], "login_unavailable");
    assert_eq!(body["authSource"], "none");
    assert_eq!(body["supportsLogin"], false);
    assert_eq!(body["supportsApiKey"], true);
    assert_eq!(body["cloudRequired"], false);
    assert_eq!(body["success"], false);
    assert!(body.get("authorizationUrl").is_none());
    assert!(body.get("sessionId").is_none());
}

#[tokio::test]
async fn provider_auth_openai_experimental_codex_like_start_returns_pending_pkce() {
    let app = test_app();
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(json!({ "experimentalCodexLike": true }).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["provider"], "openai");
    assert_eq!(body["configured"], false);
    assert_eq!(body["status"], "pending");
    assert_eq!(body["authSource"], "oauth");
    assert_eq!(body["supportsLogin"], true);
    assert_eq!(body["supportsApiKey"], true);
    assert_eq!(body["cloudRequired"], false);
    assert_eq!(body["success"], true);
    assert_eq!(body["pollIntervalSeconds"], 3);
    assert!(body["message"]
        .as_str()
        .unwrap()
        .contains("Experimental Codex-like"));
    let session_id = body["sessionId"].as_str().unwrap();
    assert!(session_id.starts_with("codex-"));
    assert!(session_id
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_'));
    chrono::DateTime::parse_from_rfc3339(body["expiresAt"].as_str().unwrap()).unwrap();
    assert_eq!(
        body["scopes"],
        json!(["openid", "profile", "email", "offline_access"])
    );
    let authorization_url = body["authorizationUrl"].as_str().unwrap();
    assert!(authorization_url.starts_with("https://auth.openai.com/oauth/authorize?"));
    assert!(authorization_url.contains("response_type=code"));
    assert!(authorization_url.contains("client_id=yet-ai-local-experimental"));
    assert!(authorization_url
        .contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fopenai%2Fcallback"));
    assert!(authorization_url.contains("scope=openid%20profile%20email%20offline_access"));
    assert!(authorization_url.contains("code_challenge="));
    assert!(authorization_url.contains("code_challenge_method=S256"));
    assert!(authorization_url.contains("id_token_add_organizations=true"));
    assert!(authorization_url.contains("codex_cli_simplified_flow=true"));
    assert!(authorization_url.contains("state="));
    assert!(authorization_url.contains("originator=yet_ai_local"));
    assert_provider_auth_response_has_no_codex_secrets(&body);
}

#[tokio::test]
async fn provider_auth_openai_experimental_status_returns_pending_without_verifier() {
    let app = test_app();
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(json!({ "experimentalCodexLike": true }).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let start_url = start["authorizationUrl"].as_str().unwrap().to_string();
    let session_id = start["sessionId"].as_str().unwrap().to_string();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "pending");
    assert_eq!(body["authSource"], "oauth");
    assert_eq!(body["sessionId"], session_id);
    assert_eq!(body["authorizationUrl"], start_url);
    assert_eq!(
        body["scopes"],
        json!(["openid", "profile", "email", "offline_access"])
    );
    assert!(body.get("success").is_none());
    assert_provider_auth_response_has_no_codex_secrets(&body);
}

#[tokio::test]
async fn provider_auth_openai_experimental_loopback_overrides_are_accepted() {
    let app = test_app();
    for (token_endpoint_url, chat_endpoint_url) in [
        (
            "http://127.0.0.1:1455/oauth/token",
            "http://127.0.0.1:1456/backend-api/codex",
        ),
        (
            "http://localhost:1455/oauth/token",
            "http://localhost:1456/backend-api/codex",
        ),
        (
            "http://[::1]:1455/oauth/token",
            "http://[::1]:1456/backend-api/codex",
        ),
    ] {
        let (status, body) = json_response_from(
            app.clone(),
            authed_request(
                Method::POST,
                "/v1/provider-auth/openai/start",
                Body::from(
                    json!({
                        "experimentalCodexLike": true,
                        "tokenEndpointUrl": token_endpoint_url,
                        "chatEndpointUrl": chat_endpoint_url
                    })
                    .to_string(),
                ),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "pending");
        assert_provider_auth_response_has_no_codex_secrets(&body);
    }
}

#[tokio::test]
async fn provider_auth_openai_experimental_overrides_must_be_loopback_and_safe() {
    let forbidden_secret_url = "https://user:pass@evil.example/token?access_token=secret";
    for body in [
        json!({ "experimentalCodexLike": true, "tokenEndpointUrl": "https://evil.example/token" }),
        json!({ "experimentalCodexLike": true, "chatEndpointUrl": "https://evil.example/backend-api/codex" }),
        json!({ "experimentalCodexLike": true, "tokenEndpointUrl": forbidden_secret_url }),
        json!({ "experimentalCodexLike": true, "tokenEndpointUrl": "file:///tmp/token" }),
        json!({ "experimentalCodexLike": true, "tokenEndpointUrl": "not a url sk-secret-endpoint-abcd" }),
    ] {
        let (status, body) = json_response(authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(body.to_string()),
        ))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid provider auth request");
        let text = body.to_string();
        assert!(!text.contains("evil.example"));
        assert!(!text.contains("user:pass"));
        assert!(!text.contains("access_token"));
        assert!(!text.contains("sk-secret-endpoint-abcd"));
        assert_provider_auth_response_has_no_codex_secrets(&body);
    }
}

#[tokio::test]
async fn provider_auth_openai_experimental_exchange_stores_tokens_and_returns_connected() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (token_endpoint_url, token_body_receiver) = start_mock_codex_token_endpoint().await;
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": token_endpoint_url })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = start["sessionId"].as_str().unwrap();
    let state = state_from_authorization_url(start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": session_id,
        "state": state,
        "code": "codex-code-success"
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured"], true);
    assert_eq!(body["status"], "connected");
    assert_eq!(body["authSource"], "oauth");
    assert_eq!(body["accountLabel"], "mock-user@example.test");
    assert_eq!(
        body["scopes"],
        json!(["openid", "profile", "email", "offline_access"])
    );
    chrono::DateTime::parse_from_rfc3339(body["expiresAt"].as_str().unwrap()).unwrap();
    assert_provider_auth_response_has_no_codex_secrets(&body);

    let token_body = token_body_receiver.await.unwrap();
    assert_eq!(token_body["grant_type"], "authorization_code");
    assert_eq!(token_body["code"], "codex-code-success");
    assert_eq!(token_body["client_id"], "yet-ai-local-experimental");
    assert!(token_body["code_verifier"].as_str().unwrap().len() > 20);

    let store = FileSecretStore::new(&paths.config_dir);
    assert_eq!(
        store
            .get_secret("openai", SecretKind::OAuthAccessToken)
            .await
            .unwrap()
            .as_deref(),
        Some("codex-access-token-secret-abcd")
    );
    assert_eq!(
        store
            .get_secret("openai", SecretKind::OAuthRefreshToken)
            .await
            .unwrap()
            .as_deref(),
        Some("codex-refresh-token-secret-wxyz")
    );

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "connected");
    assert_provider_auth_response_has_no_codex_secrets(&body);
}

#[tokio::test]
async fn provider_auth_openai_experimental_exchange_failure_keeps_pending_for_retry() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (token_endpoint_url, mut token_body_receiver) = start_flaky_codex_token_endpoint().await;
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": token_endpoint_url })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = start["sessionId"].as_str().unwrap().to_string();
    let state =
        state_from_authorization_url(start["authorizationUrl"].as_str().unwrap()).to_string();
    let exchange = json!({
        "sessionId": session_id,
        "state": state,
        "code": "codex-code-retry"
    });

    let (status, failure) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(failure["error"], "provider auth token exchange failed");
    assert_provider_auth_response_has_no_codex_secrets(&failure);

    let first_token_body = token_body_receiver.recv().await.unwrap();
    assert_eq!(first_token_body["code"], "codex-code-retry");
    assert!(first_token_body["code_verifier"].as_str().unwrap().len() > 20);

    let (status, pending) = json_response_from(
        app.clone(),
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pending["status"], "pending");
    assert_eq!(pending["sessionId"], session_id);
    assert_provider_auth_response_has_no_codex_secrets(&pending);

    let store = FileSecretStore::new(&paths.config_dir);
    assert_eq!(
        store
            .get_secret("openai", SecretKind::OAuthAccessToken)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .get_secret("openai", SecretKind::OAuthRefreshToken)
            .await
            .unwrap(),
        None
    );

    let (status, connected) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(connected["status"], "connected");
    assert_provider_auth_response_has_no_codex_secrets(&connected);

    let second_token_body = token_body_receiver.recv().await.unwrap();
    assert_eq!(second_token_body["code"], "codex-code-retry");

    let (status, duplicate) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(duplicate["error"], "provider auth session was not found");
    assert_provider_auth_response_has_no_codex_secrets(&duplicate);
}

#[tokio::test]
async fn provider_auth_openai_experimental_exchange_mismatch_expired_and_duplicate_are_safe() {
    let app = test_app();
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": token_endpoint_url })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let exchange = json!({
        "sessionId": start["sessionId"],
        "state": "wrong-state",
        "code": "codex-code-success"
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "provider auth session mismatch");
    assert_provider_auth_response_has_no_codex_secrets(&body);

    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let (status, expired) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": token_endpoint_url, "ttlSeconds": -1 })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let state = state_from_authorization_url(expired["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": expired["sessionId"],
        "state": state,
        "code": "codex-code-expired"
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    assert_eq!(body["error"], "provider auth session expired");
    assert_provider_auth_response_has_no_codex_secrets(&body);

    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": token_endpoint_url })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let state = state_from_authorization_url(start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": start["sessionId"],
        "state": state,
        "code": "codex-code-success"
    });
    let (status, first) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["status"], "connected");
    let (status, second) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(second["error"], "provider auth session was not found");
    assert_provider_auth_response_has_no_codex_secrets(&second);
}

#[tokio::test]
async fn provider_auth_openai_experimental_disconnect_clears_oauth_not_api_key_provider() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-codex-disconnect-secret-abcd";
    configure_openai_api_provider(app.clone(), api_key).await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": token_endpoint_url })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let state = state_from_authorization_url(start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": start["sessionId"],
        "state": state,
        "code": "codex-code-success"
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/disconnect",
            Body::from("{}"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert_eq!(body["status"], "revoked");
    assert_eq!(body["configured"], true);
    assert_provider_auth_response_has_no_codex_secrets(&body);
    assert!(!body.to_string().contains(api_key));

    let store = FileSecretStore::new(&paths.config_dir);
    assert_eq!(
        store
            .get_secret("openai", SecretKind::OAuthAccessToken)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .get_secret("openai", SecretKind::OAuthRefreshToken)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        store
            .get_secret("openai", SecretKind::AuthMetadata)
            .await
            .unwrap(),
        None
    );

    let (status, provider_body) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/providers/openai-api", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(provider_body["auth"]["configured"], true);
    assert!(!provider_body.to_string().contains(api_key));
}

#[tokio::test]
async fn provider_auth_rejects_unsupported_and_invalid_providers_safely() {
    for (uri, expected_status) in [
        ("/v1/provider-auth/ollama/status", StatusCode::NOT_FOUND),
        ("/v1/provider-auth/.bad/status", StatusCode::BAD_REQUEST),
    ] {
        let (status, body) = json_response(authed_request(Method::GET, uri, Body::empty())).await;
        assert_eq!(status, expected_status);
        let text = body.to_string();
        assert!(!text.contains("sk-"));
        assert!(!text.contains("token"));
    }
}

#[tokio::test]
async fn provider_auth_mock_oauth_happy_path_start_exchange_status_disconnect() {
    let app = test_app();
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(json!({ "mock": true }).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(start["status"], "pending");
    assert_eq!(start["supportsLogin"], true);
    assert_eq!(start["authSource"], "oauth");
    assert!(start["authorizationUrl"]
        .as_str()
        .unwrap()
        .starts_with("http://127.0.0.1/mock-oauth/authorize"));
    let session_id = start["sessionId"].as_str().unwrap();
    let state = start["authorizationUrl"]
        .as_str()
        .unwrap()
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap();

    let exchange = json!({
        "sessionId": session_id,
        "state": state,
        "code": "mock-code-success"
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured"], true);
    assert_eq!(body["status"], "connected");
    assert_eq!(body["authSource"], "oauth");
    assert_eq!(body["redacted"], "mock-oauth-...connected");
    let text = body.to_string();
    assert!(!text.contains("fake-access-token"));
    assert!(!text.contains("fake-refresh-token"));

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "connected");
    assert!(!body.to_string().contains("fake-access-token"));

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/disconnect",
            Body::from("{}"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "revoked");
    assert_eq!(body["success"], true);

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "login_unavailable");
}

#[tokio::test]
async fn provider_auth_mock_oauth_state_or_session_mismatch_is_rejected() {
    let app = test_app();
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(json!({ "mock": true }).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = start["sessionId"].as_str().unwrap();
    let exchange = json!({
        "sessionId": session_id,
        "state": "wrong-state",
        "code": "mock-code-success"
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "provider auth session mismatch");
    assert!(!body.to_string().contains("fake-access-token"));

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "pending");
}

#[tokio::test]
async fn provider_auth_mock_oauth_expired_session_is_rejected() {
    let app = test_app();
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(json!({ "mock": true, "ttlSeconds": -1 }).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = start["sessionId"].as_str().unwrap();
    let state = start["authorizationUrl"]
        .as_str()
        .unwrap()
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap();
    let exchange = json!({
        "sessionId": session_id,
        "state": state,
        "code": "mock-code-success"
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    assert_eq!(body["error"], "provider auth session expired");
    assert!(!body.to_string().contains("fake-access-token"));
}

#[tokio::test]
async fn provider_auth_mock_oauth_duplicate_exchange_is_safe() {
    let app = test_app();
    let (status, start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(json!({ "mock": true }).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_id = start["sessionId"].as_str().unwrap();
    let state = start["authorizationUrl"]
        .as_str()
        .unwrap()
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap();
    let exchange = json!({
        "sessionId": session_id,
        "state": state,
        "code": "mock-code-success"
    });
    let (status, first) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["status"], "connected");

    let (status, second) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(second["error"], "provider auth session was not found");
    assert!(!second.to_string().contains("fake-access-token"));
}

#[tokio::test]
async fn provider_auth_disconnect_does_not_delete_api_key_provider_config() {
    let app = test_app();
    let api_key = "sk-disconnect-secret-abcd";
    configure_openai_api_provider(app.clone(), api_key).await;

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/disconnect",
            Body::from("{}"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], true);
    assert_eq!(body["configured"], true);
    assert!(!body.to_string().contains(api_key));

    let (status, body) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/providers/openai-api", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["configured"], true);
    assert_eq!(body["auth"]["redacted"], "sk--...abcd");
    assert!(!body.to_string().contains(api_key));
}

#[tokio::test]
async fn providers_returns_empty_secret_free_registry() {
    let (status, body) =
        json_response(authed_request(Method::GET, "/v1/providers", Body::empty())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["providers"], json!([]));
    assert_eq!(body["cloudRequired"], false);
    assert_eq!(body["providerAccess"], "direct");
    let text = body.to_string().to_lowercase();
    assert!(!text.contains("secret"));
    assert!(!text.contains("api_key"));
    assert!(!text.contains("apikey"));
    assert!(!text.contains(TEST_TOKEN));
}

#[tokio::test]
async fn models_returns_empty_list() {
    let (status, body) =
        json_response(authed_request(Method::GET, "/v1/models", Body::empty())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["models"], json!([]));
}

#[tokio::test]
async fn create_provider_with_api_key_returns_redacted_response() {
    let api_key = "sk-test-provider-secret-abcd";
    let provider = json!({
        "id": "openai-local",
        "kind": "openai-compatible",
        "displayName": "Local OpenAI",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:8080/v1",
        "auth": { "type": "api_key", "apiKey": api_key },
        "models": [{ "id": "gpt-local", "displayName": "GPT Local" }],
        "capabilities": { "chat": true, "completion": false, "embeddings": false }
    });
    let (status, body) = json_response(authed_request(
        Method::POST,
        "/v1/providers",
        Body::from(provider.to_string()),
    ))
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["id"], "openai-local");
    assert_eq!(body["auth"]["type"], "api_key");
    assert_eq!(body["auth"]["configured"], true);
    let text = body.to_string();
    assert!(!text.contains(api_key));
    assert!(text.contains("...abcd"));
}

#[tokio::test]
async fn provider_base_url_validation_accepts_http_roots() {
    for (id, base_url) in [
        ("local-http", "http://127.0.0.1:8080/v1/"),
        ("custom-https", "https://api.example.test/v1"),
    ] {
        let provider = json!({
            "id": id,
            "kind": "openai-compatible",
            "displayName": id,
            "enabled": true,
            "baseUrl": base_url,
            "auth": { "type": "none" },
            "models": [{ "id": "gpt-test", "displayName": "GPT Test" }]
        });
        let (status, body) = json_response(authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ))
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(body["baseUrl"], base_url.trim_end_matches('/'));
    }
}

#[tokio::test]
async fn provider_base_url_validation_rejects_invalid_values_safely() {
    for (id, base_url) in [
        ("bad-scheme", "file:///tmp/provider.sock"),
        ("bad-userinfo", "http://user:pass@127.0.0.1:8080/v1"),
        ("bad-query", "https://example.test/v1?api_key=secret"),
        ("bad-fragment", "https://example.test/v1#token"),
        ("bad-malformed", "not a url sk-invalid-url-secret-abcd"),
    ] {
        let provider = json!({
            "id": id,
            "kind": "openai-compatible",
            "displayName": id,
            "enabled": true,
            "baseUrl": base_url,
            "auth": { "type": "none" }
        });
        let (status, body) = json_response(authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid provider baseUrl");
        let text = body.to_string();
        assert!(!text.contains(base_url));
        assert!(!text.contains("api_key"));
        assert!(!text.contains("secret"));
        assert!(!text.contains("token"));
        assert!(!text.contains("sk-invalid-url-secret-abcd"));
    }
}

#[tokio::test]
async fn provider_base_url_update_rejects_query_fragment_without_mutation() {
    let app = test_app();
    let provider = json!({
        "id": "url-update-provider",
        "kind": "openai-compatible",
        "displayName": "URL Update Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:8080/v1",
        "auth": { "type": "none" },
        "models": [{ "id": "gpt-test", "displayName": "GPT Test" }]
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    for base_url in [
        "https://example.test/v1?api_key=sk-update-query-secret-abcd",
        "https://example.test/v1#access_token=sk-update-fragment-secret-wxyz",
    ] {
        let update = json!({
            "baseUrl": base_url,
            "displayName": "Mutated URL Provider"
        });
        let (status, body) = json_response_from(
            app.clone(),
            authed_request(
                Method::PATCH,
                "/v1/providers/url-update-provider",
                Body::from(update.to_string()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid provider baseUrl");
        let text = body.to_string();
        assert!(!text.contains(base_url));
        assert!(!text.contains("api_key"));
        assert!(!text.contains("access_token"));
        assert!(!text.contains("update-query-secret"));
        assert!(!text.contains("update-fragment-secret"));

        let (status, stored) = json_response_from(
            app.clone(),
            authed_request(
                Method::GET,
                "/v1/providers/url-update-provider",
                Body::empty(),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(stored["displayName"], "URL Update Provider");
        assert_eq!(stored["baseUrl"], "http://127.0.0.1:8080/v1");
    }
}

#[tokio::test]
async fn create_existing_provider_returns_conflict_without_overwrite_or_temp_leftover() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let provider = json!({
        "id": "collision-provider",
        "kind": "custom",
        "displayName": "Original Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9100",
        "auth": { "type": "none" }
    });
    let replacement = json!({
        "id": "collision-provider",
        "kind": "custom",
        "displayName": "Replacement Provider",
        "enabled": false,
        "baseUrl": "http://127.0.0.1:9101",
        "auth": { "type": "api_key", "apiKey": "sk-collision-secret-abcd" }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(replacement.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(!body.to_string().contains("sk-collision-secret-abcd"));

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/collision-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["displayName"], "Original Provider");
    assert_eq!(body["enabled"], true);
    assert_eq!(body["auth"]["type"], "none");
    let providers_dir = paths.config_dir.join("providers.d");
    let temp_files: Vec<_> = std::fs::read_dir(providers_dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
        .collect();
    assert!(temp_files.is_empty());
}

#[tokio::test]
async fn duplicate_create_does_not_overwrite_existing_api_key_secret() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let old_key = "sk-duplicate-old-secret-abcd";
    let new_key = "sk-duplicate-new-secret-wxyz";
    let provider = json!({
        "id": "duplicate-secret-provider",
        "kind": "custom",
        "displayName": "Duplicate Secret Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9200",
        "auth": { "type": "api_key", "apiKey": old_key }
    });
    let duplicate = json!({
        "id": "duplicate-secret-provider",
        "kind": "custom",
        "displayName": "Duplicate Replacement Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9201",
        "auth": { "type": "api_key", "apiKey": new_key }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(duplicate.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let text = body.to_string();
    assert!(!text.contains(old_key));
    assert!(!text.contains(new_key));

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/duplicate-secret-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["displayName"], "Duplicate Secret Provider");
    assert_eq!(body["auth"]["configured"], true);
    assert_eq!(body["auth"]["redacted"], "sk--...abcd");
    assert!(!body.to_string().contains(old_key));
    assert!(!body.to_string().contains(new_key));

    let secret = FileSecretStore::new(&paths.config_dir)
        .get_secret("duplicate-secret-provider", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_eq!(secret.as_deref(), Some(old_key));
}

#[tokio::test]
async fn duplicate_create_does_not_plant_orphan_secret_for_none_auth_provider() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let orphan_key = "sk-duplicate-orphan-secret-abcd";
    let provider = json!({
        "id": "duplicate-none-provider",
        "kind": "custom",
        "displayName": "Duplicate None Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9300",
        "auth": { "type": "none" }
    });
    let duplicate = json!({
        "id": "duplicate-none-provider",
        "kind": "custom",
        "displayName": "Duplicate None Replacement Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9301",
        "auth": { "type": "api_key", "apiKey": orphan_key }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(duplicate.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(!body.to_string().contains(orphan_key));
    let secret = FileSecretStore::new(&paths.config_dir)
        .get_secret("duplicate-none-provider", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_eq!(secret, None);

    let update = json!({ "auth": { "type": "api_key" } });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::PATCH,
            "/v1/providers/duplicate-none-provider",
            Body::from(update.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["type"], "api_key");
    assert_eq!(body["auth"]["configured"], false);
    assert!(body["auth"].get("redacted").is_none());
    assert!(!body.to_string().contains(orphan_key));
}

#[tokio::test]
async fn update_with_mismatched_id_is_rejected_without_mutation() {
    let app = test_app();
    let api_key = "sk-mismatch-secret-abcd";
    let provider = json!({
        "id": "mismatch-provider",
        "kind": "custom",
        "displayName": "Mismatch Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9102",
        "auth": { "type": "api_key", "apiKey": api_key }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let update = json!({
        "id": "other-provider",
        "displayName": "Mutated Provider",
        "auth": { "type": "none" }
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::PATCH,
            "/v1/providers/mismatch-provider",
            Body::from(update.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!body.to_string().contains("other-provider"));

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/mismatch-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["displayName"], "Mismatch Provider");
    assert_eq!(body["auth"]["type"], "api_key");
    assert_eq!(body["auth"]["configured"], true);
    assert!(!body.to_string().contains(api_key));
}

#[tokio::test]
async fn malformed_provider_config_returns_sanitized_error() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let providers_dir = paths.config_dir.join("providers.d");
    std::fs::create_dir_all(&providers_dir).unwrap();
    std::fs::write(
        providers_dir.join("bad-provider.json"),
        r#"{ "apiKey": "sk-malformed-secret-abcd", "broken": "#,
    )
    .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/providers", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let text = body.to_string();
    assert!(text.contains("invalid provider config"));
    assert!(!text.contains("sk-malformed-secret-abcd"));
    assert!(!text.contains("broken"));
    assert!(!text.contains("bad-provider"));
}

#[tokio::test]
async fn get_and_list_provider_never_return_raw_api_key() {
    let app = test_app();
    let api_key = "sk-list-secret-abcd";
    let provider = json!({
        "id": "list-provider",
        "kind": "custom",
        "displayName": "List Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9000",
        "auth": { "type": "api_key", "apiKey": api_key }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, get_body) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/providers/list-provider", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, list_body) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/providers", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!get_body.to_string().contains(api_key));
    assert!(!list_body.to_string().contains(api_key));
    assert_eq!(list_body["cloudRequired"], false);
    assert_eq!(list_body["providerAccess"], "direct");
}

#[tokio::test]
async fn provider_secret_store_corruption_does_not_expose_raw_secret() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-corrupt-store-secret-abcd";
    let provider = json!({
        "id": "corrupt-secret-provider",
        "kind": "custom",
        "displayName": "Corrupt Secret Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9004",
        "auth": { "type": "api_key", "apiKey": api_key }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let secret_path = FileSecretStore::new(&paths.config_dir)
        .secret_path("corrupt-secret-provider", SecretKind::ApiKey)
        .unwrap();
    std::fs::write(&secret_path, r#"{"value":"sk-corrupt-store-secret-abcd""#).unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/corrupt-secret-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["configured"], false);
    assert!(!body.to_string().contains(api_key));
    assert!(!body.to_string().contains("corrupt-store-secret"));
}

#[tokio::test]
async fn update_secret_redacts_old_and_new_secrets() {
    let app = test_app();
    let old_key = "sk-old-provider-secret-abcd";
    let new_key = "sk-new-provider-secret-wxyz";
    let provider = json!({
        "id": "update-provider",
        "kind": "custom",
        "displayName": "Update Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9001",
        "auth": { "type": "api_key", "apiKey": old_key }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let update = json!({ "auth": { "type": "api_key", "apiKey": new_key } });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::PATCH,
            "/v1/providers/update-provider",
            Body::from(update.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let text = body.to_string();
    assert!(!text.contains(old_key));
    assert!(!text.contains(new_key));
    assert!(text.contains("...wxyz"));
}

#[tokio::test]
async fn delete_provider_removes_local_config() {
    let app = test_app();
    let provider = json!({
        "id": "delete-provider",
        "kind": "ollama",
        "displayName": "Local Ollama",
        "enabled": true,
        "auth": { "type": "none" }
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["baseUrl"], "http://127.0.0.1:11434");

    let status = empty_response_from(
        app.clone(),
        authed_request(
            Method::DELETE,
            "/v1/providers/delete-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/providers/delete-provider", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn invalid_provider_id_is_rejected() {
    let provider = json!({
        "id": "../bad",
        "kind": "custom",
        "displayName": "Bad Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9002",
        "auth": { "type": "none" }
    });
    let (status, body) = json_response(authed_request(
        Method::POST,
        "/v1/providers",
        Body::from(provider.to_string()),
    ))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!body.to_string().contains("../bad"));
}

#[tokio::test]
async fn provider_storage_path_uses_yet_ai_config_dir_not_project_state() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-storage-secret-abcd";
    let provider = json!({
        "id": "storage-provider",
        "kind": "custom",
        "displayName": "Storage Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9003",
        "auth": { "type": "api_key", "apiKey": api_key }
    });
    let (status, _) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let config_file = paths.config_dir.join("providers.d/storage-provider.json");
    assert!(config_file.exists());
    assert!(config_file.starts_with(paths.config_dir.join("providers.d")));
    assert!(!paths
        .project_dir
        .join("providers.d/storage-provider.json")
        .exists());
    let stored = std::fs::read_to_string(config_file).unwrap();
    assert!(!stored.contains(api_key));
    let secret = FileSecretStore::new(&paths.config_dir)
        .get_secret("storage-provider", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_eq!(secret.as_deref(), Some(api_key));
}

#[tokio::test]
async fn provider_test_openai_compatible_success_uses_loopback_models_and_auth() {
    let api_key = "sk-provider-test-secret-abcd";
    let (base_url, auth_receiver) = start_mock_models_provider(
        StatusCode::OK,
        r#"{"data":[{"id":"gpt-test"}]}"#,
        Some("Bearer sk-provider-test-secret-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/openai-stream/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["providerId"], "openai-stream");
    assert_eq!(body["status"], "reachable");
    assert_eq!(body["modelId"], "gpt-test");
    assert_eq!(body["cloudRequired"], false);
    assert!(!body.to_string().contains(api_key));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-provider-test-secret-abcd").await;
}

#[tokio::test]
async fn provider_test_openai_compatible_chat_completions_base_url_uses_models_endpoint() {
    let api_key = "sk-provider-test-chat-url-abcd";
    let (base_url, auth_receiver) = start_mock_models_provider(
        StatusCode::OK,
        r#"{"data":[{"id":"gpt-test"}]}"#,
        Some("Bearer sk-provider-test-chat-url-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(
        app.clone(),
        format!("{base_url}/v1/chat/completions"),
        api_key,
    )
    .await;

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/openai-stream/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["status"], "reachable");
    assert_eq!(body["modelId"], "gpt-test");
    assert!(!body.to_string().contains(api_key));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-provider-test-chat-url-abcd").await;
}

#[tokio::test]
async fn provider_test_openai_compatible_unauthorized_is_sanitized() {
    let api_key = "sk-provider-test-unauthorized-abcd";
    let (base_url, auth_receiver) = start_mock_models_provider(
        StatusCode::UNAUTHORIZED,
        "raw-provider-body access_token=secret Bearer should-not-leak",
        Some("Bearer sk-provider-test-unauthorized-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/openai-stream/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert_eq!(body["status"], "unauthorized");
    let text = body.to_string();
    assert!(!text.contains(api_key));
    assert!(!text.contains("access_token"));
    assert!(!text.contains("should-not-leak"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-provider-test-unauthorized-abcd").await;
}

#[tokio::test]
async fn provider_test_openai_compatible_down_is_sanitized() {
    let api_key = "sk-provider-test-down-abcd";
    let app = test_app();
    configure_openai_provider(
        app.clone(),
        start_accept_and_drop_loopback_base_url().await,
        api_key,
    )
    .await;

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/openai-stream/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert_eq!(body["status"], "unreachable");
    assert!(!body.to_string().contains(api_key));
}

#[tokio::test]
async fn provider_test_openai_compatible_timeout_is_sanitized() {
    let api_key = "sk-provider-test-timeout-abcd";
    let (base_url, auth_receiver) =
        start_slow_models_provider(Some("Bearer sk-provider-test-timeout-abcd")).await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/openai-stream/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert_eq!(body["status"], "timeout");
    let text = body.to_string();
    assert!(!text.contains(api_key));
    assert!(!text.contains("provider-test-timeout"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-provider-test-timeout-abcd").await;
}

#[tokio::test]
async fn provider_test_missing_provider_and_missing_secret_are_stable() {
    let app = test_app();
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers/missing-provider/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "provider not found");

    let provider = json!({
        "id": "openai-missing-secret",
        "kind": "openai-compatible",
        "displayName": "OpenAI Missing Secret",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:8080/v1",
        "auth": { "type": "api_key" },
        "models": [{ "id": "gpt-test", "displayName": "GPT Test" }],
        "capabilities": { "chat": true, "completion": false, "embeddings": false }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/openai-missing-secret/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert_eq!(body["status"], "missing_secret");
    assert!(!body.to_string().contains("api_key"));
}

#[tokio::test]
async fn provider_test_missing_model_and_upstream_error_are_sanitized() {
    let api_key = "sk-provider-test-upstream-abcd";
    let (base_url, auth_receiver) = start_mock_models_provider(
        StatusCode::INTERNAL_SERVER_ERROR,
        "raw-provider-body api_key=secret-token Bearer should-not-leak",
        Some("Bearer sk-provider-test-upstream-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider_without_models(app.clone(), base_url.clone(), api_key).await;

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers/openai-no-model/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert_eq!(body["status"], "missing_model");

    configure_openai_provider(app.clone(), base_url, api_key).await;
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/openai-stream/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert_eq!(body["status"], "upstream_error");
    let text = body.to_string();
    assert!(!text.contains(api_key));
    assert!(!text.contains("api_key"));
    assert!(!text.contains("should-not-leak"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-provider-test-upstream-abcd").await;
}

#[tokio::test]
async fn provider_operations_do_not_require_cloud_url_or_account() {
    let app = test_app();
    let provider = json!({
        "id": "local-only-provider",
        "kind": "ollama",
        "displayName": "Local Only Provider",
        "enabled": true,
        "auth": { "type": "none" }
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["baseUrl"], "http://127.0.0.1:11434");

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/local-only-provider/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert_eq!(body["status"], "unsupported_kind");
    assert_eq!(body["cloudRequired"], false);
    assert!(!body.to_string().to_lowercase().contains("account"));
}

#[tokio::test]
async fn positive_chat_command_contract_fixtures_are_accepted() {
    for (chat_id, command, expected_type) in [
        (
            "chat-user-message-contract",
            include_str!("../../../packages/contracts/examples/engine/user-message-command.json"),
            "user_message",
        ),
        (
            "chat-abort-contract",
            include_str!("../../../packages/contracts/examples/engine/abort-command.json"),
            "abort",
        ),
    ] {
        let (status, body) = json_response(authed_request(
            Method::POST,
            &format!("/v1/chats/{chat_id}/commands"),
            Body::from(command),
        ))
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["accepted"], true);
        assert_eq!(body["type"], expected_type);
        assert_eq!(body["chatId"], chat_id);
    }
}

#[tokio::test]
async fn invalid_chat_command_contract_fixtures_are_rejected_safely() {
    for (command, expected_status, forbidden) in [
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-tool-call.json"),
            StatusCode::NOT_IMPLEMENTED,
            ["tool_call", "read_file", "arguments", "name"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-abort-payload.json"),
            StatusCode::BAD_REQUEST,
            ["stop current work", "reason"].as_slice(),
        ),
    ] {
        let (status, text) = text_response_from(
            test_app(),
            authed_request(
                Method::POST,
                "/v1/chats/chat-invalid-contract/commands",
                Body::from(command),
            ),
        )
        .await;
        assert_eq!(status, expected_status);
        for value in forbidden {
            assert!(!text.contains(value));
        }
        let lower = text.to_lowercase();
        assert!(!lower.contains("api_key"));
        assert!(!lower.contains("token"));
        assert!(!lower.contains("secret"));
    }
}

#[tokio::test]
async fn abort_command_with_empty_payload_is_accepted() {
    let command = json!({
        "requestId": "req-abort-empty-payload",
        "type": "abort",
        "payload": {}
    });
    let (status, body) = json_response(authed_request(
        Method::POST,
        "/v1/chats/chat-001/commands",
        Body::from(command.to_string()),
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["accepted"], true);
    assert_eq!(body["type"], "abort");
}

#[tokio::test]
async fn abort_command_rejects_non_empty_or_privileged_payload() {
    for payload in [
        json!({ "reason": "sk-abort-payload-secret-abcd" }),
        json!({ "toolCallId": "secret-tool-call", "allow": true }),
        json!("sk-abort-payload-secret-abcd"),
    ] {
        let command = json!({
            "requestId": "req-abort-invalid-payload",
            "type": "abort",
            "payload": payload
        });
        let (status, text) = text_response_from(
            test_app(),
            authed_request(
                Method::POST,
                "/v1/chats/chat-001/commands",
                Body::from(command.to_string()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!text.contains("sk-abort-payload-secret-abcd"));
        assert!(!text.contains("secret-tool-call"));
        assert!(!text.contains("toolCallId"));
    }
}

#[tokio::test]
async fn user_message_command_rejects_extra_payload_fields() {
    let command = json!({
        "requestId": "req-extra-payload",
        "type": "user_message",
        "payload": {
            "content": "hello",
            "apiKey": "sk-extra-payload-secret-abcd"
        }
    });
    let (status, text) = text_response_from(
        test_app(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-001/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!text.contains("sk-extra-payload-secret-abcd"));
    assert!(!text.contains("apiKey"));
}

#[tokio::test]
async fn user_message_command_rejects_empty_content() {
    let command = json!({
        "requestId": "req-empty-content",
        "type": "user_message",
        "payload": { "content": "" }
    });
    let (status, text) = text_response_from(
        test_app(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-001/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(text.is_empty());
}

#[tokio::test]
async fn chat_command_rejects_too_long_request_id() {
    let command = json!({
        "requestId": "r".repeat(129),
        "type": "user_message",
        "payload": { "content": "hello sk-too-long-request-secret-abcd" }
    });
    let (status, text) = text_response_from(
        test_app(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-001/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!text.contains("sk-too-long-request-secret-abcd"));
}

#[tokio::test]
async fn user_message_command_rejects_too_long_content() {
    let command = json!({
        "requestId": "req-too-long-content",
        "type": "user_message",
        "payload": { "content": "x".repeat(20001) }
    });
    let status = empty_response_from(
        test_app(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-001/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn unsupported_privileged_commands_remain_rejected() {
    for command_type in [
        "tool_decision",
        "ide_tool_result",
        "update_message",
        "remove_message",
        "regenerate",
        "set_params",
        "shell_exec",
        "file_edit",
    ] {
        let command = json!({
            "requestId": format!("req-{command_type}"),
            "type": command_type,
            "payload": {
                "command": "rm -rf / sk-privileged-command-secret-abcd",
                "path": "/tmp/secret-file"
            }
        });
        let (status, text) = text_response_from(
            test_app(),
            authed_request(
                Method::POST,
                "/v1/chats/chat-001/commands",
                Body::from(command.to_string()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
        assert!(text.contains("unsupported command type"));
        assert!(!text.contains(command_type));
        assert!(!text.contains("sk-privileged-command-secret-abcd"));
        assert!(!text.contains("secret-file"));
    }
}

#[tokio::test]
async fn openai_compatible_streaming_maps_chunks_to_sse_events() {
    let api_key = "sk-stream-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n",
        Some("Bearer sk-stream-secret-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;

    let command = json!({
        "requestId": "req-stream",
        "type": "user_message",
        "payload": { "content": "hello" }
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-stream/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["accepted"], true);

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-stream").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    assert!(events.iter().any(|event| event["type"] == "stream_started"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_delta"
            && event["payload"]["delta"]["content"] == "Hel"));
    assert!(events.iter().any(
        |event| event["type"] == "stream_delta" && event["payload"]["delta"]["content"] == "lo"
    ));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_finished"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-stream-secret-abcd").await;
    assert!(!text.contains(api_key));
}

#[tokio::test]
async fn abort_with_no_active_stream_is_accepted_and_multiple_aborts_are_safe() {
    let app = test_app();
    send_abort(app.clone(), "chat-no-active-abort", "req-abort-1").await;
    send_abort(app.clone(), "chat-no-active-abort", "req-abort-2").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-no-active-abort").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    assert!(!events.iter().any(|event| event["type"] == "stream_delta"));
    assert!(!text.to_lowercase().contains("token"));
}

#[tokio::test]
async fn abort_cancels_active_provider_stream_without_later_deltas() {
    let api_key = "sk-abort-stream-secret-abcd";
    let (base_url, auth_receiver, first_receiver, continue_sender) =
        start_slow_mock_provider(Some("Bearer sk-abort-stream-secret-abcd")).await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message(app.clone(), "chat-abort-stream").await;
    first_receiver.await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    send_abort(app.clone(), "chat-abort-stream", "req-abort-stream-1").await;
    send_abort(app.clone(), "chat-abort-stream", "req-abort-stream-2").await;
    let _ = continue_sender.send(());
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-abort-stream").await;
    let events = sse_json_events(&text);
    assert!(events.iter().any(|event| event["type"] == "stream_started"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_delta"
            && event["payload"]["delta"]["content"] == "first"));
    assert!(!events
        .iter()
        .any(|event| event["type"] == "stream_delta"
            && event["payload"]["delta"]["content"] == "second"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_finished"
            && event["payload"]["finishReason"] == "abort"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-abort-stream-secret-abcd").await;
    assert!(!text.contains(api_key));
    assert_sanitized_sse_error(&text);
}

#[tokio::test]
async fn experimental_openai_oauth_token_streams_chat_via_mock_endpoint() {
    let (chat_base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"OAuth\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" chat\"}}]}\n\ndata: [DONE]\n\n",
        Some("Bearer codex-access-token-secret-abcd"),
    )
    .await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let app = test_app();
    connect_experimental_openai_oauth(app.clone(), token_endpoint_url, chat_base_url).await;
    send_user_message(app.clone(), "chat-codex-oauth").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-codex-oauth").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    assert!(events.iter().any(|event| event["type"] == "stream_started"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_delta"
            && event["payload"]["delta"]["content"] == "OAuth"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_delta"
            && event["payload"]["delta"]["content"] == " chat"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_finished"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer codex-access-token-secret-abcd").await;
    assert!(!text.contains("codex-access-token-secret"));
    assert!(!text.contains("codex-refresh-token-secret"));
}

#[tokio::test]
async fn api_key_provider_is_preferred_over_experimental_openai_oauth() {
    let api_key = "sk-preferred-secret-abcd";
    let (oauth_chat_base_url, oauth_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"oauth\"}}]}\n\ndata: [DONE]\n\n",
        None,
    )
    .await;
    let (api_base_url, api_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"api-key\"}}]}\n\ndata: [DONE]\n\n",
        Some("Bearer sk-preferred-secret-abcd"),
    )
    .await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let app = test_app();
    connect_experimental_openai_oauth(app.clone(), token_endpoint_url, oauth_chat_base_url).await;
    configure_openai_provider(app.clone(), api_base_url, api_key).await;
    send_user_message(app.clone(), "chat-api-preferred").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-api-preferred").await;
    assert!(text.contains("api-key"));
    assert!(!text.contains("oauth"));
    assert!(!text.contains(api_key));
    assert!(!text.contains("codex-access-token-secret"));
    assert_received_exactly_one_auth(api_auth_receiver, "Bearer sk-preferred-secret-abcd").await;
    assert_no_observed_auth(oauth_auth_receiver).await;
}

#[tokio::test]
async fn expired_experimental_openai_oauth_falls_back_to_provider_not_configured() {
    let (chat_base_url, _) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unused\"}}]}\n\ndata: [DONE]\n\n",
        None,
    )
    .await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint_with(0).await;
    let app = test_app();
    connect_experimental_openai_oauth(app.clone(), token_endpoint_url, chat_base_url).await;

    let (status, auth_status) = json_response_from(
        app.clone(),
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(auth_status["status"], "expired");
    assert_provider_auth_response_has_no_codex_secrets(&auth_status);

    send_user_message(app.clone(), "chat-expired-oauth").await;
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-expired-oauth").await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_not_configured");
    assert_sanitized_sse_error(&text);
}

#[tokio::test]
async fn experimental_openai_oauth_unauthorized_error_is_sanitized() {
    let (chat_base_url, auth_receiver) = start_mock_provider(
        StatusCode::UNAUTHORIZED,
        "raw-provider-body access_token=secret-token Bearer should-not-leak",
        Some("Bearer codex-access-token-secret-abcd"),
    )
    .await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let app = test_app();
    connect_experimental_openai_oauth(app.clone(), token_endpoint_url, chat_base_url).await;
    send_user_message(app.clone(), "chat-codex-unauthorized").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-codex-unauthorized").await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_unauthorized");
    assert_sanitized_sse_error(&text);
    assert_received_exactly_one_auth(auth_receiver, "Bearer codex-access-token-secret-abcd").await;
}

#[tokio::test]
async fn no_enabled_provider_replays_provider_not_configured_error_event() {
    let app = test_app();
    send_user_message(app.clone(), "chat-no-provider").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-no-provider").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    assert!(events.iter().any(|event| event["type"] == "stream_started"));
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_not_configured");
    assert_sanitized_sse_error(&text);
}

#[tokio::test]
async fn provider_without_model_replays_model_not_configured_error_event() {
    let api_key = "sk-no-model-secret-abcd";
    let (base_url, _) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unused\"}}]}\n\n",
        None,
    )
    .await;
    let app = test_app();
    configure_openai_provider_without_models(app.clone(), base_url, api_key).await;
    send_user_message(app.clone(), "chat-no-model").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-no-model").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "model_not_configured");
    assert_sanitized_sse_error(&text);
}

#[tokio::test]
async fn provider_unauthorized_produces_sanitized_error_event() {
    let api_key = "sk-unauthorized-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::UNAUTHORIZED,
        "raw-provider-body access_token=secret-token Bearer should-not-leak",
        Some("Bearer sk-unauthorized-secret-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message(app.clone(), "chat-unauthorized").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-unauthorized").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_unauthorized");
    assert_sanitized_sse_error(&text);
    assert!(!text.contains(api_key));
    assert!(!text.contains("unauthorized-secret"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-unauthorized-secret-abcd").await;
}

#[tokio::test]
async fn malformed_provider_chunk_produces_safe_error_event() {
    let api_key = "sk-malformed-stream-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: { not-json, api_key=raw-provider-body, url=http://user:pass@127.0.0.1 }\n\n",
        Some("Bearer sk-malformed-stream-secret-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message(app.clone(), "chat-malformed").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-malformed").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_malformed_stream");
    assert_sanitized_sse_error(&text);
    assert!(!text.contains(api_key));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-malformed-stream-secret-abcd").await;
}

#[tokio::test]
async fn streaming_chat_does_not_require_yet_ai_backend_account_or_cloud_url() {
    let api_key = "sk-local-only-stream-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"local\"}}]}\n\ndata: [DONE]\n\n",
        Some("Bearer sk-local-only-stream-secret-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    let command = json!({
        "requestId": "req-local-only",
        "type": "user_message",
        "payload": { "content": "hello" }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-local-only/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-local-only").await;
    assert!(text.contains("local"));
    let lower = text.to_lowercase();
    assert!(!lower.contains("account"));
    assert!(!lower.contains("cloud"));
    assert!(!lower.contains("backend"));
    assert_received_exactly_one_auth(auth_receiver, "Bearer sk-local-only-stream-secret-abcd").await;
}

#[tokio::test]
async fn sse_emits_snapshot() {
    let response = test_app()
        .oneshot(authed_request(
            Method::GET,
            "/v1/chats/subscribe?chat_id=chat-001",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "text/event-stream"
    );
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(text.contains("event: snapshot"));
    assert!(text.contains("\"type\":\"snapshot\""));
    assert!(text.contains("\"chatId\":\"chat-001\""));
}

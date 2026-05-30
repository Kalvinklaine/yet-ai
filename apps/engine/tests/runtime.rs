use axum::body::Bytes;
use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request, StatusCode};
use axum::response::IntoResponse;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tower::ServiceExt;
use yet_lsp::chat_history;
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

async fn configure_openai_provider_with_id(
    app: axum::Router,
    id: &str,
    base_url: String,
    api_key: &str,
    model_id: &str,
) {
    let provider = json!({
        "id": id,
        "kind": "openai-compatible",
        "displayName": id,
        "enabled": true,
        "baseUrl": base_url,
        "auth": { "type": "api_key", "apiKey": api_key },
        "models": [{ "id": model_id, "displayName": model_id }],
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

async fn configure_provider(app: axum::Router, provider: Value, forbidden_secret: Option<&str>) {
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
    if let Some(secret) = forbidden_secret {
        assert!(!body.to_string().contains(secret));
    }
}

async fn configure_openai_provider_without_models_with_id(
    app: axum::Router,
    id: &str,
    base_url: String,
    api_key: &str,
) {
    let provider = json!({
        "id": id,
        "kind": "openai-compatible",
        "displayName": id,
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

async fn start_mock_provider_with_request_body(
    status: StatusCode,
    stream_body: &'static str,
) -> (String, mpsc::Receiver<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (body_sender, body_receiver) = mpsc::channel(4);
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let body_sender = body_sender.clone();
            async move {
                let bytes = to_bytes(request.into_body(), usize::MAX).await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                let _ = body_sender.send(body).await;
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
    (format!("http://{address}"), body_receiver)
}

async fn start_chunked_mock_provider(
    chunks: Vec<Vec<u8>>,
) -> (String, mpsc::Receiver<Option<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = mpsc::channel(4);
    let chunks = std::sync::Arc::new(chunks);
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let auth_sender = auth_sender.clone();
            let chunks = chunks.clone();
            async move {
                let auth = request
                    .headers()
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let _ = auth_sender.send(auth.clone()).await;
                let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(8);
                tokio::spawn(async move {
                    for chunk in chunks.iter() {
                        let _ = tx.send(Ok(Bytes::copy_from_slice(chunk))).await;
                    }
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
    (format!("http://{address}"), auth_receiver)
}

async fn start_mock_models_provider(
    status: StatusCode,
    body: &'static str,
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

async fn start_slow_models_provider() -> (String, mpsc::Receiver<Option<String>>) {
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

async fn assert_first_auth_and_no_immediate_extra_auth(
    mut auth_receiver: mpsc::Receiver<Option<String>>,
    expected_auth: &'static str,
    scenario: &'static str,
) {
    let auth = tokio::time::timeout(std::time::Duration::from_secs(2), auth_receiver.recv())
        .await
        .unwrap_or_else(|_| panic!("{scenario}: expected one auth observation"))
        .unwrap_or_else(|| panic!("{scenario}: auth observation channel closed"));
    assert_stored_secret(auth.as_deref(), expected_auth);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), auth_receiver.recv())
            .await
            .is_err(),
        "{scenario}: observed an immediate extra auth call"
    );
}

async fn assert_no_observed_auth(mut auth_receiver: mpsc::Receiver<Option<String>>) {
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), auth_receiver.recv())
            .await
            .is_err()
    );
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

async fn start_slow_mock_provider() -> (
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
    start_mock_codex_token_endpoint_response(Some(expires_in), Some("mock-user@example.test")).await
}

async fn start_mock_codex_token_endpoint_response(
    expires_in: Option<i64>,
    account_label: Option<&'static str>,
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
                let mut response = serde_json::Map::new();
                response.insert(
                    "access_token".to_string(),
                    json!("codex-access-token-secret-abcd"),
                );
                response.insert(
                    "refresh_token".to_string(),
                    json!("codex-refresh-token-secret-wxyz"),
                );
                response.insert(
                    "scope".to_string(),
                    json!("openid profile email offline_access"),
                );
                if let Some(expires_in) = expires_in {
                    response.insert("expires_in".to_string(), json!(expires_in));
                }
                if let Some(account_label) = account_label {
                    response.insert("account_label".to_string(), json!(account_label));
                }
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    Value::Object(response).to_string(),
                )
                    .into_response()
            }
        };
        let app = axum::Router::new().route("/oauth/token", axum::routing::post(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}/oauth/token"), body_receiver)
}

async fn start_hanging_codex_token_endpoint() -> (String, oneshot::Receiver<Value>) {
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
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    "{}",
                )
                    .into_response()
            }
        };
        let app = axum::Router::new().route("/oauth/token", axum::routing::post(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}/oauth/token"), body_receiver)
}

async fn start_delayed_codex_token_endpoint() -> (String, mpsc::Receiver<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (body_sender, body_receiver) = mpsc::channel(4);
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let body_sender = body_sender.clone();
            async move {
                let bytes = to_bytes(request.into_body(), usize::MAX).await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                let _ = body_sender.send(body).await;
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
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

async fn start_refresh_codex_token_endpoint(
    status: StatusCode,
    response: Value,
) -> (String, mpsc::Receiver<Value>) {
    start_sequence_refresh_codex_token_endpoint(vec![(status, response)]).await
}

async fn start_sequence_refresh_codex_token_endpoint(
    responses: Vec<(StatusCode, Value)>,
) -> (String, mpsc::Receiver<Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (body_sender, body_receiver) = mpsc::channel(8);
    let responses = std::sync::Arc::new(responses);
    let attempts = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let body_sender = body_sender.clone();
            let responses = responses.clone();
            let attempts = attempts.clone();
            async move {
                let bytes = to_bytes(request.into_body(), usize::MAX).await.unwrap();
                let body: Value = serde_json::from_slice(&bytes).unwrap();
                let _ = body_sender.send(body).await;
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                let index = attempts.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let (status, response) = responses
                    .get(index)
                    .or_else(|| responses.last())
                    .cloned()
                    .unwrap();
                (
                    status,
                    [(header::CONTENT_TYPE, "application/json")],
                    response.to_string(),
                )
                    .into_response()
            }
        };
        let app = axum::Router::new().route("/oauth/token", axum::routing::post(handler));
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{address}/oauth/token"), body_receiver)
}

async fn start_stale_oauth_chat_provider() -> (String, mpsc::Receiver<Option<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = mpsc::channel(16);
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
                if auth.as_deref() == Some("Bearer access-2") {
                    return (
                        StatusCode::OK,
                        [(header::CONTENT_TYPE, "text/event-stream")],
                        "data: {\"choices\":[{\"delta\":{\"content\":\"refreshed\"}}]}\n\ndata: [DONE]\n\n",
                    )
                        .into_response();
                }
                (
                    StatusCode::UNAUTHORIZED,
                    [(header::CONTENT_TYPE, "application/json")],
                    "{\"error\":{\"message\":\"stale access_token access-1 refresh_token refresh-1 refresh_token_reused\"}}",
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

async fn start_slow_401_oauth_chat_provider() -> (String, mpsc::Receiver<Option<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = mpsc::channel(16);
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
                if auth.as_deref() == Some("Bearer access-2") {
                    return (
                        StatusCode::OK,
                        [(header::CONTENT_TYPE, "text/event-stream")],
                        Body::from("data: {\"choices\":[{\"delta\":{\"content\":\"refreshed-after-slow-401\"}}]}\n\ndata: [DONE]\n\n"),
                    )
                        .into_response();
                }
                let (_tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(1);
                (
                    StatusCode::UNAUTHORIZED,
                    [(header::CONTENT_TYPE, "application/json")],
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
    (format!("http://{address}"), auth_receiver)
}

async fn seed_experimental_openai_oauth(
    paths: &StoragePaths,
    chat_base_url: String,
    token_endpoint_url: String,
    access_token: &str,
    refresh_token: &str,
) {
    seed_experimental_openai_oauth_with_ttl(
        paths,
        chat_base_url,
        token_endpoint_url,
        access_token,
        refresh_token,
        1800,
    )
    .await;
}

async fn seed_experimental_openai_oauth_with_ttl(
    paths: &StoragePaths,
    chat_base_url: String,
    token_endpoint_url: String,
    access_token: &str,
    refresh_token: &str,
    ttl_seconds: i64,
) {
    let store = FileSecretStore::new(&paths.config_dir);
    let metadata = json!({
        "provider": "openai",
        "accountLabel": "mock-user@example.test",
        "scopes": ["openid", "profile", "email", "offline_access"],
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(ttl_seconds)).to_rfc3339(),
        "redacted": "ac...ss",
        "chatBaseUrl": chat_base_url,
        "chatModel": "gpt-5-codex",
        "tokenEndpointUrl": token_endpoint_url
    });
    store
        .put_secret("openai", SecretKind::OAuthAccessToken, access_token)
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::OAuthRefreshToken, refresh_token)
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();
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

async fn send_user_message_with_content(
    app: axum::Router,
    chat_id: &str,
    content: &str,
) -> StatusCode {
    let command = json!({
        "requestId": format!("req-{chat_id}"),
        "type": "user_message",
        "payload": { "content": content }
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
    if status == StatusCode::OK {
        assert_eq!(body["accepted"], true);
    }
    status
}

async fn wait_for_chat_messages(app: axum::Router, chat_id: &str, count: usize) -> Value {
    for _ in 0..40 {
        let (status, body) = json_response_from(
            app.clone(),
            authed_request(Method::GET, &format!("/v1/chats/{chat_id}"), Body::empty()),
        )
        .await;
        if status == StatusCode::OK && body["messages"].as_array().unwrap().len() >= count {
            return body;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let (status, body) = json_response_from(
        app,
        authed_request(Method::GET, &format!("/v1/chats/{chat_id}"), Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    body
}

fn assert_text_contains_in_order(text: &str, values: &[&str]) {
    let mut offset = 0;
    for value in values {
        let Some(index) = text[offset..].find(value) else {
            panic!("expected text to contain marker in order");
        };
        offset += index + value.len();
    }
}

fn assert_chat_context_prompt_has_expected_shape(prompt: &str) {
    assert_text_contains_in_order(
        prompt,
        &[
            "IDE context",
            "Source: vscode",
            "File: src/main.ts",
            "Workspace-relative path: src/main.ts",
            "Language: typescript",
            "Range: 10:2-12:8",
            "Selection:",
            "function greet()",
            "User request",
            "Explain the selected code.",
        ],
    );
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
    assert!(!lower.contains("authorization"));
    assert!(!lower.contains("access_token"));
    assert!(!lower.contains("refresh_token"));
    assert!(!lower.contains("api_key"));
    assert!(!lower.contains("cookie"));
    assert!(!lower.contains("/users/"));
    assert!(!lower.contains("/home/"));
    assert!(!text.contains("user:pass@"));
    assert!(!text.contains("raw-provider-body"));
    assert!(!text.contains("codex-access-token-secret"));
    assert!(!text.contains("codex-refresh-token-secret"));
}

fn assert_provider_error_text_is_sanitized(text: &str, forbidden: &[&str]) {
    assert_sanitized_sse_error(text);
    for value in forbidden {
        assert!(
            !text.contains(value),
            "provider error leaked forbidden marker"
        );
    }
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

fn assert_no_codex_oauth_secret_files(paths: &StoragePaths) {
    let store = FileSecretStore::new(&paths.config_dir);
    for kind in [
        SecretKind::OAuthAccessToken,
        SecretKind::OAuthRefreshToken,
        SecretKind::AuthMetadata,
    ] {
        let path = store.secret_path("openai", kind).unwrap();
        if path.is_file() {
            let content = std::fs::read_to_string(&path).unwrap();
            assert!(!content.contains("codex-access-token-secret"));
            assert!(!content.contains("codex-refresh-token-secret"));
            assert!(!content.contains("codex-code"));
            panic!("unexpected OAuth secret file at {}", path.display());
        }
    }
}

fn test_secret_digest(value: &str) -> u64 {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn assert_stored_secret(actual: Option<&str>, expected: &str) {
    let Some(actual) = actual else {
        panic!("expected stored secret to be present");
    };
    assert_eq!(
        actual.len(),
        expected.len(),
        "stored secret length mismatch"
    );
    assert_eq!(
        test_secret_digest(actual),
        test_secret_digest(expected),
        "stored secret digest mismatch"
    );
    assert!(actual == expected, "stored secret value mismatch");
}

fn assert_json_string_value(actual: &Value, expected: &str, label: &str) {
    let Some(actual) = actual.as_str() else {
        panic!("{label}: expected string value");
    };
    assert_eq!(actual.len(), expected.len(), "{label}: length mismatch");
    assert_eq!(
        test_secret_digest(actual),
        test_secret_digest(expected),
        "{label}: digest mismatch"
    );
    assert!(actual == expected, "{label}: value mismatch");
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

fn assert_http_boundary_body_is_sanitized(text: &str) {
    assert_eq!(text, r#"{"error":"invalid request body"}"#);
    let lower = text.to_lowercase();
    for forbidden in [
        "sk-http-boundary-secret",
        "bearer ",
        "access_token",
        "refresh_token",
        "api_key",
        "apikey",
        "cookie",
        "/users/example",
        "/home/example",
        "private/path",
        "malformed-fragment",
        "raw-body-fragment",
        "secret-field",
        "token-value",
    ] {
        assert!(!lower.contains(forbidden));
    }
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
    assert_eq!(body["redacted"], "sk...cd");
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
    assert_eq!(body["configured"], false);
    assert_eq!(body["supportsLogin"], true);
    assert_eq!(body["supportsApiKey"], true);
    assert_eq!(body["cloudRequired"], false);
    assert_eq!(body["sessionId"], session_id);
    assert_eq!(body["authorizationUrl"], start_url);
    chrono::DateTime::parse_from_rfc3339(body["expiresAt"].as_str().unwrap()).unwrap();
    assert_eq!(body["pollIntervalSeconds"], 3);
    assert_eq!(
        body["scopes"],
        json!(["openid", "profile", "email", "offline_access"])
    );
    assert!(body.get("success").is_none());
    assert_provider_auth_response_has_no_codex_secrets(&body);
}

#[tokio::test]
async fn provider_auth_pending_state_corruption_fails_safely() {
    for (start_body, state_dir, forbidden) in [
        (
            json!({ "mock": true }),
            "provider-auth-mock",
            "mock-state-corrupt-secret",
        ),
        (
            json!({ "experimentalCodexLike": true }),
            "provider-auth-openai",
            "codex-state-corrupt-secret",
        ),
    ] {
        let paths = test_storage_paths();
        let app = app(AppState::with_storage_paths(
            ProductIdentity::load().unwrap(),
            AuthToken::new(TEST_TOKEN).unwrap(),
            paths.clone(),
        ));
        let (status, start) = json_response_from(
            app.clone(),
            authed_request(
                Method::POST,
                "/v1/provider-auth/openai/start",
                Body::from(start_body.to_string()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(start["status"], "pending");
        let state_path = paths.config_dir.join(state_dir).join("openai.json");
        std::fs::write(
            &state_path,
            format!(r#"{{"pending":{{"state":"{forbidden}""#),
        )
        .unwrap();

        let (status, body) = json_response_from(
            app,
            authed_request(
                Method::GET,
                "/v1/provider-auth/openai/status",
                Body::empty(),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["error"], "provider auth storage error");
        let text = body.to_string().to_lowercase();
        assert!(!text.contains(forbidden));
        assert!(!text.contains("verifier"));
        assert!(!text.contains("access_token"));
        assert!(!text.contains("refresh_token"));
        assert!(!text.contains("auth.json"));
        assert!(!text.contains(&paths.config_dir.to_string_lossy().to_lowercase()));
    }
}

#[tokio::test]
async fn provider_auth_expired_pending_status_falls_back_without_session() {
    for start_body in [
        json!({ "mock": true, "ttlSeconds": 1 }),
        json!({ "experimentalCodexLike": true, "ttlSeconds": 1 }),
    ] {
        let app = test_app();
        let (status, start) = json_response_from(
            app.clone(),
            authed_request(
                Method::POST,
                "/v1/provider-auth/openai/start",
                Body::from(start_body.to_string()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(start["status"], "pending");
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

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
        assert_eq!(body["configured"], false);
        assert!(body.get("sessionId").is_none());
        assert!(body.get("authorizationUrl").is_none());
        assert_provider_auth_response_has_no_codex_secrets(&body);
    }
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
async fn provider_auth_openai_experimental_overrides_reject_query_and_fragment_safely() {
    for request in [
        json!({ "experimentalCodexLike": true, "tokenEndpointUrl": "http://127.0.0.1:1455/oauth/token?access_token=secret-query" }),
        json!({ "experimentalCodexLike": true, "tokenEndpointUrl": "http://127.0.0.1:1455/oauth/token#refresh_token=secret-fragment" }),
        json!({ "experimentalCodexLike": true, "chatEndpointUrl": "http://127.0.0.1:1456/backend-api/codex?api_key=secret-query" }),
        json!({ "experimentalCodexLike": true, "chatEndpointUrl": "http://127.0.0.1:1456/backend-api/codex#access_token=secret-fragment" }),
    ] {
        let (status, body) = json_response(authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(request.to_string()),
        ))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid provider auth request");
        let text = body.to_string();
        assert!(!text.contains("access_token"));
        assert!(!text.contains("refresh_token"));
        assert!(!text.contains("api_key"));
        assert!(!text.contains("secret-query"));
        assert!(!text.contains("secret-fragment"));
        assert_provider_auth_response_has_no_codex_secrets(&body);
    }
}

#[tokio::test]
async fn provider_auth_start_rejects_unsafe_ttl_values_safely() {
    for request in [
        json!({ "mock": true, "ttlSeconds": 0 }),
        json!({ "mock": true, "ttlSeconds": -1 }),
        json!({ "mock": true, "ttlSeconds": 3601 }),
        json!({ "experimentalCodexLike": true, "ttlSeconds": 0 }),
        json!({ "experimentalCodexLike": true, "ttlSeconds": -1 }),
        json!({ "experimentalCodexLike": true, "ttlSeconds": 3601 }),
    ] {
        let (status, body) = json_response(authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(request.to_string()),
        ))
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "invalid provider auth request");
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
    assert_eq!(status, StatusCode::OK, "{body}");
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
    assert_json_string_value(
        &token_body["code"],
        "codex-code-success",
        "token request code",
    );
    assert_eq!(token_body["client_id"], "yet-ai-local-experimental");
    assert!(token_body["code_verifier"].as_str().unwrap().len() > 20);

    let store = FileSecretStore::new(&paths.config_dir);
    let access_secret = store
        .get_secret("openai", SecretKind::OAuthAccessToken)
        .await
        .unwrap();
    assert_stored_secret(access_secret.as_deref(), "codex-access-token-secret-abcd");
    let refresh_secret = store
        .get_secret("openai", SecretKind::OAuthRefreshToken)
        .await
        .unwrap();
    assert_stored_secret(refresh_secret.as_deref(), "codex-refresh-token-secret-wxyz");

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
async fn provider_auth_openai_experimental_token_expires_in_missing_uses_bounded_default() {
    let app = test_app();
    let (token_endpoint_url, token_body_receiver) =
        start_mock_codex_token_endpoint_response(None, Some("mock-user@example.test")).await;
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
        "code": "codex-code-default-ttl"
    });
    let before = chrono::Utc::now() + chrono::Duration::seconds(3500);
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(exchange.to_string()),
        ),
    )
    .await;
    let after = chrono::Utc::now() + chrono::Duration::seconds(3700);
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "connected");
    let expires_at = chrono::DateTime::parse_from_rfc3339(body["expiresAt"].as_str().unwrap())
        .unwrap()
        .with_timezone(&chrono::Utc);
    assert!(expires_at >= before);
    assert!(expires_at <= after);
    assert_provider_auth_response_has_no_codex_secrets(&body);
    let token_body = token_body_receiver.await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-default-ttl",
        "token request code",
    );
}

#[tokio::test]
async fn provider_auth_openai_experimental_token_expires_in_invalid_values_are_rejected() {
    for (expires_in, code) in [
        (0, "codex-code-zero-ttl-secret"),
        (-1, "codex-code-negative-ttl-secret"),
        (86401, "codex-code-huge-ttl-secret"),
    ] {
        let paths = test_storage_paths();
        let app = app(AppState::with_storage_paths(
            ProductIdentity::load().unwrap(),
            AuthToken::new(TEST_TOKEN).unwrap(),
            paths.clone(),
        ));
        let (token_endpoint_url, token_body_receiver) =
            start_mock_codex_token_endpoint_with(expires_in).await;
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
            "code": code
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
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["error"], "provider auth token exchange failed");
        assert_provider_auth_response_has_no_codex_secrets(&body);
        assert!(!body.to_string().contains(code));
        let token_body = token_body_receiver.await.unwrap();
        assert_eq!(token_body["code"], code);
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

        let (status, pending) = json_response_from(
            app,
            authed_request(
                Method::GET,
                "/v1/provider-auth/openai/status",
                Body::empty(),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(pending["status"], "pending");
        assert_provider_auth_response_has_no_codex_secrets(&pending);
    }
}

#[tokio::test]
async fn provider_auth_openai_experimental_account_label_is_sanitized() {
    let app = test_app();
    let raw_label =
        "  Bearer codex-label-secret access_token=secret\n/Users/example/.codex/auth.json  ";
    let (token_endpoint_url, _) =
        start_mock_codex_token_endpoint_response(Some(1800), Some(raw_label)).await;
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
        "code": "codex-code-label-secret"
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
    assert_eq!(body["accountLabel"], "OpenAI account");
    let text = body.to_string().to_lowercase();
    assert!(!text.contains("bearer"));
    assert!(!text.contains("access_token"));
    assert!(!text.contains("codex-label-secret"));
    assert!(!text.contains("auth.json"));
    assert!(!text.contains("/users/example"));
    assert_provider_auth_response_has_no_codex_secrets(&body);

    let (status, status_body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(status_body["accountLabel"], "OpenAI account");
    let text = status_body.to_string().to_lowercase();
    assert!(!text.contains("bearer"));
    assert!(!text.contains("access_token"));
    assert!(!text.contains("codex-label-secret"));
    assert!(!text.contains("auth.json"));
    assert!(!text.contains("/users/example"));
    assert_provider_auth_response_has_no_codex_secrets(&status_body);
}

#[tokio::test]
async fn provider_auth_openai_experimental_access_write_failure_leaves_no_oauth_secrets() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let store = FileSecretStore::new(&paths.config_dir);
    let access_path = store
        .secret_path("openai", SecretKind::OAuthAccessToken)
        .unwrap();
    std::fs::create_dir_all(&access_path).unwrap();
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
    let state = state_from_authorization_url(start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": start["sessionId"],
        "state": state,
        "code": "codex-code-access-storage-failure"
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
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider auth storage error");
    assert_provider_auth_response_has_no_codex_secrets(&body);
    let token_body = token_body_receiver.await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-access-storage-failure",
        "token request code",
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
    assert_no_codex_oauth_secret_files(&paths);
}

#[tokio::test]
async fn provider_auth_openai_experimental_refresh_write_failure_removes_access_secret() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let store = FileSecretStore::new(&paths.config_dir);
    let refresh_path = store
        .secret_path("openai", SecretKind::OAuthRefreshToken)
        .unwrap();
    std::fs::create_dir_all(&refresh_path).unwrap();
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
    let state = state_from_authorization_url(start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": start["sessionId"],
        "state": state,
        "code": "codex-code-refresh-storage-failure"
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
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider auth storage error");
    assert_provider_auth_response_has_no_codex_secrets(&body);
    let token_body = token_body_receiver.await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-refresh-storage-failure",
        "token request code",
    );
    assert_eq!(
        store
            .get_secret("openai", SecretKind::OAuthAccessToken)
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
    assert_no_codex_oauth_secret_files(&paths);
}

#[tokio::test]
async fn provider_auth_openai_experimental_secret_write_failure_rolls_back_partial_writes() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let store = FileSecretStore::new(&paths.config_dir);
    let metadata_path = store
        .secret_path("openai", SecretKind::AuthMetadata)
        .unwrap();
    std::fs::create_dir_all(&metadata_path).unwrap();
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
    let state = state_from_authorization_url(start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": start["sessionId"],
        "state": state,
        "code": "codex-code-storage-failure"
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
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider auth storage error");
    assert_provider_auth_response_has_no_codex_secrets(&body);
    let token_body = token_body_receiver.await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-storage-failure",
        "token request code",
    );
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
    assert_json_string_value(
        &first_token_body["code"],
        "codex-code-retry",
        "token request code",
    );
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
    assert_json_string_value(
        &second_token_body["code"],
        "codex-code-retry",
        "token request code",
    );

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
async fn provider_auth_openai_experimental_concurrent_exchange_is_single_flight() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (token_endpoint_url, mut token_body_receiver) = start_delayed_codex_token_endpoint().await;
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
        "code": "codex-code-concurrent-secret"
    });
    let first_request = authed_request(
        Method::POST,
        "/v1/provider-auth/openai/exchange",
        Body::from(exchange.to_string()),
    );
    let second_request = authed_request(
        Method::POST,
        "/v1/provider-auth/openai/exchange",
        Body::from(exchange.to_string()),
    );

    let (first, second) = tokio::join!(
        json_response_from(app.clone(), first_request),
        json_response_from(app.clone(), second_request)
    );
    let responses = [first, second];
    let successes: Vec<_> = responses
        .iter()
        .filter(|(status, body)| *status == StatusCode::OK && body["status"] == "connected")
        .collect();
    let failures: Vec<_> = responses
        .iter()
        .filter(|(status, _)| *status != StatusCode::OK)
        .collect();
    assert_eq!(successes.len(), 1, "{responses:?}");
    assert_eq!(failures.len(), 1, "{responses:?}");
    assert_eq!(failures[0].0, StatusCode::NOT_FOUND);
    assert_eq!(
        failures[0].1["error"],
        "provider auth session was not found"
    );
    for (_, body) in responses.iter() {
        assert_provider_auth_response_has_no_codex_secrets(body);
        assert!(!body.to_string().contains("codex-code-concurrent-secret"));
    }

    let token_body = token_body_receiver.recv().await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-concurrent-secret",
        "token request code",
    );
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());

    let (status, status_body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(status_body["status"], "connected");
    assert!(status_body.get("authorizationUrl").is_none());
    assert!(status_body.get("sessionId").is_none());
    assert_provider_auth_response_has_no_codex_secrets(&status_body);

    let store = FileSecretStore::new(&paths.config_dir);
    let access_secret = store
        .get_secret("openai", SecretKind::OAuthAccessToken)
        .await
        .unwrap();
    assert_stored_secret(access_secret.as_deref(), "codex-access-token-secret-abcd");
}

#[tokio::test]
async fn provider_auth_openai_experimental_invalid_exchange_keeps_pending_until_retry() {
    let app = test_app();
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
    let session_id = start["sessionId"].as_str().unwrap().to_string();
    let state =
        state_from_authorization_url(start["authorizationUrl"].as_str().unwrap()).to_string();

    let mismatch = json!({
        "sessionId": format!("{session_id}-wrong"),
        "state": state.clone(),
        "code": "codex-code-invalid-session"
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from(mismatch.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "provider auth session mismatch");
    assert_provider_auth_response_has_no_codex_secrets(&body);

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

    let exchange = json!({
        "sessionId": session_id,
        "state": state,
        "code": "codex-code-after-invalid-session"
    });
    let (status, connected) = json_response_from(
        app,
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

    let token_body = token_body_receiver.await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-after-invalid-session",
        "token request code",
    );
}

#[tokio::test]
async fn provider_auth_openai_experimental_token_exchange_timeout_is_bounded_and_sanitized() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (token_endpoint_url, token_body_receiver) = start_hanging_codex_token_endpoint().await;
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
        "code": "codex-code-timeout-secret"
    });

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        json_response_from(
            app.clone(),
            authed_request(
                Method::POST,
                "/v1/provider-auth/openai/exchange",
                Body::from(exchange.to_string()),
            ),
        ),
    )
    .await;
    let (status, failure) = result.expect("token exchange should be bounded");
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(failure["error"], "provider auth token exchange failed");
    assert_provider_auth_response_has_no_codex_secrets(&failure);
    assert!(!failure.to_string().contains("codex-code-timeout-secret"));

    let token_body = token_body_receiver.await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-timeout-secret",
        "token request code",
    );
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

    let (status, pending) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pending["status"], "pending");
    assert_provider_auth_response_has_no_codex_secrets(&pending);
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
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": token_endpoint_url, "ttlSeconds": 1 })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
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
    assert_eq!(body["status"], "api_key_configured");
    assert_eq!(body["authSource"], "api_key");
    assert_eq!(body["configured"], true);
    assert_eq!(body["redacted"], "sk...cd");
    assert!(body["message"]
        .as_str()
        .unwrap()
        .contains("API-key provider configuration was left unchanged"));
    let text = body.to_string().to_lowercase();
    assert!(!text.contains("verifier"));
    assert!(!text.contains("access_token"));
    assert!(!text.contains("refresh_token"));
    assert!(!text.contains("bearer"));
    assert!(!text.contains("cookie"));
    assert!(!text.contains("codex-code"));
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
async fn provider_auth_openai_experimental_disconnect_pending_then_relogin_uses_fresh_session() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (first_token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let (status, first_start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": first_token_endpoint_url })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let first_session_id = first_start["sessionId"].as_str().unwrap().to_string();

    let (status, revoked) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/disconnect",
            Body::from("{}"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(revoked["success"], true);
    assert_eq!(revoked["status"], "revoked");
    assert_eq!(revoked["configured"], false);
    assert_provider_auth_response_has_no_codex_secrets(&revoked);

    let (status, status_body) = json_response_from(
        app.clone(),
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(status_body["status"], "login_unavailable");
    assert!(status_body.get("sessionId").is_none());
    assert_provider_auth_response_has_no_codex_secrets(&status_body);

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

    let (second_token_endpoint_url, second_token_body_receiver) =
        start_mock_codex_token_endpoint().await;
    let (status, second_start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from(
                json!({ "experimentalCodexLike": true, "tokenEndpointUrl": second_token_endpoint_url })
                    .to_string(),
            ),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let second_session_id = second_start["sessionId"].as_str().unwrap().to_string();
    assert_ne!(second_session_id, first_session_id);
    let state = state_from_authorization_url(second_start["authorizationUrl"].as_str().unwrap());
    let exchange = json!({
        "sessionId": second_session_id,
        "state": state,
        "code": "codex-code-relogin"
    });
    let (status, connected) = json_response_from(
        app,
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
    let token_body = second_token_body_receiver.await.unwrap();
    assert_json_string_value(
        &token_body["code"],
        "codex-code-relogin",
        "token request code",
    );
}

#[tokio::test]
async fn provider_auth_openai_experimental_concurrent_near_expiry_refresh_is_single_flight() {
    let paths = test_storage_paths();
    let store = FileSecretStore::new(&paths.config_dir);
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "codex-refreshed-access-token-secret-abcd",
            "refresh_token": "codex-refreshed-refresh-token-secret-wxyz",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    let metadata = json!({
        "provider": "openai",
        "accountLabel": "mock-user@example.test",
        "scopes": ["openid", "profile", "email", "offline_access"],
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339(),
        "redacted": "co...ld",
        "chatBaseUrl": "http://127.0.0.1:1456/backend-api/codex",
        "chatModel": "gpt-5-codex",
        "tokenEndpointUrl": token_endpoint_url
    });
    store
        .put_secret(
            "openai",
            SecretKind::OAuthAccessToken,
            "codex-old-access-token-secret-abcd",
        )
        .await
        .unwrap();
    store
        .put_secret(
            "openai",
            SecretKind::OAuthRefreshToken,
            "codex-old-refresh-token-secret-wxyz",
        )
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();

    let first =
        yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_if_needed(&paths.config_dir);
    let second =
        yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_if_needed(&paths.config_dir);
    let (first, second) = tokio::join!(first, second);
    let first = first.unwrap().unwrap();
    let second = second.unwrap().unwrap();
    assert_stored_secret(
        Some(&first.access_token),
        "codex-refreshed-access-token-secret-abcd",
    );
    assert_stored_secret(
        Some(&second.access_token),
        "codex-refreshed-access-token-secret-abcd",
    );
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(
        &body["refresh_token"],
        "codex-old-refresh-token-secret-wxyz",
        "refresh request token",
    );
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());
    let stored_refresh = store
        .get_secret("openai", SecretKind::OAuthRefreshToken)
        .await
        .unwrap();
    assert_stored_secret(
        stored_refresh.as_deref(),
        "codex-refreshed-refresh-token-secret-wxyz",
    );
}

#[tokio::test]
async fn provider_auth_openai_experimental_changed_token_after_lock_wait_requires_fresh_metadata() {
    let paths = test_storage_paths();
    let store = FileSecretStore::new(&paths.config_dir);
    let (token_endpoint_url, mut token_body_receiver) = start_sequence_refresh_codex_token_endpoint(vec![
        (
            StatusCode::OK,
            json!({
                "access_token": "access-lock-near",
                "refresh_token": "refresh-lock-near",
                "expires_in": 30,
                "scope": "openid profile email offline_access",
                "account_label": "mock-user@example.test"
            }),
        ),
        (
            StatusCode::OK,
            json!({
                "access_token": "access-lock-fresh",
                "refresh_token": "refresh-lock-fresh",
                "expires_in": 1800,
                "scope": "openid profile email offline_access",
                "account_label": "mock-user@example.test"
            }),
        ),
    ])
    .await;
    let metadata = json!({
        "provider": "openai",
        "accountLabel": "mock-user@example.test",
        "scopes": ["openid", "profile", "email", "offline_access"],
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339(),
        "redacted": "co...ld",
        "chatBaseUrl": "http://127.0.0.1:1456/backend-api/codex",
        "chatModel": "gpt-5-codex",
        "tokenEndpointUrl": token_endpoint_url
    });
    store
        .put_secret("openai", SecretKind::OAuthAccessToken, "access-lock-old")
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::OAuthRefreshToken, "refresh-lock-old")
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();

    let first_paths = paths.config_dir.clone();
    let first = tokio::spawn(async move {
        yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_if_needed(&first_paths).await
    });
    let first_body = token_body_receiver.recv().await.unwrap();
    let second = yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_after_rejection(
        &paths.config_dir,
        "access-lock-old",
    );
    let (first, second) = tokio::join!(first, second);
    let first = first.unwrap().unwrap().unwrap();
    let second = second.unwrap().unwrap();
    assert_stored_secret(Some(&first.access_token), "access-lock-near");
    assert_stored_secret(Some(&second.access_token), "access-lock-fresh");

    assert_eq!(first_body["grant_type"], "refresh_token");
    assert_json_string_value(
        &first_body["refresh_token"],
        "refresh-lock-old",
        "first lock refresh token",
    );
    let second_body = token_body_receiver.recv().await.unwrap();
    assert_eq!(second_body["grant_type"], "refresh_token");
    assert_json_string_value(
        &second_body["refresh_token"],
        "refresh-lock-near",
        "second lock refresh token",
    );
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());
}

#[tokio::test]
async fn provider_auth_openai_experimental_refresh_commit_failure_deletes_consumed_refresh_token() {
    let paths = test_storage_paths();
    let store = FileSecretStore::new(&paths.config_dir);
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    let metadata = json!({
        "provider": "openai",
        "accountLabel": "mock-user@example.test",
        "scopes": ["openid", "profile", "email", "offline_access"],
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339(),
        "redacted": "ac...-1",
        "chatBaseUrl": "http://127.0.0.1:1456/backend-api/codex",
        "chatModel": "gpt-5-codex",
        "tokenEndpointUrl": token_endpoint_url
    });
    store
        .put_secret("openai", SecretKind::OAuthAccessToken, "access-1")
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::OAuthRefreshToken, "refresh-1")
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();
    let metadata_path = store
        .secret_path("openai", SecretKind::AuthMetadata)
        .unwrap();

    let config_dir = paths.config_dir.clone();
    let refresh = tokio::spawn(async move {
        yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_if_needed(&config_dir).await
    });
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(&body["refresh_token"], "refresh-1", "refresh request token");
    std::fs::remove_file(&metadata_path).unwrap();
    std::fs::create_dir(&metadata_path).unwrap();

    let error = refresh.await.unwrap().unwrap_err();
    assert_eq!(error.to_string(), "provider auth storage error");
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
}

#[tokio::test]
async fn provider_auth_openai_experimental_oversized_token_error_body_is_sanitized() {
    let paths = test_storage_paths();
    let store = FileSecretStore::new(&paths.config_dir);
    let oversized = format!(
        "{} refresh_token_reused access_token=secret refresh_token=secret",
        "x".repeat(64 * 1024)
    );
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::UNAUTHORIZED,
        json!({ "error": { "message": oversized, "code": "refresh_token_reused" } }),
    )
    .await;
    let metadata = json!({
        "provider": "openai",
        "accountLabel": "mock-user@example.test",
        "scopes": ["openid", "profile", "email", "offline_access"],
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339(),
        "redacted": "ac...-1",
        "chatBaseUrl": "http://127.0.0.1:1456/backend-api/codex",
        "chatModel": "gpt-5-codex",
        "tokenEndpointUrl": token_endpoint_url
    });
    store
        .put_secret("openai", SecretKind::OAuthAccessToken, "access-1")
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::OAuthRefreshToken, "refresh-1")
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();

    let error =
        yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_if_needed(&paths.config_dir)
            .await
            .unwrap_err();
    assert_eq!(error.to_string(), "provider auth token exchange failed");
    let text = error.to_string().to_lowercase();
    assert!(!text.contains("refresh_token_reused"));
    assert!(!text.contains("access_token"));
    assert!(!text.contains("refresh-1"));
    let body = token_body_receiver.recv().await.unwrap();
    assert_json_string_value(&body["refresh_token"], "refresh-1", "refresh request token");
}

#[tokio::test]
async fn provider_auth_openai_experimental_refresh_token_reused_without_newer_token_is_sanitized() {
    let paths = test_storage_paths();
    let store = FileSecretStore::new(&paths.config_dir);
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::UNAUTHORIZED,
        json!({
            "error": {
                "message": "Your refresh token has already been used codex-refresh-token-secret-wxyz access_token=secret",
                "code": "refresh_token_reused"
            }
        }),
    )
    .await;
    let metadata = json!({
        "provider": "openai",
        "accountLabel": "mock-user@example.test",
        "scopes": ["openid", "profile", "email", "offline_access"],
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(1800)).to_rfc3339(),
        "redacted": "co...cd",
        "chatBaseUrl": "http://127.0.0.1:1456/backend-api/codex",
        "chatModel": "gpt-5-codex",
        "tokenEndpointUrl": token_endpoint_url
    });
    store
        .put_secret(
            "openai",
            SecretKind::OAuthAccessToken,
            "codex-old-access-token-secret-abcd",
        )
        .await
        .unwrap();
    store
        .put_secret(
            "openai",
            SecretKind::OAuthRefreshToken,
            "codex-old-refresh-token-secret-wxyz",
        )
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();

    let error = yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_after_rejection(
        &paths.config_dir,
        "codex-old-access-token-secret-abcd",
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "provider auth token exchange failed");
    let text = error.to_string().to_lowercase();
    assert!(!text.contains("refresh_token_reused"));
    assert!(!text.contains("codex-old"));
    assert!(!text.contains("access_token"));
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(
        &body["refresh_token"],
        "codex-old-refresh-token-secret-wxyz",
        "refresh request token",
    );
}

#[tokio::test]
async fn provider_auth_openai_experimental_refresh_requires_rotated_refresh_token() {
    let paths = test_storage_paths();
    let store = FileSecretStore::new(&paths.config_dir);
    let (token_endpoint_url, _) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "codex-refreshed-access-token-secret-abcd",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    let metadata = json!({
        "provider": "openai",
        "accountLabel": "mock-user@example.test",
        "scopes": ["openid", "profile", "email", "offline_access"],
        "expiresAt": (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339(),
        "redacted": "co...cd",
        "chatBaseUrl": "http://127.0.0.1:1456/backend-api/codex",
        "chatModel": "gpt-5-codex",
        "tokenEndpointUrl": token_endpoint_url
    });
    store
        .put_secret(
            "openai",
            SecretKind::OAuthAccessToken,
            "codex-old-access-token-secret-abcd",
        )
        .await
        .unwrap();
    store
        .put_secret(
            "openai",
            SecretKind::OAuthRefreshToken,
            "codex-old-refresh-token-secret-wxyz",
        )
        .await
        .unwrap();
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();

    let error =
        yet_lsp::provider_auth::refresh_experimental_codex_chat_auth_if_needed(&paths.config_dir)
            .await
            .unwrap_err();
    assert_eq!(error.to_string(), "provider auth token exchange failed");
    let stored_access = store
        .get_secret("openai", SecretKind::OAuthAccessToken)
        .await
        .unwrap();
    assert_stored_secret(
        stored_access.as_deref(),
        "codex-old-access-token-secret-abcd",
    );
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
            Body::from(json!({ "mock": true, "ttlSeconds": 1 }).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
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
    assert_eq!(body["auth"]["redacted"], "sk...cd");
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
async fn agent_progress_returns_authenticated_empty_read_only_response() {
    let (status, body) = json_response(authed_request(
        Method::GET,
        "/v1/agent-progress",
        Body::empty(),
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["cloudRequired"], false);
    assert_eq!(body["providerAccess"], "direct");
    assert_eq!(body["snapshots"], json!([]));
    assert!(body.get("generatedAt").is_none());
    assert_eq!(body.as_object().unwrap().len(), 3);
}

#[tokio::test]
async fn agent_progress_requires_bearer_token() {
    let response = test_app()
        .oneshot(
            Request::get("/v1/agent-progress")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn agent_progress_shape_is_local_only_and_sanitized() {
    let (status, body) = json_response(authed_request(
        Method::GET,
        "/v1/agent-progress",
        Body::empty(),
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "cloudRequired": false,
            "providerAccess": "direct",
            "snapshots": []
        })
    );
    let text = body.to_string().to_lowercase();
    for forbidden in [
        TEST_TOKEN,
        "api_key",
        "apikey",
        "authorization",
        "bearer",
        "token",
        "secret",
        "password",
        "cookie",
        "credential",
        "chain-of-thought",
        "raw_prompt",
        "provider_response",
        "file_content",
        "/users/",
        "/home/",
        "/private/",
        "cloudrequired:true",
    ] {
        assert!(!text.contains(forbidden));
    }
}

#[tokio::test]
async fn http_boundary_malformed_provider_create_body_is_sanitized() {
    let raw = r#"{"id":"http-boundary-provider","auth":{"apiKey":"sk-http-boundary-secret-abcd"},"malformed-fragment":"raw-body-fragment""#;
    let (status, text) = text_response_from(
        test_app(),
        authed_request(Method::POST, "/v1/providers", Body::from(raw)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_http_boundary_body_is_sanitized(&text);
}

#[tokio::test]
async fn http_boundary_malformed_provider_auth_bodies_are_sanitized() {
    for uri in [
        "/v1/provider-auth/openai/start",
        "/v1/provider-auth/openai/exchange",
    ] {
        let raw = r#"{"mock":true,"code":"sk-http-boundary-secret-auth","malformed-fragment":"raw-body-fragment""#;
        let (status, text) = text_response_from(
            test_app(),
            authed_request(Method::POST, uri, Body::from(raw)),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_http_boundary_body_is_sanitized(&text);
    }
}

#[tokio::test]
async fn http_boundary_type_invalid_provider_auth_bodies_are_sanitized() {
    for (uri, body) in [
        (
            "/v1/provider-auth/openai/start",
            json!({
                "mock": "sk-http-boundary-secret-start",
                "tokenEndpointUrl": "/Users/example/private/path?access_token=secret"
            }),
        ),
        (
            "/v1/provider-auth/openai/exchange",
            json!({
                "sessionId": { "secretField": "sk-http-boundary-secret-session" },
                "code": "Bearer token-value"
            }),
        ),
    ] {
        let (status, text) = text_response_from(
            test_app(),
            authed_request(Method::POST, uri, Body::from(body.to_string())),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_http_boundary_body_is_sanitized(&text);
    }
}

#[tokio::test]
async fn http_boundary_malformed_and_type_invalid_chat_command_bodies_are_sanitized() {
    for raw in [
        r#"{"requestId":"req-http-boundary","type":"user_message","payload":{"content":"sk-http-boundary-secret-chat"},"malformed-fragment":"raw-body-fragment""#.to_string(),
        json!({
            "requestId": { "secretField": "sk-http-boundary-secret-chat" },
            "type": "user_message",
            "payload": { "content": "Bearer token-value" }
        })
        .to_string(),
    ] {
        let (status, text) = text_response_from(
            test_app(),
            authed_request(
                Method::POST,
                "/v1/chats/chat-http-boundary/commands",
                Body::from(raw),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_http_boundary_body_is_sanitized(&text);
    }
}

#[tokio::test]
async fn http_boundary_oversized_body_is_rejected_and_sanitized() {
    let raw = format!(
        "{{\"id\":\"http-boundary-oversized\",\"displayName\":\"{}sk-http-boundary-secret-oversized access_token=secret Cookie: token-value /Users/example\"}}",
        "x".repeat(256 * 1024)
    );
    let (status, text) = text_response_from(
        test_app(),
        authed_request(Method::POST, "/v1/providers", Body::from(raw)),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_http_boundary_body_is_sanitized(&text);
}

#[tokio::test]
async fn http_boundary_valid_json_routes_keep_existing_behavior() {
    let app = test_app();
    let provider = json!({
        "id": "http-boundary-valid-provider",
        "kind": "custom",
        "displayName": "HTTP Boundary Valid Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9900",
        "auth": { "type": "api_key", "apiKey": "sk-http-boundary-secret-valid" }
    });
    let (status, created) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/providers",
            Body::from(provider.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["id"], "http-boundary-valid-provider");
    assert!(!created
        .to_string()
        .contains("sk-http-boundary-secret-valid"));

    let update = json!({ "displayName": "HTTP Boundary Updated Provider" });
    let (status, updated) = json_response_from(
        app.clone(),
        authed_request(
            Method::PATCH,
            "/v1/providers/http-boundary-valid-provider",
            Body::from(update.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["displayName"], "HTTP Boundary Updated Provider");

    let (status, auth_start) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/start",
            Body::from("{}"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(auth_start["status"], "login_unavailable");

    let (status, auth_exchange) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/provider-auth/openai/exchange",
            Body::from("{}"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(auth_exchange["status"], "login_unavailable");

    let command = json!({
        "requestId": "req-http-boundary-valid",
        "type": "abort",
        "payload": {}
    });
    let (status, accepted) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/chats/chat-http-boundary-valid/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(accepted["accepted"], true);
    assert_eq!(accepted["type"], "abort");
}

#[tokio::test]
async fn http_boundary_invalid_chat_id_get_delete_and_command_are_sanitized() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let mut invalid_ids = vec!["bad:id".to_string(), ".bad".to_string(), "-bad".to_string()];
    invalid_ids.push("a123456789".repeat(13));

    for id in invalid_ids {
        for method in [Method::GET, Method::DELETE] {
            let (status, text) = text_response_from(
                app.clone(),
                authed_request(method, &format!("/v1/chats/{id}"), Body::empty()),
            )
            .await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert_eq!(text, r#"{"error":"invalid chat id"}"#);
            assert!(!text.contains(&id));
        }
    }

    let command = json!({
        "requestId": "req-http-boundary-invalid-chat-id",
        "type": "user_message",
        "payload": { "content": "hello sk-http-boundary-invalid-chat-secret" }
    });
    let (status, text) = text_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/chats/bad:id/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(text, r#"{"error":"invalid chat id"}"#);
    assert!(!text.contains("bad:id"));
    assert!(!text.contains("sk-http-boundary-invalid-chat-secret"));
    assert!(!paths.config_dir.join("chat-history").exists());
}

#[tokio::test]
async fn http_boundary_invalid_subscribe_query_is_non_sse_400() {
    let app = test_app();
    let mut uris = vec![
        "/v1/chats/subscribe".to_string(),
        "/v1/chats/subscribe?chat_id=".to_string(),
        "/v1/chats/subscribe?chat_id=bad:id".to_string(),
        "/v1/chats/subscribe?chat_id=.bad".to_string(),
        "/v1/chats/subscribe?chat_id=bad%2Fid".to_string(),
    ];
    uris.push(format!("/v1/chats/subscribe?chat_id={}", "a".repeat(129)));

    for uri in uris {
        let response = app
            .clone()
            .oneshot(authed_request(Method::GET, &uri, Body::empty()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_ne!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(text, r#"{"error":"invalid chat id"}"#);
        assert!(!text.contains("bad:id"));
        assert!(!text.contains("bad/id"));
    }
}

#[tokio::test]
async fn http_boundary_valid_subscribe_still_emits_snapshot_event() {
    let response = test_app()
        .oneshot(authed_request(
            Method::GET,
            "/v1/chats/subscribe?chat_id=chat-http-boundary-subscribe",
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
    assert!(text.contains("\"chatId\":\"chat-http-boundary-subscribe\""));
}

#[tokio::test]
async fn provider_model_metadata_defaults_are_exposed_on_models_providers_and_caps() {
    let app = test_app();
    let api_key = "sk-model-metadata-secret-abcd";
    let ready_provider = json!({
        "id": "aaa-ready-models",
        "kind": "openai-compatible",
        "displayName": "Ready Models",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:8080/v1",
        "auth": { "type": "api_key", "apiKey": api_key },
        "models": [{ "id": "gpt-ready", "displayName": "GPT Ready" }]
    });
    let missing_provider = json!({
        "id": "bbb-missing-auth-models",
        "kind": "openai-compatible",
        "displayName": "Missing Auth Models",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:8081/v1",
        "auth": { "type": "api_key" },
        "models": [{ "id": "gpt-missing-auth", "displayName": "GPT Missing Auth" }]
    });
    let disabled_provider = json!({
        "id": "ccc-disabled-models",
        "kind": "openai-compatible",
        "displayName": "Disabled Models",
        "enabled": false,
        "baseUrl": "http://127.0.0.1:8082/v1",
        "auth": { "type": "none" },
        "models": [{ "id": "gpt-disabled", "displayName": "GPT Disabled" }]
    });
    let unsupported_provider = json!({
        "id": "ddd-unsupported-models",
        "kind": "custom",
        "displayName": "Unsupported Models",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:8083/v1",
        "auth": { "type": "none" },
        "models": [{ "id": "custom-model", "displayName": "Custom Model" }]
    });

    for provider in [
        ready_provider,
        missing_provider,
        disabled_provider,
        unsupported_provider,
    ] {
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
        assert!(!body.to_string().contains(api_key));
    }

    let (status, models) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/models", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(models["models"].as_array().unwrap().len(), 4);
    let ready = &models["models"][0];
    assert_eq!(ready["providerId"], "aaa-ready-models");
    assert_eq!(
        ready["capabilities"],
        json!({
            "chat": true,
            "streaming": true,
            "tools": false,
            "reasoning": false
        })
    );
    assert_eq!(ready["readiness"], json!({ "status": "ready" }));
    assert_eq!(
        models["models"][1]["readiness"]["status"],
        "missing_credentials"
    );
    assert_eq!(models["models"][2]["readiness"]["status"], "disabled");
    assert_eq!(models["models"][3]["readiness"]["status"], "unsupported");
    let text = models.to_string().to_lowercase();
    assert!(!text.contains(api_key));
    assert!(!text.contains("api_key"));
    assert!(!text.contains("secret"));
    assert!(!text.contains("token"));

    let (status, providers) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/providers", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        providers["providers"][0]["models"][0]["id"],
        models["models"][0]["id"]
    );
    assert_eq!(
        providers["providers"][0]["models"][0]["capabilities"],
        models["models"][0]["capabilities"]
    );
    assert_eq!(
        providers["providers"][0]["models"][0]["readiness"],
        models["models"][0]["readiness"]
    );
    assert!(providers["providers"][0]["models"][0]
        .get("providerId")
        .is_none());
    assert_eq!(
        providers["providers"][1]["models"][0]["readiness"]["status"],
        "missing_credentials"
    );
    assert!(!providers.to_string().contains(api_key));

    let (status, provider) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/providers/aaa-ready-models", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        provider["models"][0]["readiness"],
        json!({ "status": "ready" })
    );
    assert!(!provider.to_string().contains(api_key));

    let (status, caps) =
        json_response_from(app, authed_request(Method::GET, "/v1/caps", Body::empty())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        caps["features"],
        json!({
            "tools": false,
            "tasks": false,
            "knowledge": false
        })
    );
    assert_eq!(
        caps["providers"][0]["models"][0]["readiness"],
        json!({ "status": "ready" })
    );
    assert_eq!(
        caps["providers"][0]["models"][0]["capabilities"],
        ready["capabilities"]
    );
    assert!(!caps.to_string().contains(api_key));
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
    assert!(text.contains("sk...cd"));
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
    assert_eq!(body["auth"]["redacted"], "sk...cd");
    assert!(!body.to_string().contains(old_key));
    assert!(!body.to_string().contains(new_key));

    let secret = FileSecretStore::new(&paths.config_dir)
        .get_secret("duplicate-secret-provider", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(secret.as_deref(), old_key);
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
async fn provider_secret_metadata_only_update_does_not_touch_api_key_secret_storage() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-metadata-update-secret-abcd";
    let provider = json!({
        "id": "metadata-only-provider",
        "kind": "openai-compatible",
        "displayName": "Metadata Only Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9700/v1",
        "auth": { "type": "api_key", "apiKey": api_key },
        "models": [{ "id": "gpt-before", "displayName": "GPT Before" }],
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

    let store = FileSecretStore::new(&paths.config_dir);
    let secret_path = store
        .secret_path("metadata-only-provider", SecretKind::ApiKey)
        .unwrap();
    let before_metadata = std::fs::metadata(&secret_path).unwrap().modified().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    let update = json!({
        "displayName": "Metadata Updated Provider",
        "enabled": false,
        "baseUrl": "http://127.0.0.1:9701/v1",
        "models": [{ "id": "gpt-after", "displayName": "GPT After" }],
        "capabilities": { "chat": false, "completion": false, "embeddings": false }
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::PATCH,
            "/v1/providers/metadata-only-provider",
            Body::from(update.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["displayName"], "Metadata Updated Provider");
    assert_eq!(body["enabled"], false);
    assert_eq!(body["auth"]["type"], "api_key");
    assert_eq!(body["auth"]["configured"], false);
    assert!(!body.to_string().contains(api_key));

    let after_metadata = std::fs::metadata(&secret_path).unwrap().modified().unwrap();
    assert_eq!(after_metadata, before_metadata);
    let secret = store
        .get_secret("metadata-only-provider", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(secret.as_deref(), api_key);
}

#[tokio::test]
async fn provider_secret_create_secret_commit_failure_leaves_no_provider_config() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-create-secret-failure-abcd";
    let store = FileSecretStore::new(&paths.config_dir);
    let secret_path = store
        .secret_path("create-secret-failure", SecretKind::ApiKey)
        .unwrap();
    std::fs::create_dir_all(&secret_path).unwrap();

    let provider = json!({
        "id": "create-secret-failure",
        "kind": "custom",
        "displayName": "Create Secret Failure",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9800",
        "auth": { "type": "api_key", "apiKey": api_key }
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
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider secret storage error");
    assert!(!body.to_string().contains(api_key));
    assert!(!paths
        .config_dir
        .join("providers.d/create-secret-failure.json")
        .exists());
}

#[tokio::test]
async fn provider_secret_create_config_failure_rolls_back_committed_secret() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-create-config-failure-abcd";
    std::fs::create_dir_all(&paths.config_dir).unwrap();
    std::fs::write(paths.config_dir.join("providers.d"), "not a directory").unwrap();

    let provider = json!({
        "id": "create-config-failure",
        "kind": "custom",
        "displayName": "Create Config Failure",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9801",
        "auth": { "type": "api_key", "apiKey": api_key }
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
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider storage error");
    assert!(!body.to_string().contains(api_key));
    let secret = FileSecretStore::new(&paths.config_dir)
        .get_secret("create-config-failure", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_eq!(secret, None);
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
async fn provider_secret_update_put_failure_keeps_previous_config_sanitized() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-update-put-failure-secret-abcd";
    let provider = json!({
        "id": "update-put-failure-provider",
        "kind": "custom",
        "displayName": "Update Put Failure Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9400",
        "auth": { "type": "none" }
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
        .secret_path("update-put-failure-provider", SecretKind::ApiKey)
        .unwrap();
    std::fs::create_dir_all(secret_path.parent().unwrap()).unwrap();
    std::fs::create_dir(&secret_path).unwrap();

    let update = json!({
        "displayName": "Mutated Put Failure Provider",
        "auth": { "type": "api_key", "apiKey": api_key }
    });
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::PATCH,
            "/v1/providers/update-put-failure-provider",
            Body::from(update.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider secret storage error");
    let text = body.to_string().to_lowercase();
    assert!(!text.contains(api_key));
    assert!(!text.contains("update-put-failure-secret"));
    assert!(!text.contains(&paths.config_dir.to_string_lossy().to_lowercase()));

    let config_text = read_provider_config_text(&paths, "update-put-failure-provider");
    assert!(config_text.contains("Update Put Failure Provider"));
    assert!(!config_text.contains("Mutated Put Failure Provider"));
    assert!(config_text.contains(r#""type": "none""#));
    assert!(!config_text.contains(api_key));
    std::fs::remove_dir(&secret_path).unwrap();
    let (status, stored) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/update-put-failure-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stored["displayName"], "Update Put Failure Provider");
    assert_eq!(stored["auth"]["type"], "none");
    assert_eq!(stored["auth"]["configured"], false);
    assert!(!stored.to_string().contains(api_key));
}

#[cfg(unix)]
#[tokio::test]
async fn provider_secret_update_delete_failure_keeps_previous_config_sanitized() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-update-delete-failure-secret-abcd";
    let provider = json!({
        "id": "update-delete-failure-provider",
        "kind": "custom",
        "displayName": "Update Delete Failure Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9401",
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
    let store = FileSecretStore::new(&paths.config_dir);
    let secret_path = store
        .secret_path("update-delete-failure-provider", SecretKind::ApiKey)
        .unwrap();
    std::fs::remove_file(&secret_path).unwrap();
    let outside = paths.config_dir.join("update-delete-failure-outside.json");
    std::fs::write(&outside, "{}").unwrap();
    std::os::unix::fs::symlink(&outside, &secret_path).unwrap();

    let update = json!({
        "displayName": "Mutated Delete Failure Provider",
        "auth": { "type": "none" }
    });
    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::PATCH,
            "/v1/providers/update-delete-failure-provider",
            Body::from(update.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider secret storage error");
    let text = body.to_string().to_lowercase();
    assert!(!text.contains(api_key));
    assert!(!text.contains("update-delete-failure-secret"));
    assert!(!text.contains(&paths.config_dir.to_string_lossy().to_lowercase()));
    let config_text = read_provider_config_text(&paths, "update-delete-failure-provider");
    assert!(config_text.contains("Update Delete Failure Provider"));
    assert!(!config_text.contains("Mutated Delete Failure Provider"));
    assert!(config_text.contains(r#""type": "api_key""#));
    assert!(!config_text.contains(api_key));
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
    assert!(text.contains("sk...yz"));
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

#[cfg(unix)]
#[tokio::test]
async fn provider_secret_delete_cleanup_failure_is_retryable() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-delete-retry-secret-abcd";
    let provider = json!({
        "id": "delete-retry-provider",
        "kind": "custom",
        "displayName": "Delete Retry Provider",
        "enabled": true,
        "baseUrl": "http://127.0.0.1:9500",
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
    let store = FileSecretStore::new(&paths.config_dir);
    let secret_path = store
        .secret_path("delete-retry-provider", SecretKind::ApiKey)
        .unwrap();
    std::fs::remove_file(&secret_path).unwrap();
    let outside = paths.config_dir.join("delete-retry-outside.json");
    std::fs::write(&outside, "{}").unwrap();
    std::os::unix::fs::symlink(&outside, &secret_path).unwrap();

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::DELETE,
            "/v1/providers/delete-retry-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider secret storage error");
    let text = body.to_string().to_lowercase();
    assert!(!text.contains(api_key));
    assert!(!text.contains("delete-retry-secret"));
    assert!(!text.contains(&paths.config_dir.to_string_lossy().to_lowercase()));
    assert!(paths
        .config_dir
        .join("providers.d/delete-retry-provider.json")
        .exists());

    std::fs::remove_file(&secret_path).unwrap();
    store
        .put_secret("delete-retry-provider", SecretKind::ApiKey, api_key)
        .await
        .unwrap();
    let status = empty_response_from(
        app.clone(),
        authed_request(
            Method::DELETE,
            "/v1/providers/delete-retry-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        store
            .get_secret("delete-retry-provider", SecretKind::ApiKey)
            .await
            .unwrap(),
        None
    );
    let (status, _) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/delete-retry-provider",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn provider_secret_delete_missing_config_cleans_valid_orphan_secret() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-delete-missing-config-secret-abcd";
    let store = FileSecretStore::new(&paths.config_dir);
    store
        .put_secret("delete-missing-config", SecretKind::ApiKey, api_key)
        .await
        .unwrap();

    let status = empty_response_from(
        app,
        authed_request(
            Method::DELETE,
            "/v1/providers/delete-missing-config",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        store
            .get_secret("delete-missing-config", SecretKind::ApiKey)
            .await
            .unwrap(),
        None
    );
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
    assert_stored_secret(secret.as_deref(), api_key);
}

fn write_legacy_provider_config(paths: &StoragePaths, id: &str, auth: Value) {
    write_legacy_provider_config_with_base_url(
        paths,
        id,
        "http://127.0.0.1:8080/v1".to_string(),
        auth,
    );
}

fn write_legacy_provider_config_with_base_url(
    paths: &StoragePaths,
    id: &str,
    base_url: String,
    auth: Value,
) {
    let providers_dir = paths.config_dir.join("providers.d");
    std::fs::create_dir_all(&providers_dir).unwrap();
    let provider = json!({
        "id": id,
        "kind": "openai-compatible",
        "displayName": id,
        "enabled": true,
        "baseUrl": base_url,
        "auth": auth,
        "models": [{ "id": "gpt-test", "displayName": "GPT Test" }],
        "capabilities": { "chat": true, "completion": false, "embeddings": false }
    });
    std::fs::write(
        providers_dir.join(format!("{id}.json")),
        serde_json::to_string_pretty(&provider).unwrap(),
    )
    .unwrap();
}

fn read_provider_config_text(paths: &StoragePaths, id: &str) -> String {
    std::fs::read_to_string(
        paths
            .config_dir
            .join("providers.d")
            .join(format!("{id}.json")),
    )
    .unwrap()
}

#[tokio::test]
async fn provider_secret_legacy_inline_key_migrates_to_secret_store() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-migration-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-migrate",
        json!({ "type": "api_key", "apiKey": api_key }),
    );

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-migrate",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["configured"], true);
    assert_eq!(body["auth"]["redacted"], "sk...cd");
    assert!(!body.to_string().contains(api_key));
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-migrate", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), api_key);
    assert!(!read_provider_config_text(&paths, "provider-secret-migrate").contains(api_key));
}

#[tokio::test]
async fn provider_secret_store_value_wins_over_legacy_inline_key() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let stored_key = "sk-provider-store-wins-secret-abcd";
    let inline_key = "sk-provider-inline-loses-secret-wxyz";
    write_legacy_provider_config(
        &paths,
        "provider-secret-store-wins",
        json!({ "type": "api_key", "apiKey": inline_key }),
    );
    FileSecretStore::new(&paths.config_dir)
        .put_secret("provider-secret-store-wins", SecretKind::ApiKey, stored_key)
        .await
        .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-store-wins",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["redacted"], "sk...cd");
    let text = body.to_string();
    assert!(!text.contains(stored_key));
    assert!(!text.contains(inline_key));
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-store-wins", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), stored_key);
    assert!(!read_provider_config_text(&paths, "provider-secret-store-wins").contains(inline_key));
}

#[tokio::test]
async fn provider_secret_write_failure_keeps_legacy_inline_key() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-write-failure-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-write-failure",
        json!({ "type": "api_key", "apiKey": api_key }),
    );
    let secret_path = FileSecretStore::new(&paths.config_dir)
        .secret_path("provider-secret-write-failure", SecretKind::ApiKey)
        .unwrap();
    std::fs::create_dir_all(&secret_path).unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-write-failure",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider secret storage error");
    assert!(!body.to_string().contains(api_key));
    assert!(read_provider_config_text(&paths, "provider-secret-write-failure").contains(api_key));
}

#[tokio::test]
async fn provider_secret_non_api_key_stale_inline_field_is_scrubbed() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-none-stale-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-none-stale",
        json!({ "type": "none", "apiKey": api_key }),
    );

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-none-stale",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["type"], "none");
    assert_eq!(body["auth"]["configured"], false);
    assert!(body["auth"].get("redacted").is_none());
    assert!(!body.to_string().contains(api_key));
    assert!(!read_provider_config_text(&paths, "provider-secret-none-stale").contains(api_key));
    assert_eq!(
        FileSecretStore::new(&paths.config_dir)
            .get_secret("provider-secret-none-stale", SecretKind::ApiKey)
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn provider_secret_list_first_access_migrates_inline_key() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-list-migration-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-list-migrate",
        json!({ "type": "api_key", "apiKey": api_key }),
    );

    let (status, body) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/providers", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["providers"][0]["auth"]["configured"], true);
    assert_eq!(body["providers"][0]["auth"]["redacted"], "sk...cd");
    assert!(!body.to_string().contains(api_key));
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-list-migrate", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), api_key);
    assert!(!read_provider_config_text(&paths, "provider-secret-list-migrate").contains(api_key));
}

#[tokio::test]
async fn provider_secret_models_first_access_migrates_inline_key() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-models-migration-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-models-migrate",
        json!({ "type": "api_key", "apiKey": api_key }),
    );

    let (status, body) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/models", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["models"][0]["readiness"], json!({ "status": "ready" }));
    assert!(!body.to_string().contains(api_key));
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-models-migrate", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), api_key);
    assert!(!read_provider_config_text(&paths, "provider-secret-models-migrate").contains(api_key));
}

#[tokio::test]
async fn provider_secret_caps_first_access_migrates_inline_key() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-caps-migration-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-caps-migrate",
        json!({ "type": "api_key", "apiKey": api_key }),
    );

    let (status, body) =
        json_response_from(app, authed_request(Method::GET, "/v1/caps", Body::empty())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["providers"][0]["models"][0]["readiness"],
        json!({ "status": "ready" })
    );
    assert!(!body.to_string().contains(api_key));
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-caps-migrate", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), api_key);
    assert!(!read_provider_config_text(&paths, "provider-secret-caps-migrate").contains(api_key));
}

#[tokio::test]
async fn provider_secret_atomic_migration_does_not_overwrite_newer_secret() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let stale_key = "sk-provider-race-stale-secret-abcd";
    let newer_key = "sk-provider-race-newer-secret-wxyz";
    write_legacy_provider_config(
        &paths,
        "provider-secret-atomic-race",
        json!({ "type": "api_key", "apiKey": stale_key }),
    );
    let store = FileSecretStore::new(&paths.config_dir);
    assert!(store
        .put_secret_if_absent("provider-secret-atomic-race", SecretKind::ApiKey, newer_key,)
        .await
        .unwrap());
    assert!(!store
        .put_secret_if_absent("provider-secret-atomic-race", SecretKind::ApiKey, stale_key,)
        .await
        .unwrap());

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-atomic-race",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["configured"], true);
    let text = body.to_string();
    assert!(!text.contains(stale_key));
    assert!(!text.contains(newer_key));
    let stored = store
        .get_secret("provider-secret-atomic-race", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), newer_key);
    assert!(!read_provider_config_text(&paths, "provider-secret-atomic-race").contains(stale_key));
}

#[tokio::test]
async fn provider_secret_test_first_access_uses_stored_key_over_inline_key() {
    let paths = test_storage_paths();
    let (base_url, auth_receiver) =
        start_mock_models_provider(StatusCode::OK, r#"{\"data\":[{\"id\":\"gpt-test\"}]}"#).await;
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let stored_key = "sk-provider-test-stored-secret-abcd";
    let inline_key = "sk-provider-test-inline-secret-wxyz";
    write_legacy_provider_config_with_base_url(
        &paths,
        "provider-secret-test-migrate",
        base_url,
        json!({ "type": "api_key", "apiKey": inline_key }),
    );
    FileSecretStore::new(&paths.config_dir)
        .put_secret(
            "provider-secret-test-migrate",
            SecretKind::ApiKey,
            stored_key,
        )
        .await
        .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/provider-secret-test-migrate/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["status"], "reachable");
    let text = body.to_string();
    assert!(!text.contains(stored_key));
    assert!(!text.contains(inline_key));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-provider-test-stored-secret-abcd",
        "provider secret test stored wins",
    )
    .await;
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-test-migrate", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), stored_key);
    assert!(
        !read_provider_config_text(&paths, "provider-secret-test-migrate").contains(inline_key)
    );
}

#[tokio::test]
async fn provider_secret_chat_first_access_uses_stored_key_over_inline_key() {
    let paths = test_storage_paths();
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"stored-chat\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let stored_key = "sk-provider-chat-stored-secret-abcd";
    let inline_key = "sk-provider-chat-inline-secret-wxyz";
    write_legacy_provider_config_with_base_url(
        &paths,
        "provider-secret-chat-migrate",
        base_url,
        json!({ "type": "api_key", "apiKey": inline_key }),
    );
    FileSecretStore::new(&paths.config_dir)
        .put_secret(
            "provider-secret-chat-migrate",
            SecretKind::ApiKey,
            stored_key,
        )
        .await
        .unwrap();

    send_user_message(app.clone(), "chat-provider-secret-migration").await;
    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-provider-secret-migration",
    )
    .await;
    assert!(text.contains("stored-chat"));
    assert!(!text.contains(stored_key));
    assert!(!text.contains(inline_key));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-provider-chat-stored-secret-abcd",
        "provider secret chat stored wins",
    )
    .await;
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-chat-migrate", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), stored_key);
    assert!(
        !read_provider_config_text(&paths, "provider-secret-chat-migrate").contains(inline_key)
    );
}

#[tokio::test]
async fn provider_secret_corrupt_store_with_inline_key_fails_safely() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-corrupt-migration-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-corrupt-migrate",
        json!({ "type": "api_key", "apiKey": api_key }),
    );
    let secret_path = FileSecretStore::new(&paths.config_dir)
        .secret_path("provider-secret-corrupt-migrate", SecretKind::ApiKey)
        .unwrap();
    std::fs::create_dir_all(secret_path.parent().unwrap()).unwrap();
    std::fs::write(
        &secret_path,
        r#"{"value":"sk-provider-corrupt-migration-secret-abcd""#,
    )
    .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-corrupt-migrate",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider secret storage error");
    assert!(!body.to_string().contains(api_key));
    assert!(read_provider_config_text(&paths, "provider-secret-corrupt-migrate").contains(api_key));
}

#[tokio::test]
async fn provider_secret_corrupt_store_provider_test_does_not_fallback_to_inline() {
    let paths = test_storage_paths();
    let (base_url, auth_receiver) =
        start_mock_models_provider(StatusCode::OK, r#"{\"data\":[{\"id\":\"gpt-test\"}]}"#).await;
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-corrupt-test-secret-abcd";
    write_legacy_provider_config_with_base_url(
        &paths,
        "provider-secret-corrupt-test",
        base_url,
        json!({ "type": "api_key", "apiKey": api_key }),
    );
    let secret_path = FileSecretStore::new(&paths.config_dir)
        .secret_path("provider-secret-corrupt-test", SecretKind::ApiKey)
        .unwrap();
    std::fs::create_dir_all(secret_path.parent().unwrap()).unwrap();
    std::fs::write(
        &secret_path,
        r#"{"value":"sk-provider-corrupt-test-secret-abcd""#,
    )
    .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::POST,
            "/v1/providers/provider-secret-corrupt-test/test",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider secret storage error");
    assert!(!body.to_string().contains(api_key));
    assert_no_observed_auth(auth_receiver).await;
}

#[tokio::test]
async fn provider_secret_corrupt_store_chat_does_not_fallback_to_inline() {
    let paths = test_storage_paths();
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unsafe\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-corrupt-chat-secret-abcd";
    write_legacy_provider_config_with_base_url(
        &paths,
        "provider-secret-corrupt-chat",
        base_url,
        json!({ "type": "api_key", "apiKey": api_key }),
    );
    let secret_path = FileSecretStore::new(&paths.config_dir)
        .secret_path("provider-secret-corrupt-chat", SecretKind::ApiKey)
        .unwrap();
    std::fs::create_dir_all(secret_path.parent().unwrap()).unwrap();
    std::fs::write(
        &secret_path,
        r#"{"value":"sk-provider-corrupt-chat-secret-abcd""#,
    )
    .unwrap();

    send_user_message(app.clone(), "chat-provider-secret-corrupt").await;
    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-provider-secret-corrupt",
    )
    .await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_config_error");
    assert_sanitized_sse_error(&text);
    assert!(!text.contains(api_key));
    assert_no_observed_auth(auth_receiver).await;
}

#[tokio::test]
async fn provider_secret_partial_migration_retry_scrubs_without_overwrite() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let stored_key = "sk-provider-partial-newer-secret-abcd";
    let inline_key = "sk-provider-partial-stale-secret-wxyz";
    write_legacy_provider_config(
        &paths,
        "provider-secret-partial-retry",
        json!({ "type": "api_key", "apiKey": inline_key }),
    );
    FileSecretStore::new(&paths.config_dir)
        .put_secret(
            "provider-secret-partial-retry",
            SecretKind::ApiKey,
            stored_key,
        )
        .await
        .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-partial-retry",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["configured"], true);
    let text = body.to_string();
    assert!(!text.contains(stored_key));
    assert!(!text.contains(inline_key));
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-partial-retry", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), stored_key);
    assert!(
        !read_provider_config_text(&paths, "provider-secret-partial-retry").contains(inline_key)
    );
}

#[cfg(unix)]
#[tokio::test]
async fn provider_secret_rewrite_failure_after_secret_write_keeps_retry_state() {
    use std::os::unix::fs::PermissionsExt;

    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-rewrite-failure-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-rewrite-failure",
        json!({ "type": "api_key", "apiKey": api_key }),
    );
    let providers_dir = paths.config_dir.join("providers.d");
    std::fs::set_permissions(&providers_dir, std::fs::Permissions::from_mode(0o500)).unwrap();

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-rewrite-failure",
            Body::empty(),
        ),
    )
    .await;
    std::fs::set_permissions(&providers_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "provider storage error");
    assert!(!body.to_string().contains(api_key));
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-rewrite-failure", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), api_key);
    assert!(read_provider_config_text(&paths, "provider-secret-rewrite-failure").contains(api_key));

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-rewrite-failure",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["configured"], true);
    assert!(!body.to_string().contains(api_key));
    assert!(
        !read_provider_config_text(&paths, "provider-secret-rewrite-failure").contains(api_key)
    );
}

#[tokio::test]
async fn provider_secret_whitespace_inline_key_is_scrubbed_without_secret() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    write_legacy_provider_config(
        &paths,
        "provider-secret-whitespace",
        json!({ "type": "api_key", "apiKey": "   \n\t  " }),
    );

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-whitespace",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["type"], "api_key");
    assert_eq!(body["auth"]["configured"], false);
    assert!(body["auth"].get("redacted").is_none());
    assert!(!read_provider_config_text(&paths, "provider-secret-whitespace").contains("apiKey"));
    assert_eq!(
        FileSecretStore::new(&paths.config_dir)
            .get_secret("provider-secret-whitespace", SecretKind::ApiKey)
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn provider_secret_existing_store_and_whitespace_inline_key_uses_store_and_scrubs() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let stored_key = "sk-provider-whitespace-stored-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-whitespace-store",
        json!({ "type": "api_key", "apiKey": "   \n\t  " }),
    );
    FileSecretStore::new(&paths.config_dir)
        .put_secret(
            "provider-secret-whitespace-store",
            SecretKind::ApiKey,
            stored_key,
        )
        .await
        .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-whitespace-store",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"]["configured"], true);
    assert_eq!(body["auth"]["redacted"], "sk...cd");
    assert!(!body.to_string().contains(stored_key));
    assert!(
        !read_provider_config_text(&paths, "provider-secret-whitespace-store").contains("apiKey")
    );
    let stored = FileSecretStore::new(&paths.config_dir)
        .get_secret("provider-secret-whitespace-store", SecretKind::ApiKey)
        .await
        .unwrap();
    assert_stored_secret(stored.as_deref(), stored_key);
}

#[tokio::test]
async fn provider_secret_scrub_rereads_current_metadata() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-provider-reread-secret-abcd";
    write_legacy_provider_config(
        &paths,
        "provider-secret-reread",
        json!({ "type": "api_key", "apiKey": api_key }),
    );
    let config_path = paths
        .config_dir
        .join("providers.d/provider-secret-reread.json");
    let mut provider: Value =
        serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
    provider["displayName"] = json!("Updated Provider Name");
    provider["enabled"] = json!(false);
    provider["models"] = json!([{ "id": "gpt-current", "displayName": "GPT Current" }]);
    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&provider).unwrap(),
    )
    .unwrap();

    let (status, body) = json_response_from(
        app,
        authed_request(
            Method::GET,
            "/v1/providers/provider-secret-reread",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["displayName"], "Updated Provider Name");
    assert_eq!(body["enabled"], false);
    assert_eq!(body["models"][0]["id"], "gpt-current");
    assert!(!body.to_string().contains(api_key));
    let config_text = read_provider_config_text(&paths, "provider-secret-reread");
    assert!(config_text.contains("Updated Provider Name"));
    assert!(config_text.contains("gpt-current"));
    assert!(!config_text.contains(api_key));
    assert!(!config_text.contains("apiKey"));
}

#[tokio::test]
async fn provider_test_openai_compatible_success_uses_loopback_models_and_auth() {
    let api_key = "sk-provider-test-secret-abcd";
    let (base_url, auth_receiver) =
        start_mock_models_provider(StatusCode::OK, r#"{"data":[{"id":"gpt-test"}]}"#).await;
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-provider-test-secret-abcd",
        "provider-test success",
    )
    .await;
}

#[tokio::test]
async fn provider_test_openai_compatible_chat_completions_base_url_uses_models_endpoint() {
    let api_key = "sk-provider-test-chat-url-abcd";
    let (base_url, auth_receiver) =
        start_mock_models_provider(StatusCode::OK, r#"{"data":[{"id":"gpt-test"}]}"#).await;
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-provider-test-chat-url-abcd",
        "provider-test chat completions base url",
    )
    .await;
}

#[tokio::test]
async fn provider_test_openai_compatible_unauthorized_is_sanitized() {
    let api_key = "sk-provider-test-unauthorized-abcd";
    let (base_url, auth_receiver) = start_mock_models_provider(
        StatusCode::UNAUTHORIZED,
        "raw-provider-body access_token=secret Bearer should-not-leak",
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-provider-test-unauthorized-abcd",
        "provider-test unauthorized",
    )
    .await;
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
    let (base_url, auth_receiver) = start_slow_models_provider().await;
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-provider-test-timeout-abcd",
        "provider-test timeout",
    )
    .await;
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-provider-test-upstream-abcd",
        "provider-test upstream error",
    )
    .await;
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
async fn chat_history_create_list_get_delete_endpoints_persist_locally() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));

    let (status, created) = json_response_from(
        app.clone(),
        authed_request(Method::POST, "/v1/chats", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let chat_id = created["chatId"].as_str().unwrap().to_string();
    assert!(chat_id.starts_with("chat_"));
    assert_eq!(created["title"], "New chat");
    assert_eq!(created["messages"], json!([]));
    let created_text = created.to_string().to_lowercase();
    assert!(!created_text.contains("api_key"));
    assert!(!created_text.contains("access_token"));
    assert!(!created_text.contains("refresh_token"));
    assert!(!created_text.contains("cookie"));
    assert!(!created_text.contains(&paths.config_dir.to_string_lossy().to_lowercase()));

    let stored_path = chat_history::chat_history_path(&paths.config_dir, &chat_id).unwrap();
    assert!(stored_path.exists());
    assert!(stored_path.starts_with(paths.config_dir.join("chat-history")));
    assert!(!paths.project_dir.join("chat-history").exists());

    let (status, list) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/chats", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["chats"].as_array().unwrap().len(), 1);
    assert_eq!(list["chats"][0]["chatId"], chat_id);
    assert_eq!(list["chats"][0]["messageCount"], 0);
    assert!(list["chats"][0].get("messages").is_none());

    let app_after_restart = yet_lsp::app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (status, loaded) = json_response_from(
        app_after_restart.clone(),
        authed_request(Method::GET, &format!("/v1/chats/{chat_id}"), Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(loaded, created);

    let delete_status = empty_response_from(
        app_after_restart.clone(),
        authed_request(
            Method::DELETE,
            &format!("/v1/chats/{chat_id}"),
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(delete_status, StatusCode::NO_CONTENT);
    let (status, body) = json_response_from(
        app_after_restart,
        authed_request(Method::GET, &format!("/v1/chats/{chat_id}"), Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "chat not found");
}

#[tokio::test]
async fn chat_history_invalid_missing_and_corrupt_state_are_sanitized() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    for id in ["../secret", ".", "..", "bad:id", "bad%2Fid", "bad\\id"] {
        let (status, text) = text_response_from(
            app.clone(),
            authed_request(Method::GET, &format!("/v1/chats/{id}"), Body::empty()),
        )
        .await;
        assert!(matches!(
            status,
            StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND
        ));
        assert!(!text.contains(&id));
        assert!(!text.contains(&paths.config_dir.to_string_lossy().to_string()));
    }

    let (status, missing) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/chats/chat_missing", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(missing["error"], "chat not found");

    let path = chat_history::chat_history_path(&paths.config_dir, "chat_corrupt").unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        &path,
        r#"{"chatId":"chat_corrupt","messages":[{"content":"sk-corrupt-chat-secret-abcd"}"#,
    )
    .unwrap();
    let (status, body) = json_response_from(
        app,
        authed_request(Method::GET, "/v1/chats/chat_corrupt", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "chat history storage error");
    let text = body.to_string();
    assert!(!text.contains("sk-corrupt-chat-secret-abcd"));
    assert!(!text.contains(&paths.config_dir.to_string_lossy().to_string()));
}

#[tokio::test]
async fn chat_id_invalid_get_delete_and_command_are_rejected_safely() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let mut invalid_ids = vec!["bad:id".to_string(), ".bad".to_string(), "-bad".to_string()];
    invalid_ids.push("a123456789".repeat(13));

    for id in invalid_ids {
        let (status, text) = text_response_from(
            app.clone(),
            authed_request(Method::GET, &format!("/v1/chats/{id}"), Body::empty()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{id}");
        assert_eq!(text, r#"{"error":"invalid chat id"}"#);
        assert!(!text.contains(&id));

        let (status, text) = text_response_from(
            app.clone(),
            authed_request(Method::DELETE, &format!("/v1/chats/{id}"), Body::empty()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{id}");
        assert_eq!(text, r#"{"error":"invalid chat id"}"#);
        assert!(!text.contains(&id));
    }

    let command = json!({
        "requestId": "req-invalid-chat-id",
        "type": "user_message",
        "payload": { "content": "hello sk-command-invalid-chat-id-secret" }
    });
    let (status, text) = text_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/chats/bad:id/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(text, r#"{"error":"invalid chat id"}"#);
    assert!(!text.contains("bad:id"));
    assert!(!text.contains("sk-command-invalid-chat-id-secret"));
    assert!(!paths.config_dir.join("chat-history").exists());
}

#[tokio::test]
async fn chat_id_invalid_subscribe_queries_are_rejected_before_sse() {
    let app = test_app();
    let mut uris = vec![
        "/v1/chats/subscribe".to_string(),
        "/v1/chats/subscribe?chat_id=".to_string(),
        "/v1/chats/subscribe?chat_id=bad:id".to_string(),
        "/v1/chats/subscribe?chat_id=.bad".to_string(),
        "/v1/chats/subscribe?chat_id=bad%2Fid".to_string(),
    ];
    uris.push(format!("/v1/chats/subscribe?chat_id={}", "a".repeat(129)));
    for uri in uris {
        let response = app
            .clone()
            .oneshot(authed_request(Method::GET, &uri, Body::empty()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{uri}");
        assert_ne!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(text, r#"{"error":"invalid chat id"}"#);
        assert!(!text.contains("bad:id"));
        assert!(!text.contains("bad/id"));
    }
}

#[tokio::test]
async fn chat_id_valid_subscribe_still_returns_sse_snapshot() {
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

#[cfg(unix)]
#[tokio::test]
async fn chat_history_private_permissions_and_symlink_rejection_are_enforced() {
    use std::os::unix::fs::PermissionsExt;

    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (status, created) = json_response_from(
        app.clone(),
        authed_request(Method::POST, "/v1/chats", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let chat_id = created["chatId"].as_str().unwrap();
    let root = paths.config_dir.join("chat-history");
    let path = chat_history::chat_history_path(&paths.config_dir, chat_id).unwrap();
    assert_eq!(
        std::fs::symlink_metadata(&root)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::symlink_metadata(&path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );

    let outside = std::env::temp_dir().join(format!(
        "yet-ai-chat-history-outside-{}",
        TEST_STORAGE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&outside);
    std::fs::create_dir_all(&outside).unwrap();
    let target = outside.join("outside.json");
    std::fs::write(&target, "{}").unwrap();
    let link_path = root.join("chat_link.json");
    std::os::unix::fs::symlink(&target, &link_path).unwrap();

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/chats/chat_link", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "chat history storage error");
    assert!(!body
        .to_string()
        .contains(&outside.to_string_lossy().to_string()));

    let symlink_paths = test_storage_paths();
    let symlink_app = yet_lsp::app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        symlink_paths.clone(),
    ));
    let outside_root = std::env::temp_dir().join(format!(
        "yet-ai-chat-history-root-outside-{}",
        TEST_STORAGE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&outside_root);
    std::fs::create_dir_all(&outside_root).unwrap();
    std::fs::create_dir_all(&symlink_paths.config_dir).unwrap();
    std::os::unix::fs::symlink(&outside_root, symlink_paths.config_dir.join("chat-history"))
        .unwrap();
    let (status, body) = json_response_from(
        symlink_app,
        authed_request(Method::POST, "/v1/chats", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"], "chat history storage error");
    assert!(std::fs::read_dir(outside_root).unwrap().next().is_none());
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
            "chat-user-message-context-contract",
            include_str!("../../../packages/contracts/examples/engine/user-message-command-with-context.json"),
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
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-context-unsafe-path.json"),
            StatusCode::BAD_REQUEST,
            ["~/private", "../src/main.ts"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-context-tool-smuggling.json"),
            StatusCode::BAD_REQUEST,
            ["workspace.edit", "toolCall"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-context-secret-metadata.json"),
            StatusCode::BAD_REQUEST,
            ["example-secret-placeholder", "metadata"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-context-oversized-selection-text.json"),
            StatusCode::BAD_REQUEST,
            ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"].as_slice(),
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
async fn disabled_chat_command_contract_fixtures_are_rejected_safely() {
    let app = test_app();
    for (command, forbidden) in [
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-regenerate.json"),
            ["regenerate", "msg-example-001"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-update-message.json"),
            [
                "update_message",
                "msg-example-001",
                "Replace the previous example request.",
            ]
            .as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-remove-message.json"),
            ["remove_message", "msg-example-001"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-set-params.json"),
            ["set_params", "temperature", "maxOutputTokens", "512"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-tool-decision.json"),
            ["tool_decision", "tool-example-001", "deny"].as_slice(),
        ),
        (
            include_str!("../../../packages/contracts/examples-invalid/engine/chat-command-ide-tool-result.json"),
            ["ide_tool_result", "tool-example-001", "cancelled"].as_slice(),
        ),
    ] {
        let (status, text) = text_response_from(
            app.clone(),
            authed_request(
                Method::POST,
                "/v1/chats/chat-disabled-contract/commands",
                Body::from(command),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_IMPLEMENTED);
        assert_eq!(text, r#"{"error":"unsupported command type"}"#);
        for value in forbidden {
            assert!(!text.contains(value));
        }
        let lower = text.to_lowercase();
        assert!(!lower.contains("api_key"));
        assert!(!lower.contains("token"));
        assert!(!lower.contains("secret"));
        assert!(!lower.contains("/"));
        assert!(!lower.contains("tool-example"));
    }

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-disabled-contract").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    assert!(!events.iter().any(|event| event["type"] == "stream_started"));
    assert!(!text.contains("msg-example-001"));
    assert!(!text.contains("tool-example-001"));
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
async fn chat_context_invalid_shapes_are_rejected_safely() {
    for context in [
        json!({
            "kind": "active_editor",
            "source": "vscode",
            "file": { "displayPath": "/Users/example/private.rs" }
        }),
        json!({
            "kind": "active_editor",
            "source": "vscode",
            "file": { "displayPath": "src/main.rs", "languageId": "rust token" }
        }),
        json!({
            "kind": "active_editor",
            "source": "vscode",
            "selection": { "text": "context-secret-marker".repeat(500) }
        }),
        json!({
            "kind": "active_editor",
            "source": "vscode",
            "selection": { "text": "selected", "toolResult": "context-secret-marker" }
        }),
    ] {
        let command = json!({
            "requestId": "req-invalid-context",
            "type": "user_message",
            "payload": {
                "content": "hello",
                "context": context
            }
        });
        let (status, text) = text_response_from(
            test_app(),
            authed_request(
                Method::POST,
                "/v1/chats/chat-context-invalid/commands",
                Body::from(command.to_string()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!text.contains("context-secret-marker"));
        assert!(!text.contains("/Users/example"));
        assert!(!text.contains("toolResult"));
    }
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
async fn chat_success_persists_user_and_assistant_messages_for_snapshot_and_restart() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let api_key = "sk-history-success-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"persisted \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"assistant\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    configure_openai_provider(app.clone(), base_url, api_key).await;

    assert_eq!(
        send_user_message_with_content(app.clone(), "chat-history-success", "persist me").await,
        StatusCode::OK
    );
    let loaded = wait_for_chat_messages(app.clone(), "chat-history-success", 2).await;
    assert_eq!(loaded["messages"].as_array().unwrap().len(), 2);
    assert_eq!(loaded["messages"][0]["role"], "user");
    assert_eq!(loaded["messages"][0]["content"], "persist me");
    assert_eq!(loaded["messages"][0]["status"], "complete");
    assert_eq!(loaded["messages"][1]["role"], "assistant");
    assert_eq!(loaded["messages"][1]["content"], "persisted assistant");
    assert_eq!(loaded["messages"][1]["status"], "complete");

    let snapshot_app = yet_lsp::app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let text = sse_text_from(
        snapshot_app,
        "/v1/chats/subscribe?chat_id=chat-history-success",
    )
    .await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["type"], "snapshot");
    assert_eq!(
        events[0]["payload"]["messages"].as_array().unwrap().len(),
        2
    );
    assert_eq!(
        events[0]["payload"]["messages"][1]["content"],
        "persisted assistant"
    );
    assert_eq!(
        events[0]["payload"]["thread"]["messages"][0]["content"],
        "persist me"
    );
    assert!(!text.contains(api_key));

    let restarted = yet_lsp::app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths,
    ));
    let restart_text = sse_text_from(
        restarted,
        "/v1/chats/subscribe?chat_id=chat-history-success",
    )
    .await;
    let restart_events = sse_json_events(&restart_text);
    assert_eq!(
        restart_events[0]["payload"]["messages"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        restart_events[0]["payload"]["messages"][1]["content"],
        "persisted assistant"
    );
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-history-success-secret-abcd",
        "history success persistence",
    )
    .await;
}

#[tokio::test]
async fn chat_provider_error_persists_sanitized_error_history_and_snapshot() {
    let api_key = "sk-history-error-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::UNAUTHORIZED,
        "raw-provider-body access_token=secret-token Bearer should-not-leak",
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message_with_content(app.clone(), "chat-history-error", "hello error").await;

    let loaded = wait_for_chat_messages(app.clone(), "chat-history-error", 2).await;
    assert_eq!(loaded["messages"][0]["role"], "user");
    assert_eq!(loaded["messages"][1]["role"], "error");
    assert_eq!(loaded["messages"][1]["status"], "error");
    assert_eq!(
        loaded["messages"][1]["content"],
        "Provider credentials were rejected."
    );
    assert!(loaded
        .to_string()
        .contains("Provider credentials were rejected"));
    assert_sanitized_sse_error(&loaded.to_string());
    assert!(!loaded.to_string().contains(api_key));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-history-error-secret-abcd",
        "history error persistence",
    )
    .await;
}

#[tokio::test]
async fn abort_does_not_leave_assistant_or_streaming_history_state() {
    let api_key = "sk-history-abort-secret-abcd";
    let (base_url, auth_receiver, first_receiver, continue_sender) =
        start_slow_mock_provider().await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message_with_content(app.clone(), "chat-history-abort", "abort history").await;
    first_receiver.await.unwrap();
    send_abort(app.clone(), "chat-history-abort", "req-history-abort").await;
    let _ = continue_sender.send(());
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let loaded = wait_for_chat_messages(app.clone(), "chat-history-abort", 1).await;
    assert_eq!(loaded["messages"].as_array().unwrap().len(), 1);
    assert_eq!(loaded["messages"][0]["role"], "user");
    assert_eq!(loaded["messages"][0]["status"], "complete");
    assert_ne!(loaded["messages"][0]["status"], "streaming");
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-history-abort").await;
    let events = sse_json_events(&text);
    assert_eq!(
        events[0]["payload"]["messages"].as_array().unwrap().len(),
        1
    );
    assert_eq!(events[0]["payload"]["runtime"]["streaming"], false);
    assert!(!text.contains(api_key));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-history-abort-secret-abcd",
        "history abort safety",
    )
    .await;
}

#[tokio::test]
async fn rejected_user_message_command_does_not_create_history() {
    let app = test_app();
    let command = json!({
        "requestId": "req-history-reject",
        "type": "user_message",
        "payload": { "content": "" }
    });
    let status = empty_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-history-rejected/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::GET,
            "/v1/chats/chat-history-rejected",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "chat not found");
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-history-rejected").await;
    let events = sse_json_events(&text);
    assert_eq!(events[0]["payload"]["messages"], json!([]));
    assert!(!events.iter().any(|event| event["type"] == "stream_started"));
}

#[tokio::test]
async fn openai_compatible_streaming_maps_chunks_to_sse_events() {
    let api_key = "sk-stream-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n",
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-stream-secret-abcd",
        "streaming maps chunks",
    )
    .await;
    assert!(!text.contains(api_key));
}

#[tokio::test]
async fn chat_openai_compatible_streaming_accepts_split_multibyte_utf8_chunks() {
    let api_key = "sk-split-utf8-stream-secret-abcd";
    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Привет 🌍\"}}]}\n\ndata: [DONE]\n\n";
    let bytes = body.as_bytes();
    let split = body.find('🌍').unwrap() + 1;
    let chunks = vec![bytes[..split].to_vec(), bytes[split..].to_vec()];
    let (base_url, auth_receiver) = start_chunked_mock_provider(chunks).await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;

    send_user_message(app.clone(), "chat-split-utf8-stream").await;
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-split-utf8-stream").await;
    let events = sse_json_events(&text);
    assert!(events.iter().any(|event| event["type"] == "stream_delta"
        && event["payload"]["delta"]["content"] == "Привет 🌍"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "stream_finished"));
    assert!(!text.contains(api_key));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-split-utf8-stream-secret-abcd",
        "split utf8 streaming",
    )
    .await;
}

#[tokio::test]
async fn chat_context_is_included_before_user_request_in_provider_prompt() {
    let api_key = "sk-context-stream-secret-abcd";
    let (base_url, mut body_receiver) = start_mock_provider_with_request_body(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"context-ok\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;

    let command = include_str!(
        "../../../packages/contracts/examples/engine/user-message-command-with-context.json"
    );
    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-context-prompt/commands",
            Body::from(command),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["accepted"], true);

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-context-prompt").await;
    assert!(text.contains("context-ok"));
    assert!(!text.contains(api_key));
    let provider_body =
        tokio::time::timeout(std::time::Duration::from_secs(2), body_receiver.recv())
            .await
            .unwrap()
            .unwrap();
    let prompt = provider_body["messages"][0]["content"].as_str().unwrap();
    assert_chat_context_prompt_has_expected_shape(prompt);
    assert!(!prompt.contains(api_key));
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
        start_slow_mock_provider().await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message(app.clone(), "chat-abort-stream").await;
    tokio::time::timeout(std::time::Duration::from_secs(2), first_receiver)
        .await
        .expect("provider should stream first delta")
        .expect("provider first-delta signal should be sent");
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-abort-stream-secret-abcd",
        "abort active provider stream",
    )
    .await;
    assert!(!text.contains(api_key));
    assert_sanitized_sse_error(&text);
}

#[tokio::test]
async fn experimental_openai_oauth_token_streams_chat_via_mock_endpoint() {
    let (chat_base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"OAuth\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" chat\"}}]}\n\ndata: [DONE]\n\n",
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer codex-access-token-secret-abcd",
        "oauth token streams chat",
    )
    .await;
    assert!(!text.contains("codex-access-token-secret"));
    assert!(!text.contains("codex-refresh-token-secret"));
}

#[tokio::test]
async fn tampered_experimental_openai_oauth_metadata_does_not_route_to_unsafe_url() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (safe_chat_base_url, safe_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"safe\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (unsafe_chat_base_url, unsafe_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unsafe\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    connect_experimental_openai_oauth(app.clone(), token_endpoint_url, safe_chat_base_url).await;

    let store = FileSecretStore::new(&paths.config_dir);
    let metadata = store
        .get_secret("openai", SecretKind::AuthMetadata)
        .await
        .unwrap()
        .unwrap();
    let mut metadata: Value = serde_json::from_str(&metadata).unwrap();
    metadata["chatBaseUrl"] = json!(format!("{unsafe_chat_base_url}?access_token=secret-query"));
    store
        .put_secret("openai", SecretKind::AuthMetadata, &metadata.to_string())
        .await
        .unwrap();

    let (status, body) = json_response_from(
        app.clone(),
        authed_request(
            Method::GET,
            "/v1/provider-auth/openai/status",
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid provider auth request");
    assert_provider_auth_response_has_no_codex_secrets(&body);

    send_user_message(app.clone(), "chat-codex-tampered-metadata").await;
    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-codex-tampered-metadata",
    )
    .await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_not_configured");
    assert_sanitized_sse_error(&text);
    assert_no_observed_auth(safe_auth_receiver).await;
    assert_no_observed_auth(unsafe_auth_receiver).await;
}

#[tokio::test]
async fn incomplete_experimental_openai_oauth_metadata_does_not_route_chat() {
    for missing_kind in [SecretKind::OAuthAccessToken, SecretKind::OAuthRefreshToken] {
        let paths = test_storage_paths();
        let app = app(AppState::with_storage_paths(
            ProductIdentity::load().unwrap(),
            AuthToken::new(TEST_TOKEN).unwrap(),
            paths.clone(),
        ));
        let (chat_base_url, auth_receiver) = start_mock_provider(
            StatusCode::OK,
            "data: {\"choices\":[{\"delta\":{\"content\":\"unsafe\"}}]}\n\ndata: [DONE]\n\n",
        )
        .await;
        let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
        connect_experimental_openai_oauth(app.clone(), token_endpoint_url, chat_base_url).await;
        FileSecretStore::new(&paths.config_dir)
            .delete_secret("openai", missing_kind)
            .await
            .unwrap();

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
        assert_eq!(auth_status["status"], "login_unavailable");
        assert!(auth_status.get("sessionId").is_none());
        assert_provider_auth_response_has_no_codex_secrets(&auth_status);

        send_user_message(app.clone(), "chat-incomplete-oauth-metadata").await;
        let text = sse_text_from(
            app,
            "/v1/chats/subscribe?chat_id=chat-incomplete-oauth-metadata",
        )
        .await;
        let events = sse_json_events(&text);
        let error = find_error_event(&events);
        assert_eq!(error["payload"]["code"], "provider_not_configured");
        assert_sanitized_sse_error(&text);
        assert_no_observed_auth(auth_receiver).await;
    }
}

#[tokio::test]
async fn api_key_provider_is_preferred_over_experimental_openai_oauth() {
    let api_key = "sk-preferred-secret-abcd";
    let (oauth_chat_base_url, oauth_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"oauth\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (api_base_url, api_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"api-key\"}}]}\n\ndata: [DONE]\n\n",
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
    assert_first_auth_and_no_immediate_extra_auth(
        api_auth_receiver,
        "Bearer sk-preferred-secret-abcd",
        "api key provider preferred",
    )
    .await;
    assert_no_observed_auth(oauth_auth_receiver).await;
}

#[tokio::test]
async fn chat_expired_experimental_oauth_refreshes_during_selection() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, mut auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"expired-refreshed\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-expired-fresh",
            "refresh_token": "refresh-expired-fresh",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    seed_experimental_openai_oauth_with_ttl(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-expired-old",
        "refresh-expired-old",
        -1,
    )
    .await;

    send_user_message(app.clone(), "chat-expired-oauth-refresh-selection").await;
    let loaded = wait_for_chat_messages(app.clone(), "chat-expired-oauth-refresh-selection", 2).await;
    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-expired-oauth-refresh-selection",
    )
    .await;
    assert!(text.contains("expired-refreshed"));
    assert_eq!(loaded["messages"][1]["content"], "expired-refreshed");
    assert!(!text.contains("access-expired"));
    assert!(!text.contains("refresh-expired"));
    let auth = auth_receiver.recv().await.unwrap();
    assert_stored_secret(auth.as_deref(), "Bearer access-expired-fresh");
    assert!(tokio::time::timeout(std::time::Duration::from_millis(100), auth_receiver.recv())
        .await
        .is_err());
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(&body["refresh_token"], "refresh-expired-old", "expired refresh token");
}

#[tokio::test]
async fn chat_near_expired_experimental_oauth_refreshes_before_provider_request() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, mut auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"near-refreshed\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-near-fresh",
            "refresh_token": "refresh-near-fresh",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    seed_experimental_openai_oauth_with_ttl(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-near-old",
        "refresh-near-old",
        30,
    )
    .await;

    send_user_message(app.clone(), "chat-near-oauth-refresh-selection").await;
    let loaded = wait_for_chat_messages(app.clone(), "chat-near-oauth-refresh-selection", 2).await;
    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-near-oauth-refresh-selection",
    )
    .await;
    assert!(text.contains("near-refreshed"));
    assert_eq!(loaded["messages"][1]["content"], "near-refreshed");
    let auth = auth_receiver.recv().await.unwrap();
    assert_stored_secret(auth.as_deref(), "Bearer access-near-fresh");
    assert!(tokio::time::timeout(std::time::Duration::from_millis(100), auth_receiver.recv())
        .await
        .is_err());
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(&body["refresh_token"], "refresh-near-old", "near refresh token");
}

#[tokio::test]
async fn expired_experimental_openai_oauth_without_refresh_falls_back_to_provider_not_configured() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unused\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint_with(1).await;
    connect_experimental_openai_oauth(app.clone(), token_endpoint_url, chat_base_url).await;
    FileSecretStore::new(&paths.config_dir)
        .delete_secret("openai", SecretKind::OAuthRefreshToken)
        .await
        .unwrap();

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
    assert_eq!(auth_status["status"], "login_unavailable");
    assert_provider_auth_response_has_no_codex_secrets(&auth_status);

    send_user_message(app.clone(), "chat-expired-oauth-missing-refresh").await;
    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-expired-oauth-missing-refresh",
    )
    .await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_not_configured");
    assert_sanitized_sse_error(&text);
    assert_no_observed_auth(auth_receiver).await;
}

#[tokio::test]
async fn experimental_openai_oauth_unauthorized_error_is_sanitized() {
    let (chat_base_url, auth_receiver) = start_mock_provider(
        StatusCode::UNAUTHORIZED,
        "raw-provider-body access_token=secret-token Bearer should-not-leak",
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer codex-access-token-secret-abcd",
        "oauth unauthorized error",
    )
    .await;
}

#[tokio::test]
async fn chat_experimental_oauth_403_does_not_refresh_or_retry() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, auth_receiver) = start_mock_provider(
        StatusCode::FORBIDDEN,
        r#"{"error":{"message":"forbidden access_token=access-1 refresh_token=refresh-1"}}"#,
    )
    .await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    seed_experimental_openai_oauth(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-1",
        "refresh-1",
    )
    .await;

    send_user_message(app.clone(), "chat-oauth-forbidden-no-retry").await;
    let loaded = wait_for_chat_messages(app.clone(), "chat-oauth-forbidden-no-retry", 2).await;
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-oauth-forbidden-no-retry").await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_unauthorized");
    assert_eq!(loaded["messages"][1]["content"], "Provider credentials were rejected.");
    assert_sanitized_sse_error(&text);
    assert!(!text.contains("access-1"));
    assert!(!text.contains("refresh-1"));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer access-1",
        "oauth 403 no retry",
    )
    .await;
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());
}

#[tokio::test]
async fn chat_experimental_oauth_stream_auth_error_after_delta_does_not_refresh_or_retry() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, auth_receiver) = start_chunked_mock_provider(vec![
        b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".to_vec(),
        b"data: {\"error\":{\"message\":\"unauthorized access_token=access-1 refresh_token=refresh-1\",\"code\":\"invalid_api_key\"}}\n\n".to_vec(),
    ])
    .await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    seed_experimental_openai_oauth(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-1",
        "refresh-1",
    )
    .await;

    send_user_message(app.clone(), "chat-oauth-stream-auth-error-no-retry").await;
    let loaded = wait_for_chat_messages(app.clone(), "chat-oauth-stream-auth-error-no-retry", 2).await;
    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-oauth-stream-auth-error-no-retry",
    )
    .await;
    let events = sse_json_events(&text);
    let deltas: Vec<_> = events
        .iter()
        .filter(|event| event["type"] == "stream_delta")
        .collect();
    assert_eq!(deltas.len(), 1);
    assert_eq!(deltas[0]["payload"]["delta"]["content"], "partial");
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_unauthorized");
    assert_eq!(loaded["messages"][1]["content"], "Provider credentials were rejected.");
    assert_sanitized_sse_error(&text);
    assert!(!text.contains("access-1"));
    assert!(!text.contains("refresh-1"));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer access-1",
        "oauth stream auth error no retry",
    )
    .await;
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());
}

#[tokio::test]
async fn chat_experimental_oauth_retries_after_stale_access_token_401() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, mut auth_receiver) = start_stale_oauth_chat_provider().await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    seed_experimental_openai_oauth(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-1",
        "refresh-1",
    )
    .await;

    send_user_message(app.clone(), "chat-oauth-stale-retry").await;
    let loaded = wait_for_chat_messages(app.clone(), "chat-oauth-stale-retry", 2).await;
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-oauth-stale-retry").await;
    assert!(text.contains("refreshed"));
    assert!(!text.contains("access-1"));
    assert!(!text.contains("access-2"));
    assert!(!text.contains("refresh-1"));
    assert!(!text.contains("refresh-2"));
    assert_sanitized_sse_error(&text);
    assert_eq!(loaded["messages"].as_array().unwrap().len(), 2);
    assert_eq!(loaded["messages"][0]["role"], "user");
    assert_eq!(loaded["messages"][1]["role"], "assistant");
    assert_eq!(loaded["messages"][1]["content"], "refreshed");
    assert!(!loaded.to_string().contains("access-1"));
    assert!(!loaded.to_string().contains("refresh-1"));

    let first = auth_receiver.recv().await.unwrap();
    assert_stored_secret(first.as_deref(), "Bearer access-1");
    let second = auth_receiver.recv().await.unwrap();
    assert_stored_secret(second.as_deref(), "Bearer access-2");
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), auth_receiver.recv())
            .await
            .is_err()
    );
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(&body["refresh_token"], "refresh-1", "refresh request token");
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());
}

#[tokio::test]
async fn chat_experimental_oauth_slow_401_body_retries_without_waiting_for_body() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, mut auth_receiver) = start_slow_401_oauth_chat_provider().await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    seed_experimental_openai_oauth(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-1",
        "refresh-1",
    )
    .await;

    send_user_message(app.clone(), "chat-oauth-slow-401-retry").await;
    let loaded = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        wait_for_chat_messages(app.clone(), "chat-oauth-slow-401-retry", 2),
    )
    .await
    .expect("slow 401 body must not delay OAuth retry");
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-oauth-slow-401-retry").await;
    assert!(text.contains("refreshed-after-slow-401"));
    assert_eq!(loaded["messages"][1]["content"], "refreshed-after-slow-401");
    assert_sanitized_sse_error(&text);
    assert!(!text.contains("access-1"));
    assert!(!text.contains("refresh-1"));
    let first = auth_receiver.recv().await.unwrap();
    assert_stored_secret(first.as_deref(), "Bearer access-1");
    let second = auth_receiver.recv().await.unwrap();
    assert_stored_secret(second.as_deref(), "Bearer access-2");
    assert!(tokio::time::timeout(std::time::Duration::from_millis(100), auth_receiver.recv())
        .await
        .is_err());
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(&body["refresh_token"], "refresh-1", "slow 401 refresh token");
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());
}

#[tokio::test]
async fn chat_experimental_oauth_concurrent_401_retry_is_single_flight() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, mut auth_receiver) = start_stale_oauth_chat_provider().await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::OK,
        json!({
            "access_token": "access-2",
            "refresh_token": "refresh-2",
            "expires_in": 1800,
            "scope": "openid profile email offline_access",
            "account_label": "mock-user@example.test"
        }),
    )
    .await;
    seed_experimental_openai_oauth(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-1",
        "refresh-1",
    )
    .await;

    let first = send_user_message(app.clone(), "chat-oauth-concurrent-a");
    let second = send_user_message(app.clone(), "chat-oauth-concurrent-b");
    tokio::join!(first, second);
    let loaded_a = wait_for_chat_messages(app.clone(), "chat-oauth-concurrent-a", 2).await;
    let loaded_b = wait_for_chat_messages(app, "chat-oauth-concurrent-b", 2).await;
    assert!(loaded_a.to_string().contains("refreshed"), "{loaded_a}");
    assert!(loaded_b.to_string().contains("refreshed"), "{loaded_b}");
    assert!(
        loaded_a["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| message["role"] == "user")
            .count()
            <= 1
    );
    assert!(
        loaded_b["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| message["role"] == "user")
            .count()
            <= 1
    );
    assert_sanitized_sse_error(&loaded_a.to_string());
    assert_sanitized_sse_error(&loaded_b.to_string());

    let mut observed = Vec::new();
    for _ in 0..4 {
        observed.push(auth_receiver.recv().await.unwrap().unwrap());
    }
    assert_eq!(
        observed
            .iter()
            .filter(|value| value.as_str() == "Bearer access-1")
            .count(),
        2
    );
    assert_eq!(
        observed
            .iter()
            .filter(|value| value.as_str() == "Bearer access-2")
            .count(),
        2
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), auth_receiver.recv())
            .await
            .is_err()
    );
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(&body["refresh_token"], "refresh-1", "refresh request token");
    assert!(tokio::time::timeout(
        std::time::Duration::from_millis(100),
        token_body_receiver.recv()
    )
    .await
    .is_err());
}

#[tokio::test]
async fn chat_experimental_oauth_refresh_token_reused_error_is_sanitized() {
    let paths = test_storage_paths();
    let app = app(AppState::with_storage_paths(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
        paths.clone(),
    ));
    let (chat_base_url, auth_receiver) = start_stale_oauth_chat_provider().await;
    let (token_endpoint_url, mut token_body_receiver) = start_refresh_codex_token_endpoint(
        StatusCode::UNAUTHORIZED,
        json!({
            "error": {
                "message": "Your refresh token has already been used to generate a new access token. access_token=access-1 refresh_token=refresh-1",
                "code": "refresh_token_reused"
            }
        }),
    )
    .await;
    seed_experimental_openai_oauth(
        &paths,
        chat_base_url,
        token_endpoint_url,
        "access-1",
        "refresh-1",
    )
    .await;

    send_user_message(app.clone(), "chat-oauth-refresh-reused").await;
    let loaded = wait_for_chat_messages(app.clone(), "chat-oauth-refresh-reused", 2).await;
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-oauth-refresh-reused").await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_config_error");
    assert_sanitized_sse_error(&text);
    assert!(!text.contains("access-1"));
    assert!(!text.contains("refresh-1"));
    assert!(!text.contains("refresh_token_reused"));
    assert!(!text.contains("already been used"));
    assert_eq!(
        loaded["messages"][1]["content"],
        "Provider configuration is invalid."
    );
    assert_sanitized_sse_error(&loaded.to_string());
    assert!(!loaded.to_string().contains("refresh_token_reused"));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer access-1",
        "oauth refresh reused sanitized",
    )
    .await;
    let body = token_body_receiver.recv().await.unwrap();
    assert_eq!(body["grant_type"], "refresh_token");
    assert_json_string_value(&body["refresh_token"], "refresh-1", "refresh request token");
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
async fn provider_without_model_first_skips_to_later_usable_provider() {
    let no_model_key = "sk-skip-no-model-secret-abcd";
    let usable_key = "sk-skip-usable-secret-wxyz";
    let (no_model_base_url, no_model_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unused\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (usable_base_url, usable_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"usable-provider\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = test_app();
    configure_openai_provider_without_models_with_id(
        app.clone(),
        "aaa-no-model",
        no_model_base_url,
        no_model_key,
    )
    .await;
    configure_openai_provider_with_id(
        app.clone(),
        "zzz-usable-model",
        usable_base_url,
        usable_key,
        "gpt-usable",
    )
    .await;
    send_user_message(app.clone(), "chat-skip-no-model").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-skip-no-model").await;
    assert!(text.contains("usable-provider"));
    assert!(!text.contains(no_model_key));
    assert!(!text.contains(usable_key));
    assert_sanitized_sse_error(&text);
    assert_no_observed_auth(no_model_auth_receiver).await;
    assert_first_auth_and_no_immediate_extra_auth(
        usable_auth_receiver,
        "Bearer sk-skip-usable-secret-wxyz",
        "skip no-model first provider",
    )
    .await;
}

#[tokio::test]
async fn chat_provider_selection_is_deterministic_by_provider_id() {
    let first_key = "sk-deterministic-first-secret-abcd";
    let second_key = "sk-deterministic-second-secret-wxyz";
    let (first_base_url, first_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"first-by-id\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (second_base_url, second_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"second-by-id\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = test_app();
    configure_openai_provider_with_id(
        app.clone(),
        "zzz-later-by-id",
        second_base_url,
        second_key,
        "gpt-second",
    )
    .await;
    configure_openai_provider_with_id(
        app.clone(),
        "aaa-first-by-id",
        first_base_url,
        first_key,
        "gpt-first",
    )
    .await;
    send_user_message(app.clone(), "chat-deterministic-selection").await;

    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-deterministic-selection",
    )
    .await;
    assert!(text.contains("first-by-id"));
    assert!(!text.contains("second-by-id"));
    assert!(!text.contains(first_key));
    assert!(!text.contains(second_key));
    assert_first_auth_and_no_immediate_extra_auth(
        first_auth_receiver,
        "Bearer sk-deterministic-first-secret-abcd",
        "deterministic provider id selection",
    )
    .await;
    assert_no_observed_auth(second_auth_receiver).await;
}

#[tokio::test]
async fn chat_selection_matches_first_model_summary_entry() {
    let no_model_key = "sk-summary-no-model-secret-abcd";
    let usable_key = "sk-summary-usable-secret-wxyz";
    let (no_model_base_url, no_model_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unused\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (usable_base_url, usable_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"summary-selected\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = test_app();
    configure_openai_provider_without_models_with_id(
        app.clone(),
        "aaa-summary-no-model",
        no_model_base_url,
        no_model_key,
    )
    .await;
    configure_openai_provider_with_id(
        app.clone(),
        "bbb-summary-usable",
        usable_base_url,
        usable_key,
        "gpt-summary",
    )
    .await;

    let (status, models) = json_response_from(
        app.clone(),
        authed_request(Method::GET, "/v1/models", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(models["models"][0]["providerId"], "bbb-summary-usable");
    assert_eq!(models["models"][0]["id"], "gpt-summary");

    send_user_message(app.clone(), "chat-summary-parity").await;
    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-summary-parity").await;
    assert!(text.contains("summary-selected"));
    assert!(!text.contains(no_model_key));
    assert!(!text.contains(usable_key));
    assert_no_observed_auth(no_model_auth_receiver).await;
    assert_first_auth_and_no_immediate_extra_auth(
        usable_auth_receiver,
        "Bearer sk-summary-usable-secret-wxyz",
        "summary parity provider selection",
    )
    .await;
}

#[tokio::test]
async fn chat_selection_skips_unready_non_chat_and_non_streaming_models() {
    let missing_key = "sk-unready-missing-secret-abcd";
    let non_chat_key = "sk-unready-non-chat-secret-abcd";
    let usable_key = "sk-unready-usable-secret-wxyz";
    let (missing_base_url, missing_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"missing\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (non_chat_base_url, non_chat_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"non-chat\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (usable_base_url, usable_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"ready-chat-streaming\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = test_app();
    configure_provider(
        app.clone(),
        json!({
            "id": "aaa-missing-credentials",
            "kind": "openai-compatible",
            "displayName": "Missing Credentials",
            "enabled": true,
            "baseUrl": missing_base_url,
            "auth": { "type": "api_key" },
            "models": [{ "id": "gpt-missing", "displayName": "GPT Missing" }],
            "capabilities": { "chat": true, "completion": false, "embeddings": false }
        }),
        Some(missing_key),
    )
    .await;
    configure_provider(
        app.clone(),
        json!({
            "id": "bbb-non-chat",
            "kind": "openai-compatible",
            "displayName": "Non Chat",
            "enabled": true,
            "baseUrl": non_chat_base_url,
            "auth": { "type": "api_key", "apiKey": non_chat_key },
            "models": [{ "id": "gpt-non-chat", "displayName": "GPT Non Chat" }],
            "capabilities": { "chat": false, "completion": false, "embeddings": false }
        }),
        Some(non_chat_key),
    )
    .await;
    configure_provider(
        app.clone(),
        json!({
            "id": "ccc-usable",
            "kind": "openai-compatible",
            "displayName": "Usable",
            "enabled": true,
            "baseUrl": usable_base_url,
            "auth": { "type": "api_key", "apiKey": usable_key },
            "models": [{ "id": "gpt-usable", "displayName": "GPT Usable" }],
            "capabilities": { "chat": true, "completion": false, "embeddings": false }
        }),
        Some(usable_key),
    )
    .await;
    send_user_message(app.clone(), "chat-ready-capability-selection").await;

    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-ready-capability-selection",
    )
    .await;
    assert!(text.contains("ready-chat-streaming"));
    assert!(!text.contains("missing"));
    assert!(!text.contains("non-chat"));
    assert!(!text.contains(missing_key));
    assert!(!text.contains(non_chat_key));
    assert!(!text.contains(usable_key));
    assert_no_observed_auth(missing_auth_receiver).await;
    assert_no_observed_auth(non_chat_auth_receiver).await;
    assert_first_auth_and_no_immediate_extra_auth(
        usable_auth_receiver,
        "Bearer sk-unready-usable-secret-wxyz",
        "ready capability selection",
    )
    .await;
}

#[tokio::test]
async fn chat_selection_skips_disabled_provider_and_later_model_capabilities_win() {
    let disabled_key = "sk-disabled-chat-secret-abcd";
    let usable_key = "sk-second-model-secret-wxyz";
    let (disabled_base_url, disabled_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"disabled\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (usable_base_url, mut body_receiver) = start_mock_provider_with_request_body(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"second-model-ready\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let app = test_app();
    configure_provider(
        app.clone(),
        json!({
            "id": "aaa-disabled-provider",
            "kind": "openai-compatible",
            "displayName": "Disabled Provider",
            "enabled": false,
            "baseUrl": disabled_base_url,
            "auth": { "type": "api_key", "apiKey": disabled_key },
            "models": [{ "id": "gpt-disabled", "displayName": "GPT Disabled" }],
            "capabilities": { "chat": true, "completion": false, "embeddings": false }
        }),
        Some(disabled_key),
    )
    .await;
    configure_provider(
        app.clone(),
        json!({
            "id": "bbb-second-model",
            "kind": "openai-compatible",
            "displayName": "Second Model",
            "enabled": true,
            "baseUrl": usable_base_url,
            "auth": { "type": "api_key", "apiKey": usable_key },
            "models": [
                { "id": "", "displayName": "Missing Model" },
                { "id": "gpt-second", "displayName": "GPT Second" }
            ],
            "capabilities": { "chat": true, "completion": false, "embeddings": false }
        }),
        Some(usable_key),
    )
    .await;
    send_user_message(app.clone(), "chat-later-ready-model").await;

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-later-ready-model").await;
    assert!(text.contains("second-model-ready"));
    assert!(!text.contains("disabled"));
    assert!(!text.contains(disabled_key));
    assert!(!text.contains(usable_key));
    assert_no_observed_auth(disabled_auth_receiver).await;
    let provider_body =
        tokio::time::timeout(std::time::Duration::from_secs(2), body_receiver.recv())
            .await
            .unwrap()
            .unwrap();
    assert_eq!(provider_body["model"], "gpt-second");
}

#[tokio::test]
async fn experimental_oauth_fallback_waits_until_no_usable_api_key_model_exists() {
    let api_key = "sk-oauth-fallback-unusable-secret-abcd";
    let (oauth_chat_base_url, oauth_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"oauth-fallback\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (api_base_url, api_auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"api-unused\"}}]}\n\ndata: [DONE]\n\n",
    )
    .await;
    let (token_endpoint_url, _) = start_mock_codex_token_endpoint().await;
    let app = test_app();
    connect_experimental_openai_oauth(app.clone(), token_endpoint_url, oauth_chat_base_url).await;
    configure_provider(
        app.clone(),
        json!({
            "id": "aaa-api-unusable",
            "kind": "openai-compatible",
            "displayName": "API Unusable",
            "enabled": true,
            "baseUrl": api_base_url,
            "auth": { "type": "api_key", "apiKey": api_key },
            "models": [{ "id": "gpt-unusable", "displayName": "GPT Unusable" }],
            "capabilities": { "chat": false, "completion": false, "embeddings": false }
        }),
        Some(api_key),
    )
    .await;
    send_user_message(app.clone(), "chat-oauth-fallback-after-unusable-api").await;

    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-oauth-fallback-after-unusable-api",
    )
    .await;
    assert!(text.contains("oauth-fallback"));
    assert!(!text.contains("api-unused"));
    assert!(!text.contains(api_key));
    assert!(!text.contains("codex-access-token-secret"));
    assert_no_observed_auth(api_auth_receiver).await;
    assert_first_auth_and_no_immediate_extra_auth(
        oauth_auth_receiver,
        "Bearer codex-access-token-secret-abcd",
        "oauth fallback after unusable api provider",
    )
    .await;
}

#[tokio::test]
async fn provider_without_model_replays_model_not_configured_error_event() {
    let api_key = "sk-no-model-secret-abcd";
    let (base_url, _) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"unused\"}}]}\n\n",
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-unauthorized-secret-abcd",
        "provider unauthorized error event",
    )
    .await;
}

#[tokio::test]
async fn chat_provider_http_failures_produce_stable_sanitized_error_events_and_history() {
    for (status, body, expected_code, expected_message, chat_id, forbidden) in [
        (
            StatusCode::REQUEST_TIMEOUT,
            r#"raw-provider-body sk-timeout-secret access_token=secret"#,
            "provider_timeout",
            "Provider request timed out.",
            "chat-http-408-timeout-classified",
            ["sk-timeout-secret", "raw-provider-body", "access_token"].as_slice(),
        ),
        (
            StatusCode::GATEWAY_TIMEOUT,
            r#"raw-provider-body sk-gateway-timeout-secret Cookie: secret"#,
            "provider_timeout",
            "Provider request timed out.",
            "chat-http-504-timeout-classified",
            ["sk-gateway-timeout-secret", "raw-provider-body", "Cookie"].as_slice(),
        ),
        (
            StatusCode::UNAUTHORIZED,
            r#"{"error":{"message":"raw-provider-body sk-http-secret access_token=secret Bearer token","type":"invalid_api_key"}}"#,
            "provider_unauthorized",
            "Provider credentials were rejected.",
            "chat-http-unauthorized-classified",
            ["sk-http-secret", "secret", "invalid_api_key"].as_slice(),
        ),
        (
            StatusCode::TOO_MANY_REQUESTS,
            r#"{"error":{"message":"quota exhausted raw-provider-body sk-rate-secret","type":"rate_limit_exceeded"}}"#,
            "provider_rate_limited",
            "Provider rate limit or quota reached.",
            "chat-http-rate-classified",
            ["sk-rate-secret", "quota exhausted", "rate_limit_exceeded"].as_slice(),
        ),
        (
            StatusCode::BAD_REQUEST,
            r#"{"error":{"code":"context_length_exceeded","message":"maximum context length sk-context-secret raw-provider-body"}}"#,
            "provider_context_too_large",
            "The request is too large for the selected model context window.",
            "chat-http-context-classified",
            [
                "sk-context-secret",
                "context_length_exceeded",
                "maximum context length",
            ]
            .as_slice(),
        ),
        (
            StatusCode::NOT_FOUND,
            r#"<html>raw-provider-body /Users/example/private sk-invalid-secret api_key=secret</html>"#,
            "provider_invalid_request",
            "Provider rejected the request.",
            "chat-http-invalid-classified",
            ["sk-invalid-secret", "/Users/example", "api_key"].as_slice(),
        ),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            r#"upstream exploded raw-provider-body sk-upstream-secret Cookie: secret"#,
            "provider_upstream_error",
            "Provider service returned an error.",
            "chat-http-upstream-classified",
            ["sk-upstream-secret", "upstream exploded", "Cookie"].as_slice(),
        ),
    ] {
        let api_key = "sk-provider-http-classification-secret-abcd";
        let (base_url, auth_receiver) = start_mock_provider(status, body).await;
        let app = test_app();
        configure_openai_provider(app.clone(), base_url, api_key).await;
        send_user_message(app.clone(), chat_id).await;

        let loaded = wait_for_chat_messages(app.clone(), chat_id, 2).await;
        assert_eq!(loaded["messages"][1]["role"], "error");
        assert_eq!(loaded["messages"][1]["content"], expected_message);
        assert_provider_error_text_is_sanitized(&loaded.to_string(), forbidden);

        let text = sse_text_from(app, &format!("/v1/chats/subscribe?chat_id={chat_id}")).await;
        let events = sse_json_events(&text);
        let error = find_error_event(&events);
        assert_eq!(error["payload"]["code"], expected_code);
        assert_eq!(error["payload"]["message"], expected_message);
        assert_provider_error_text_is_sanitized(&text, forbidden);
        assert!(!text.contains(api_key));
        assert_first_auth_and_no_immediate_extra_auth(
            auth_receiver,
            "Bearer sk-provider-http-classification-secret-abcd",
            "provider http error classification",
        )
        .await;
    }
}

#[tokio::test]
async fn chat_provider_stream_error_frame_is_classified_without_raw_body_leakage() {
    let api_key = "sk-stream-error-frame-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"error\":{\"code\":\"context_length_exceeded\",\"message\":\"prompt is too long raw-provider-body sk-frame-secret access_token=secret\"}}\n\n",
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message(app.clone(), "chat-stream-error-frame").await;

    let loaded = wait_for_chat_messages(app.clone(), "chat-stream-error-frame", 2).await;
    assert_eq!(loaded["messages"][1]["role"], "error");
    assert_eq!(
        loaded["messages"][1]["content"],
        "The request is too large for the selected model context window."
    );
    assert_provider_error_text_is_sanitized(
        &loaded.to_string(),
        &[
            "sk-frame-secret",
            "context_length_exceeded",
            "prompt is too long",
        ],
    );

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-stream-error-frame").await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_context_too_large");
    assert_eq!(
        error["payload"]["message"],
        "The request is too large for the selected model context window."
    );
    assert_provider_error_text_is_sanitized(
        &text,
        &[
            "sk-frame-secret",
            "context_length_exceeded",
            "prompt is too long",
        ],
    );
    assert!(!text.contains(api_key));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-stream-error-frame-secret-abcd",
        "provider stream error frame classification",
    )
    .await;
}

#[tokio::test]
async fn chat_provider_oversized_stream_error_frame_is_bounded_and_sanitized() {
    let api_key = "sk-stream-oversized-frame-secret-abcd";
    let oversized = format!(
        "data: {{\"error\":{{\"message\":\"{} raw-provider-body sk-oversized-frame-secret Authorization: Bearer secret Cookie: secret /Users/example/private /home/example/private\"}}}}\n\n",
        "x".repeat(16 * 1024)
    );
    let stream_body: &'static str = Box::leak(oversized.into_boxed_str());
    let (base_url, auth_receiver) = start_mock_provider(StatusCode::OK, stream_body).await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    send_user_message(app.clone(), "chat-stream-oversized-error-frame").await;

    let loaded = wait_for_chat_messages(app.clone(), "chat-stream-oversized-error-frame", 2).await;
    assert_eq!(loaded["messages"][1]["role"], "error");
    assert_eq!(
        loaded["messages"][1]["content"],
        "Provider stream ended unexpectedly."
    );
    assert_provider_error_text_is_sanitized(
        &loaded.to_string(),
        &[
            "sk-oversized-frame-secret",
            "raw-provider-body",
            "Authorization",
            "Cookie",
            "/Users/example",
            "/home/example",
        ],
    );

    let text = sse_text_from(
        app,
        "/v1/chats/subscribe?chat_id=chat-stream-oversized-error-frame",
    )
    .await;
    let events = sse_json_events(&text);
    let error = find_error_event(&events);
    assert_eq!(error["payload"]["code"], "provider_malformed_stream");
    assert_eq!(
        error["payload"]["message"],
        "Provider stream ended unexpectedly."
    );
    assert_provider_error_text_is_sanitized(
        &text,
        &[
            "sk-oversized-frame-secret",
            "raw-provider-body",
            "Authorization",
            "Cookie",
            "/Users/example",
            "/home/example",
        ],
    );
    assert!(!text.contains(api_key));
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-stream-oversized-frame-secret-abcd",
        "provider oversized stream error frame",
    )
    .await;
}

#[tokio::test]
async fn malformed_provider_chunk_produces_safe_error_event() {
    let api_key = "sk-malformed-stream-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: { not-json, api_key=raw-provider-body, url=http://user:pass@127.0.0.1 }\n\n",
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-malformed-stream-secret-abcd",
        "malformed provider chunk",
    )
    .await;
}

#[tokio::test]
async fn streaming_chat_does_not_require_yet_ai_backend_account_or_cloud_url() {
    let api_key = "sk-local-only-stream-secret-abcd";
    let (base_url, auth_receiver) = start_mock_provider(
        StatusCode::OK,
        "data: {\"choices\":[{\"delta\":{\"content\":\"local\"}}]}\n\ndata: [DONE]\n\n",
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
    assert_first_auth_and_no_immediate_extra_auth(
        auth_receiver,
        "Bearer sk-local-only-stream-secret-abcd",
        "local-only streaming chat",
    )
    .await;
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

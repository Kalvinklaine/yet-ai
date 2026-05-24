use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request, StatusCode};
use axum::response::IntoResponse;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
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
    expected_auth: Option<&'static str>,
) -> (String, oneshot::Receiver<Option<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (auth_sender, auth_receiver) = oneshot::channel();
    let expected = expected_auth.map(str::to_string);
    let auth_sender = std::sync::Arc::new(std::sync::Mutex::new(Some(auth_sender)));
    tokio::spawn(async move {
        let handler = move |request: axum::http::Request<Body>| {
            let expected = expected.clone();
            let auth_sender = auth_sender.clone();
            async move {
                let auth = request
                    .headers()
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                if let Some(sender) = auth_sender.lock().unwrap().take() {
                    let _ = sender.send(auth.clone());
                }
                if let Some(expected) = expected {
                    assert_eq!(auth.as_deref(), Some(expected.as_str()));
                }
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

fn sse_json_events(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .map(|data| serde_json::from_str(data).unwrap())
        .collect()
}

async fn empty_response_from(app: axum::Router, request: Request<Body>) -> StatusCode {
    app.oneshot(request).await.unwrap().status()
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
    assert!(start["authorizationUrl"].as_str().unwrap().starts_with("http://127.0.0.1/mock-oauth/authorize"));
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
        authed_request(Method::GET, "/v1/provider-auth/openai/status", Body::empty()),
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
        authed_request(Method::GET, "/v1/provider-auth/openai/status", Body::empty()),
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
        authed_request(Method::GET, "/v1/provider-auth/openai/status", Body::empty()),
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
        assert!(!body.to_string().contains(base_url));
        assert!(!body.to_string().contains("sk-invalid-url-secret-abcd"));
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
    assert_eq!(body["ok"], true);
    assert_eq!(body["cloudRequired"], false);
    assert!(!body.to_string().to_lowercase().contains("account"));
}

#[tokio::test]
async fn user_message_command_is_accepted() {
    let command =
        include_str!("../../../packages/contracts/examples/engine/user-message-command.json");
    let (status, body) = json_response(authed_request(
        Method::POST,
        "/v1/chats/chat-001/commands",
        Body::from(command),
    ))
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["accepted"], true);
    assert_eq!(body["chatId"], "chat-001");
}

#[tokio::test]
async fn unsupported_command_is_rejected() {
    let command = json!({
        "requestId": "req-002",
        "type": "tool_decision",
        "payload": {}
    });
    let response = test_app()
        .oneshot(authed_request(
            Method::POST,
            "/v1/chats/chat-001/commands",
            Body::from(command.to_string()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
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
    let auth = auth_receiver.await.unwrap();
    assert_eq!(auth.as_deref(), Some("Bearer sk-stream-secret-abcd"));
    assert!(!text.contains(api_key));
}

#[tokio::test]
async fn provider_unauthorized_produces_sanitized_error_event() {
    let api_key = "sk-unauthorized-secret-abcd";
    let (base_url, _) = start_mock_provider(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        Some("Bearer sk-unauthorized-secret-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    let command = json!({
        "requestId": "req-unauthorized",
        "type": "user_message",
        "payload": { "content": "hello" }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-unauthorized/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-unauthorized").await;
    let events = sse_json_events(&text);
    let error = events
        .iter()
        .find(|event| event["type"] == "error")
        .unwrap();
    assert_eq!(error["payload"]["code"], "provider_unauthorized");
    assert!(!text.contains(api_key));
    assert!(!text.contains("unauthorized-secret"));
}

#[tokio::test]
async fn malformed_provider_chunk_produces_safe_error_event() {
    let api_key = "sk-malformed-stream-secret-abcd";
    let (base_url, _) = start_mock_provider(
        StatusCode::OK,
        "data: { not-json }\n\n",
        Some("Bearer sk-malformed-stream-secret-abcd"),
    )
    .await;
    let app = test_app();
    configure_openai_provider(app.clone(), base_url, api_key).await;
    let command = json!({
        "requestId": "req-malformed",
        "type": "user_message",
        "payload": { "content": "hello" }
    });
    let (status, _) = json_response_from(
        app.clone(),
        authed_request(
            Method::POST,
            "/v1/chats/chat-malformed/commands",
            Body::from(command.to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let text = sse_text_from(app, "/v1/chats/subscribe?chat_id=chat-malformed").await;
    let events = sse_json_events(&text);
    let error = events
        .iter()
        .find(|event| event["type"] == "error")
        .unwrap();
    assert_eq!(error["payload"]["code"], "provider_malformed_stream");
    assert!(!text.contains(api_key));
}

#[tokio::test]
async fn streaming_chat_does_not_require_yet_ai_backend_account_or_cloud_url() {
    let api_key = "sk-local-only-stream-secret-abcd";
    let (base_url, _) = start_mock_provider(
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

use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;
use yet_lsp::identity::ProductIdentity;
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
    assert_eq!(default_bind_addr(8001).ip(), std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
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
    let (status, body) = json_response(authed_request(Method::GET, "/v1/ping", Body::empty())).await;
    let identity: Value = serde_json::from_str(include_str!("../../../product/identity.json")).unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["productId"], identity["product"]["id"]);
    assert_eq!(body["displayName"], identity["product"]["displayName"]);
    assert_eq!(body["ready"], true);
}

#[tokio::test]
async fn caps_returns_local_direct_runtime() {
    let (status, body) = json_response(authed_request(Method::GET, "/v1/caps", Body::empty())).await;
    let identity: Value = serde_json::from_str(include_str!("../../../product/identity.json")).unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["productId"], identity["product"]["id"]);
    assert_eq!(body["runtime"]["mode"], "local");
    assert_eq!(body["runtime"]["cloudRequired"], false);
    assert_eq!(body["runtime"]["providerAccess"], "direct");
    assert!(body["capabilities"].as_array().unwrap().contains(&json!("chat")));
    assert!(body["capabilities"].as_array().unwrap().contains(&json!("sse")));
    assert!(body["capabilities"].as_array().unwrap().contains(&json!("providers")));
    assert!(body["capabilities"].as_array().unwrap().contains(&json!("bridge")));
}

#[tokio::test]
async fn providers_returns_empty_secret_free_registry() {
    let (status, body) = json_response(authed_request(Method::GET, "/v1/providers", Body::empty())).await;
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
    let (status, body) = json_response(authed_request(Method::GET, "/v1/models", Body::empty())).await;
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
        authed_request(Method::POST, "/v1/providers", Body::from(provider.to_string())),
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
        authed_request(Method::POST, "/v1/providers", Body::from(provider.to_string())),
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
        authed_request(Method::POST, "/v1/providers", Body::from(provider.to_string())),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["baseUrl"], "http://127.0.0.1:11434");

    let status = empty_response_from(
        app.clone(),
        authed_request(Method::DELETE, "/v1/providers/delete-provider", Body::empty()),
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
        authed_request(Method::POST, "/v1/providers", Body::from(provider.to_string())),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let config_file = paths.config_dir.join("providers.d/storage-provider.json");
    assert!(config_file.exists());
    assert!(config_file.starts_with(paths.config_dir.join("providers.d")));
    assert!(!paths.project_dir.join("providers.d/storage-provider.json").exists());
    let stored = std::fs::read_to_string(config_file).unwrap();
    assert!(stored.contains(api_key));
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
        authed_request(Method::POST, "/v1/providers", Body::from(provider.to_string())),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["baseUrl"], "http://127.0.0.1:11434");

    let (status, body) = json_response_from(
        app,
        authed_request(Method::POST, "/v1/providers/local-only-provider/test", Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["cloudRequired"], false);
    assert!(!body.to_string().to_lowercase().contains("account"));
}

#[tokio::test]
async fn user_message_command_is_accepted() {
    let command = include_str!("../../../packages/contracts/examples/engine/user-message-command.json");
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

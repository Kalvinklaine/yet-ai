use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;
use yet_lsp::identity::ProductIdentity;
use yet_lsp::storage::resolve_storage_paths;
use yet_lsp::{app, default_bind_addr, AppState, AuthToken};

const TEST_TOKEN: &str = "test-token";

fn test_app() -> axum::Router {
    app(AppState::new(
        ProductIdentity::load().unwrap(),
        AuthToken::new(TEST_TOKEN).unwrap(),
    ))
}

fn authed_request(method: Method, uri: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {TEST_TOKEN}"))
        .body(body)
        .unwrap()
}

async fn json_response(request: Request<Body>) -> (StatusCode, Value) {
    let response = test_app().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
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

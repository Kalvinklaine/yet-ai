use axum::body::Body;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::OriginalUri;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::middleware::{from_fn, Next};
use axum::response::sse::{KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Component, PathBuf};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::agent_progress;
use crate::chat::ChatContext;
use crate::chat_history;
use crate::demo_mode;
use crate::logging::{log_event, EngineLogLevel};
use crate::project_memory;
use crate::provider_auth;
use crate::providers;
use crate::security::{Authenticated, RuntimeCaller, CALLER_HEADER_NAME};
use crate::AppState;

const V1_BODY_LIMIT_BYTES: usize = 256 * 1024;
const WEB_UI_BOOTSTRAP: &str = r#"<script>window.__yetAiInitialRuntimeConfig={runtimeAccess:"same_origin_proxy",runtimeBaseUrl:"/",runtimeProxyBaseUrl:"/"};</script>"#;
const WEB_UI_DIST_DIR_ENV: &str = "YET_AI_WEB_UI_DIST_DIR";

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(web_ui_index))
        .route("/index.html", get(web_ui_index))
        .route("/assets/*asset_path", get(web_ui_asset))
        .nest(
            "/v1",
            Router::new()
                .route("/ping", get(ping))
                .route("/caps", get(caps))
                .route("/demo-mode", get(demo_mode_get).post(demo_mode_set))
                .route("/providers", get(providers_list).post(providers_create))
                .route(
                    "/providers/:provider_id",
                    get(providers_get)
                        .patch(providers_update)
                        .delete(providers_delete),
                )
                .route("/providers/:provider_id/test", post(providers_test))
                .route("/provider-auth/:provider/start", post(provider_auth_start))
                .route("/provider-auth/:provider/status", get(provider_auth_status))
                .route(
                    "/provider-auth/:provider/exchange",
                    post(provider_auth_exchange),
                )
                .route(
                    "/provider-auth/:provider/disconnect",
                    post(provider_auth_disconnect),
                )
                .route("/models", get(models_list))
                .route("/agent-progress", get(agent_progress_list))
                .route("/agent-progress/events", post(agent_progress_event))
                .route(
                    "/project-memory",
                    get(project_memory_list).post(project_memory_create),
                )
                .route("/project-memory/search", post(project_memory_search))
                .route(
                    "/project-memory/:note_id",
                    get(project_memory_get)
                        .patch(project_memory_update)
                        .delete(project_memory_delete),
                )
                .route("/chats", get(chats_list).post(chats_create))
                .route("/chats/subscribe", get(chats_subscribe))
                .route("/chats/:chat_id", get(chats_get).delete(chats_delete))
                .route("/chats/:chat_id/commands", post(chat_command))
                .layer(DefaultBodyLimit::max(V1_BODY_LIMIT_BYTES))
                .layer(from_fn(request_summary_middleware)),
        )
        .layer(cors_layer())
        .with_state(state)
}

async fn web_ui_index(headers: HeaderMap) -> Response {
    if !web_ui_request_uses_loopback_host(&headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read_to_string(web_ui_dist_dir().join("index.html")).await {
        Ok(index_html) => match inject_web_ui_bootstrap(&index_html) {
            Ok(html) => html_response(html),
            Err(message) => web_ui_unavailable(message),
        },
        Err(error) => web_ui_unavailable(format!(
            "Built Web UI is missing at {}. Run `npm --prefix apps/gui run build` or set {WEB_UI_DIST_DIR_ENV} to a built GUI dist directory. ({error})",
            web_ui_dist_dir().join("index.html").display()
        )),
    }
}

async fn web_ui_asset(headers: HeaderMap, Path(asset_path): Path<String>) -> Response {
    if !web_ui_request_uses_loopback_host(&headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(relative_path) = safe_web_ui_asset_path(&asset_path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let asset_path = web_ui_dist_dir().join("assets").join(relative_path);
    match tokio::fs::read(&asset_path).await {
        Ok(bytes) => {
            let content_type = web_ui_content_type(&asset_path);
            (
                [(header::CONTENT_TYPE, HeaderValue::from_static(content_type))],
                bytes,
            )
                .into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn web_ui_dist_dir() -> PathBuf {
    std::env::var_os(WEB_UI_DIST_DIR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("apps/gui/dist"))
}

fn web_ui_request_uses_loopback_host(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get(header::HOST) else {
        return false;
    };
    let Ok(host) = host.to_str() else {
        return false;
    };
    let host = host.trim();
    if host.contains('@') || host.contains('/') || host.contains('?') || host.contains('#') {
        return false;
    }
    let hostname = if let Some(rest) = host.strip_prefix('[') {
        let Some((hostname, port)) = rest.split_once(']') else {
            return false;
        };
        if !port.is_empty() && !port.strip_prefix(':').is_some_and(valid_port) {
            return false;
        }
        hostname
    } else if let Some((hostname, port)) = host.rsplit_once(':') {
        if !valid_port(port) {
            return false;
        }
        hostname
    } else {
        host
    };
    matches!(hostname.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost" | "::1")
}

fn valid_port(port: &str) -> bool {
    !port.is_empty() && port.chars().all(|value| value.is_ascii_digit())
}

fn inject_web_ui_bootstrap(index_html: &str) -> Result<String, String> {
    let Some(script_index) = index_html.find("<script type=\"module\"") else {
        return Err("Built Web UI index.html does not contain a Vite module script.".to_string());
    };
    let mut html = String::with_capacity(index_html.len() + WEB_UI_BOOTSTRAP.len() + 1);
    html.push_str(&index_html[..script_index]);
    html.push_str(WEB_UI_BOOTSTRAP);
    html.push('\n');
    html.push_str(&index_html[script_index..]);
    Ok(html)
}

fn html_response(html: String) -> Response {
    (
        [(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"))],
        html,
    )
        .into_response()
}

fn web_ui_unavailable(message: String) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"))],
        message,
    )
        .into_response()
}

fn safe_web_ui_asset_path(asset_path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(asset_path.trim_start_matches('/'));
    if path.components().all(|component| matches!(component, Component::Normal(_))) {
        Some(path)
    } else {
        None
    }
}

fn web_ui_content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

async fn request_summary_middleware(request: Request<Body>, next: Next) -> Response {
    let metadata = RequestSummaryLogFields::from_request(&request);
    let response = next.run(request).await;
    if let Some(mut metadata) = metadata {
        metadata.result_status = response.status().as_u16();
        metadata.log();
    }
    response
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequestSummaryLogFields {
    pub method: String,
    pub endpoint: String,
    pub auth_header_present: bool,
    pub caller: RuntimeCaller,
    pub result_status: u16,
}

fn request_summary_path(request: &Request<Body>) -> &str {
    request
        .extensions()
        .get::<OriginalUri>()
        .map(|uri| uri.path())
        .unwrap_or_else(|| request.uri().path())
}

impl RequestSummaryLogFields {
    fn from_request(request: &Request<Body>) -> Option<Self> {
        let endpoint = selected_request_summary_endpoint(request_summary_path(request))?;
        Some(Self {
            method: request.method().as_str().to_string(),
            endpoint: endpoint.to_string(),
            auth_header_present: request.headers().contains_key(header::AUTHORIZATION),
            caller: RuntimeCaller::from_headers(request.headers()),
            result_status: 0,
        })
    }

    fn log(&self) {
        log_event(
            EngineLogLevel::Info,
            "http.request.summary",
            &[
                ("method", &self.method as &dyn std::fmt::Display),
                ("endpoint", &self.endpoint as &dyn std::fmt::Display),
                (
                    "auth_header_present",
                    &self.auth_header_present as &dyn std::fmt::Display,
                ),
                ("caller", &self.caller.as_str() as &dyn std::fmt::Display),
                (
                    "result_status",
                    &self.result_status as &dyn std::fmt::Display,
                ),
            ],
        );
    }
}

fn selected_request_summary_endpoint(path: &str) -> Option<&str> {
    if matches!(path, "/v1/ping" | "/v1/models" | "/v1/providers")
        || path.starts_with("/v1/provider-auth/")
    {
        Some(path)
    } else {
        None
    }
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            is_allowed_loopback_origin(origin)
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            http::HeaderName::from_static(CALLER_HEADER_NAME),
        ])
}

fn is_allowed_loopback_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    if origin.contains('?') || origin.contains('#') || origin.contains('@') {
        return false;
    }
    let Some(authority) = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
    else {
        return false;
    };
    let Some((host, port)) = authority.rsplit_once(':') else {
        return false;
    };
    !port.is_empty()
        && port.chars().all(|value| value.is_ascii_digit())
        && matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

fn invalid_json_body(rejection: JsonRejection) -> Response {
    let status = match rejection.status() {
        StatusCode::BAD_REQUEST
        | StatusCode::PAYLOAD_TOO_LARGE
        | StatusCode::UNSUPPORTED_MEDIA_TYPE => rejection.status(),
        _ => StatusCode::BAD_REQUEST,
    };
    (status, Json(json!({ "error": "invalid request body" }))).into_response()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub product_id: String,
    pub display_name: String,
    pub version: String,
    pub ready: bool,
    pub server_time: String,
}

async fn ping(_auth: Authenticated, State(state): State<AppState>) -> Json<PingResponse> {
    Json(PingResponse {
        product_id: state.identity.product.id,
        display_name: state.identity.product.display_name,
        version: env!("CARGO_PKG_VERSION").to_string(),
        ready: true,
        server_time: Utc::now().to_rfc3339(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsResponse {
    pub product_id: String,
    pub protocol_version: String,
    pub runtime: RuntimeCaps,
    pub capabilities: Vec<String>,
    pub features: Features,
    pub providers: Vec<ProviderCaps>,
    pub ide: IdeCaps,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCaps {
    pub mode: String,
    pub cloud_required: bool,
    pub provider_access: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    pub tools: bool,
    pub tasks: bool,
    pub knowledge: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCaps {
    pub id: String,
    pub display_name: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_family: Option<providers::ProviderFamily>,
    pub models: Vec<ProviderModelCaps>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelCaps {
    pub id: String,
    pub display_name: String,
    pub capabilities: providers::ModelCapabilities,
    pub readiness: providers::ModelReadiness,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_provenance: Option<providers::ModelCapabilityProvenance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_availability: Option<providers::LocalAvailability>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_family: Option<providers::ProviderFamily>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeCaps {
    pub bridge: bool,
    pub lsp: bool,
    pub host: String,
}

async fn caps(_auth: Authenticated, State(state): State<AppState>) -> Response {
    let provider_list = match providers::provider_summaries(&state.storage_paths.config_dir).await {
        Ok(providers) => providers,
        Err(error) => return provider_error(error),
    };
    Json(CapsResponse {
        product_id: state.identity.product.id,
        protocol_version: "2026-05-15".to_string(),
        runtime: RuntimeCaps {
            mode: "local".to_string(),
            cloud_required: false,
            provider_access: "direct".to_string(),
        },
        capabilities: vec![
            "chat".to_string(),
            "sse".to_string(),
            "providers".to_string(),
            "bridge".to_string(),
        ],
        features: Features {
            tools: false,
            tasks: false,
            knowledge: false,
        },
        providers: provider_list
            .into_iter()
            .map(|provider| ProviderCaps {
                id: provider.id,
                display_name: provider.display_name,
                enabled: provider.enabled,
                provider_family: provider.provider_family,
                models: provider
                    .models
                    .into_iter()
                    .map(|model| ProviderModelCaps {
                        id: model.id,
                        display_name: model.display_name,
                        capabilities: model.capabilities,
                        readiness: model.readiness,
                        capability_provenance: model.capability_provenance,
                        local_availability: model.local_availability,
                        provider_family: model.provider_family,
                    })
                    .collect(),
            })
            .collect(),
        ide: IdeCaps {
            bridge: true,
            lsp: false,
            host: "local".to_string(),
        },
    })
    .into_response()
}

async fn providers_list(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match providers::registry(&state.storage_paths.config_dir).await {
        Ok(registry) => Json(registry).into_response(),
        Err(error) => provider_error(error),
    }
}

async fn demo_mode_get(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match demo_mode::get(&state.storage_paths.config_dir).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => demo_mode_error(error),
    }
}

async fn demo_mode_set(
    _auth: Authenticated,
    State(state): State<AppState>,
    request: Result<Json<demo_mode::DemoModeWriteRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match demo_mode::set(&state.storage_paths.config_dir, request.enabled).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => demo_mode_error(error),
    }
}

fn demo_mode_error(error: demo_mode::DemoModeError) -> Response {
    (error.status(), Json(json!({ "error": error.to_string() }))).into_response()
}

async fn providers_create(
    _auth: Authenticated,
    State(state): State<AppState>,
    request: Result<Json<providers::ProviderWriteRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match providers::create_provider_config(&state.storage_paths.config_dir, request).await {
        Ok(provider) => (StatusCode::CREATED, Json(provider.summary())).into_response(),
        Err(error) => provider_error(error),
    }
}

async fn providers_get(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Response {
    match providers::provider_summary(&state.storage_paths.config_dir, &provider_id).await {
        Ok(provider) => Json(provider).into_response(),
        Err(error) => provider_error(error),
    }
}

async fn providers_update(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    request: Result<Json<providers::ProviderWriteRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match providers::update_provider_config(&state.storage_paths.config_dir, &provider_id, request)
        .await
    {
        Ok(provider) => Json(provider.summary()).into_response(),
        Err(error) => provider_error(error),
    }
}

async fn providers_delete(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Response {
    match providers::delete_provider_config(&state.storage_paths.config_dir, &provider_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => provider_error(error),
    }
}

async fn providers_test(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Response {
    match providers::test_provider(&state.storage_paths.config_dir, &provider_id).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => provider_error(error),
    }
}

async fn provider_auth_status(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider): Path<String>,
) -> Response {
    provider_auth_response(provider_auth::status(&state.storage_paths.config_dir, &provider).await)
}

async fn provider_auth_start(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider): Path<String>,
    request: Result<Json<provider_auth::ProviderAuthStartRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    provider_auth_response(
        provider_auth::start(&state.storage_paths.config_dir, &provider, request).await,
    )
}

async fn provider_auth_exchange(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider): Path<String>,
    request: Result<Json<provider_auth::ProviderAuthExchangeRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    provider_auth_response(
        provider_auth::exchange(&state.storage_paths.config_dir, &provider, request).await,
    )
}

async fn provider_auth_disconnect(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider): Path<String>,
    request: Result<Json<provider_auth::ProviderAuthDisconnectRequest>, JsonRejection>,
) -> Response {
    let Json(_request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    provider_auth_response(
        provider_auth::disconnect(&state.storage_paths.config_dir, &provider).await,
    )
}

fn provider_auth_response(
    result: Result<provider_auth::ProviderAuthResponse, provider_auth::ProviderAuthError>,
) -> Response {
    match result {
        Ok(response) => Json(response).into_response(),
        Err(error) => (error.status(), Json(json!({ "error": error.to_string() }))).into_response(),
    }
}

async fn models_list(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match providers::models(&state.storage_paths.config_dir).await {
        Ok(models) => Json(models).into_response(),
        Err(error) => provider_error(error),
    }
}

async fn agent_progress_list(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match agent_progress::load_progress_with_runtime(
        &state.storage_paths.cache_dir,
        &state.agent_progress_runtime,
    )
    .await
    {
        Ok(response) => Json(response).into_response(),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn agent_progress_event(
    _auth: Authenticated,
    State(state): State<AppState>,
    request: Result<Json<agent_progress::AgentProgressEvent>, JsonRejection>,
) -> Response {
    let Json(event) = match request {
        Ok(event) => event,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match state.agent_progress_runtime.publish_event(event).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn project_memory_list(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match project_memory::list(&state.storage_paths.config_dir).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => project_memory_error(error),
    }
}

async fn project_memory_create(
    _auth: Authenticated,
    State(state): State<AppState>,
    request: Result<Json<project_memory::ProjectMemoryCreateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match project_memory::create(&state.storage_paths.config_dir, request).await {
        Ok(note) => (StatusCode::CREATED, Json(note)).into_response(),
        Err(error) => project_memory_error(error),
    }
}

async fn project_memory_get(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(note_id): Path<String>,
) -> Response {
    match project_memory::get(&state.storage_paths.config_dir, &note_id).await {
        Ok(note) => Json(note).into_response(),
        Err(error) => project_memory_error(error),
    }
}

async fn project_memory_update(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(note_id): Path<String>,
    request: Result<Json<project_memory::ProjectMemoryUpdateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match project_memory::update(&state.storage_paths.config_dir, &note_id, request).await {
        Ok(note) => Json(note).into_response(),
        Err(error) => project_memory_error(error),
    }
}

async fn project_memory_delete(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(note_id): Path<String>,
) -> Response {
    match project_memory::delete(&state.storage_paths.config_dir, &note_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => project_memory_error(error),
    }
}

async fn project_memory_search(
    _auth: Authenticated,
    State(state): State<AppState>,
    request: Result<Json<project_memory::ProjectMemorySearchRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match project_memory::search(&state.storage_paths.config_dir, request).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => project_memory_error(error),
    }
}

fn project_memory_error(error: project_memory::ProjectMemoryError) -> Response {
    (error.status(), Json(json!({ "error": error.to_string() }))).into_response()
}

async fn chats_list(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match chat_history::list_threads(&state.storage_paths.config_dir).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => chat_history_error(error),
    }
}

async fn chats_create(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match chat_history::create_thread(&state.storage_paths.config_dir).await {
        Ok(thread) => (StatusCode::CREATED, Json(thread)).into_response(),
        Err(error) => chat_history_error(error),
    }
}

async fn chats_get(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
) -> Response {
    if chat_history::validate_chat_id(&chat_id).is_err() {
        return invalid_chat_id_response();
    }
    match chat_history::get_thread(&state.storage_paths.config_dir, &chat_id).await {
        Ok(thread) => Json(thread).into_response(),
        Err(error) => chat_history_error(error),
    }
}

async fn chats_delete(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
) -> Response {
    if chat_history::validate_chat_id(&chat_id).is_err() {
        return invalid_chat_id_response();
    }
    match chat_history::delete_thread(&state.storage_paths.config_dir, &chat_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => chat_history_error(error),
    }
}

fn chat_history_error(error: chat_history::ChatHistoryError) -> Response {
    let status = error.status();
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}

fn invalid_chat_id_response() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": "invalid chat id" })),
    )
        .into_response()
}

fn provider_error(error: providers::ProviderError) -> Response {
    let status = error.status();
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}

const CHAT_COMMAND_REQUEST_ID_MAX_LENGTH: usize = 128;
const CHAT_COMMAND_CONTENT_MAX_LENGTH: usize = 20_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChatCommandRequest {
    request_id: String,
    #[serde(rename = "type")]
    command_type: String,
    payload: Option<serde_json::Value>,
}

async fn chat_command(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
    command: Result<Json<ChatCommandRequest>, JsonRejection>,
) -> Response {
    if chat_history::validate_chat_id(&chat_id).is_err() {
        return invalid_chat_id_response();
    }
    let Json(command) = match command {
        Ok(command) => command,
        Err(rejection) => return invalid_json_body(rejection),
    };
    if !valid_bounded_string(&command.request_id, CHAT_COMMAND_REQUEST_ID_MAX_LENGTH) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    match command.command_type.as_str() {
        "abort" => {
            if !valid_abort_payload(command.payload.as_ref()) {
                return StatusCode::BAD_REQUEST.into_response();
            }
            state.chat_runtime.accept_abort(&chat_id).await;
            Json(json!({
                "accepted": true,
                "chatId": chat_id,
                "requestId": command.request_id,
                "type": command.command_type
            }))
            .into_response()
        }
        "user_message" => {
            let Some((content, context)) = user_message_payload(command.payload.as_ref()) else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            state
                .chat_runtime
                .accept_user_message(
                    state.storage_paths.config_dir.clone(),
                    chat_id.clone(),
                    content.to_string(),
                    context,
                )
                .await;

            Json(json!({
                "accepted": true,
                "chatId": chat_id,
                "requestId": command.request_id,
                "type": command.command_type
            }))
            .into_response()
        }
        _ => (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "unsupported command type" })),
        )
            .into_response(),
    }
}

fn valid_bounded_string(value: &str, max_length: usize) -> bool {
    !value.is_empty() && value.chars().count() <= max_length && !value.chars().any(is_c0_c1_control)
}

fn valid_chat_message_content(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= CHAT_COMMAND_CONTENT_MAX_LENGTH
        && !value
            .chars()
            .any(|value| is_c0_c1_control(value) && !matches!(value, '\n' | '\r' | '\t'))
}

fn is_c0_c1_control(value: char) -> bool {
    matches!(value as u32, 0x00..=0x1f | 0x7f..=0x9f)
}

fn valid_abort_payload(payload: Option<&serde_json::Value>) -> bool {
    match payload {
        None => true,
        Some(serde_json::Value::Object(object)) => object.is_empty(),
        Some(_) => false,
    }
}

fn user_message_payload(
    payload: Option<&serde_json::Value>,
) -> Option<(&str, Option<ChatContext>)> {
    let object = payload?.as_object()?;
    if object.len() > 2
        || !object.contains_key("content")
        || object
            .keys()
            .any(|key| key != "content" && key != "context")
    {
        return None;
    }
    let content = object.get("content")?.as_str()?;
    if !valid_chat_message_content(content) {
        return None;
    }
    let context = match object.get("context") {
        Some(value) => Some(ChatContext::from_value(value.clone())?),
        None => None,
    };
    Some((content, context))
}

#[derive(Debug, Deserialize)]
struct SubscribeQuery {
    #[serde(rename = "chat_id")]
    chat_id: Option<String>,
}

async fn chats_subscribe(
    _auth: Authenticated,
    State(state): State<AppState>,
    query: Result<Query<SubscribeQuery>, QueryRejection>,
) -> Response {
    let Query(query) = match query {
        Ok(query) => query,
        Err(_) => return invalid_chat_id_response(),
    };
    let Some(chat_id) = query.chat_id else {
        return invalid_chat_id_response();
    };
    if chat_history::validate_chat_id(&chat_id).is_err() {
        return invalid_chat_id_response();
    }
    let stream = state
        .chat_runtime
        .subscribe(state.storage_paths.config_dir.clone(), chat_id)
        .await;
    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(std::time::Duration::from_secs(30))
                .text("keep-alive"),
        )
        .into_response()
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use axum::response::Response;
    use http_body_util::BodyExt;
    use std::path::PathBuf;
    use tower::ServiceExt;

    use crate::identity::ProductIdentity;
    use crate::security::AuthToken;
    use crate::storage::{resolve_storage_paths, StoragePaths};
    use crate::AppState;

    static TEST_DIR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    static HTTP_LOG_TEST_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
        std::sync::OnceLock::new();
    static WEB_UI_TEST_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
        std::sync::OnceLock::new();

    fn http_log_test_lock() -> &'static tokio::sync::Mutex<()> {
        HTTP_LOG_TEST_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
    }

    fn web_ui_test_lock() -> &'static tokio::sync::Mutex<()> {
        WEB_UI_TEST_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
    }

    fn temp_storage_paths() -> StoragePaths {
        let root = std::env::temp_dir().join(format!(
            "yet-ai-http-provider-auth-test-{}-{}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        let identity = ProductIdentity::load().unwrap();
        resolve_storage_paths(&identity, &root, &root, &root)
    }

    fn temp_web_ui_dist() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "yet-ai-http-web-ui-test-{}-{}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("assets")).unwrap();
        root
    }

    fn test_app() -> axum::Router {
        let identity = ProductIdentity::load().unwrap();
        super::router(AppState::with_storage_paths(
            identity,
            AuthToken::new("test-token").unwrap(),
            temp_storage_paths(),
        ))
    }

    async fn response_text(response: Response) -> String {
        String::from_utf8(response.into_body().collect().await.unwrap().to_bytes().to_vec())
            .unwrap()
    }

    async fn post_provider_auth(path: &str, body: &'static str) -> StatusCode {
        let identity = ProductIdentity::load().unwrap();
        let state = AppState::with_storage_paths(
            identity,
            AuthToken::new("test-token").unwrap(),
            temp_storage_paths(),
        );
        let response = super::router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let _ = response.into_body().collect().await.unwrap();
        status
    }

    #[tokio::test]
    async fn web_ui_index_injects_same_origin_bootstrap_before_module_script_without_token() {
        let _guard = web_ui_test_lock().lock().await;
        let dist = temp_web_ui_dist();
        std::fs::write(
            dist.join("index.html"),
            r#"<!doctype html><html><head><title>Yet</title></head><body><div id="root"></div><script type="module" crossorigin src="/assets/index-test.js"></script></body></html>"#,
        )
        .unwrap();
        std::env::set_var(super::WEB_UI_DIST_DIR_ENV, &dist);

        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header(header::HOST, "127.0.0.1:8001")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        std::env::remove_var(super::WEB_UI_DIST_DIR_ENV);

        assert_eq!(response.status(), StatusCode::OK);
        let html = response_text(response).await;
        let config_index = html.find("window.__yetAiInitialRuntimeConfig").unwrap();
        let module_index = html.find("<script type=\"module\"").unwrap();
        assert!(config_index < module_index);
        assert!(html.contains("runtimeAccess:\"same_origin_proxy\""));
        assert!(html.contains("runtimeBaseUrl:\"/\""));
        assert!(html.contains("runtimeProxyBaseUrl:\"/\""));
        assert!(!html.contains("test-token"));
        assert!(!html.contains("Authorization"));
        let _ = std::fs::remove_dir_all(dist);
    }

    #[tokio::test]
    async fn web_ui_missing_index_returns_clear_diagnostic() {
        let _guard = web_ui_test_lock().lock().await;
        let dist = temp_web_ui_dist();
        std::env::set_var(super::WEB_UI_DIST_DIR_ENV, &dist);

        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header(header::HOST, "127.0.0.1:8001")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        std::env::remove_var(super::WEB_UI_DIST_DIR_ENV);

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let message = response_text(response).await;
        assert!(message.contains("Built Web UI is missing"));
        assert!(message.contains("npm --prefix apps/gui run build"));
        assert!(!message.contains("test-token"));
        let _ = std::fs::remove_dir_all(dist);
    }

    #[tokio::test]
    async fn web_ui_index_rejects_non_loopback_host() {
        let _guard = web_ui_test_lock().lock().await;
        let dist = temp_web_ui_dist();
        std::fs::write(
            dist.join("index.html"),
            r#"<html><body><script type="module" src="/assets/index-test.js"></script></body></html>"#,
        )
        .unwrap();
        std::env::set_var(super::WEB_UI_DIST_DIR_ENV, &dist);

        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header(header::HOST, "example.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        std::env::remove_var(super::WEB_UI_DIST_DIR_ENV);

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let _ = response.into_body().collect().await.unwrap();
        let _ = std::fs::remove_dir_all(dist);
    }

    #[tokio::test]
    async fn web_ui_asset_serves_built_asset_from_loopback_host() {
        let _guard = web_ui_test_lock().lock().await;
        let dist = temp_web_ui_dist();
        std::fs::write(dist.join("assets/index-test.js"), "console.log('yet');").unwrap();
        std::env::set_var(super::WEB_UI_DIST_DIR_ENV, &dist);

        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/assets/index-test.js")
                    .header(header::HOST, "localhost:8001")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        std::env::remove_var(super::WEB_UI_DIST_DIR_ENV);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(response_text(response).await, "console.log('yet');");
        let _ = std::fs::remove_dir_all(dist);
    }

    #[tokio::test]
    async fn web_ui_route_does_not_disable_v1_authentication() {
        let _web_ui_guard = web_ui_test_lock().lock().await;
        let _http_log_guard = http_log_test_lock().lock().await;
        let dist = temp_web_ui_dist();
        std::fs::write(
            dist.join("index.html"),
            r#"<html><body><script type="module" src="/assets/index-test.js"></script></body></html>"#,
        )
        .unwrap();
        std::env::set_var(super::WEB_UI_DIST_DIR_ENV, &dist);

        let response = test_app()
            .oneshot(Request::builder().uri("/v1/ping").body(Body::empty()).unwrap())
            .await
            .unwrap();
        std::env::remove_var(super::WEB_UI_DIST_DIR_ENV);

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let _ = response.into_body().collect().await.unwrap();
        let _ = std::fs::remove_dir_all(dist);
    }

    async fn get_models_with_auth(auth_header: Option<&'static str>) -> StatusCode {
        get_models_with_auth_and_caller(auth_header, None).await
    }

    async fn get_models_with_auth_and_caller(
        auth_header: Option<&'static str>,
        caller: Option<&'static str>,
    ) -> StatusCode {
        let identity = ProductIdentity::load().unwrap();
        let state = AppState::with_storage_paths(
            identity,
            AuthToken::new("test-token").unwrap(),
            temp_storage_paths(),
        );
        let mut builder = Request::builder()
            .method("GET")
            .uri("/v1/models?token=query-secret&next=/Users/alice");
        if let Some(auth_header) = auth_header {
            builder = builder.header(header::AUTHORIZATION, auth_header);
        }
        if let Some(caller) = caller {
            builder = builder.header(crate::security::CALLER_HEADER_NAME, caller);
        }
        let response = super::router(state)
            .oneshot(builder.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let _ = response.into_body().collect().await.unwrap();
        status
    }

    fn auth_reject_lines() -> Vec<String> {
        crate::logging::test_log_lines()
            .into_iter()
            .filter(|line| line.contains("http.auth.reject"))
            .collect()
    }

    fn model_request_summary_lines() -> Vec<String> {
        crate::logging::test_log_lines()
            .into_iter()
            .filter(|line| {
                line.contains("http.request.summary") && line.contains("endpoint=/v1/models")
            })
            .collect()
    }

    #[tokio::test]
    async fn missing_authorization_returns_401_and_logs_missing_header() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(None).await;
        let lines = auth_reject_lines();

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("endpoint=/v1/models"));
        assert!(lines[0].contains("auth_header_present=false"));
        assert!(lines[0].contains("reason=missing_header"));
    }

    #[tokio::test]
    async fn malformed_bearer_returns_401_and_logs_token_mismatch() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(Some("Basic raw-token")).await;
        let lines = auth_reject_lines();

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("auth_header_present=true"));
        assert!(lines[0].contains("reason=token_mismatch"));
    }

    #[tokio::test]
    async fn empty_bearer_returns_401_and_logs_empty_bearer() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(Some("Bearer ")).await;
        let lines = auth_reject_lines();

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("auth_header_present=true"));
        assert!(lines[0].contains("reason=empty_bearer"));
    }

    #[tokio::test]
    async fn wrong_bearer_returns_401_and_logs_token_mismatch() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(Some("Bearer wrong-token")).await;
        let lines = auth_reject_lines();

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("endpoint=/v1/models"));
        assert!(lines[0].contains("auth_header_present=true"));
        assert!(lines[0].contains("reason=token_mismatch"));
    }

    #[tokio::test]
    async fn auth_reject_logs_allowlisted_caller() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth_and_caller(None, Some("gui_runtime_client")).await;
        let lines = auth_reject_lines();

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("caller=gui_runtime_client"));
        assert!(!lines[0].contains("X-Yet-AI-Caller"));
    }

    #[tokio::test]
    async fn auth_reject_normalizes_malicious_caller_to_unknown() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth_and_caller(None, Some("jetbrains_health_evil")).await;
        let lines = auth_reject_lines();

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("caller=unknown"));
        assert!(!lines[0].contains("jetbrains_health_evil"));
    }

    #[tokio::test]
    async fn correct_bearer_does_not_log_auth_reject() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(Some("Bearer test-token")).await;
        let lines = auth_reject_lines();

        assert_ne!(status, StatusCode::UNAUTHORIZED);
        assert!(lines.is_empty());
    }

    #[tokio::test]
    async fn logs_exclude_queries_tokens_and_private_paths() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(Some("Bearer wrong-token")).await;
        let all_lines = crate::logging::test_log_lines().join("\n");

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        for unsafe_value in [
            "query-secret",
            "wrong-token",
            "test-token",
            "/Users/alice",
            "next=",
        ] {
            assert!(
                !all_lines.contains(unsafe_value),
                "leaked {unsafe_value}: {all_lines}"
            );
        }
        assert!(all_lines.contains("endpoint=/v1/models"));
    }

    #[tokio::test]
    async fn selected_request_summary_logs_safe_fields() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(Some("Bearer test-token")).await;
        let lines = model_request_summary_lines();

        assert_ne!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("method=GET"));
        assert!(lines[0].contains("endpoint=/v1/models"));
        assert!(lines[0].contains("auth_header_present=true"));
        assert!(lines[0].contains("result_status="));
        assert!(!lines[0].contains("test-token"));
        assert!(!lines[0].contains("query-secret"));
    }

    #[tokio::test]
    async fn selected_request_summary_logs_allowlisted_caller() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status =
            get_models_with_auth_and_caller(Some("Bearer test-token"), Some("jetbrains_health"))
                .await;
        let lines = model_request_summary_lines();

        assert_ne!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("caller=jetbrains_health"));
        assert!(!lines[0].contains("test-token"));
    }

    #[tokio::test]
    async fn selected_request_summary_normalizes_malicious_caller_to_unknown() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth_and_caller(
            Some("Bearer test-token"),
            Some("gui_runtime_client_evil"),
        )
        .await;
        let lines = model_request_summary_lines();

        assert_ne!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("caller=unknown"));
        assert!(!lines[0].contains("gui_runtime_client_evil"));
    }

    #[tokio::test]
    async fn provider_auth_disconnect_rejects_non_empty_json_body() {
        let status = post_provider_auth(
            "/v1/provider-auth/openai/disconnect",
            r#"{"token":"secret"}"#,
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn provider_auth_disconnect_accepts_empty_object_body() {
        let status = post_provider_auth("/v1/provider-auth/openai/disconnect", r#"{}"#).await;

        assert_eq!(status, StatusCode::OK);
    }
}

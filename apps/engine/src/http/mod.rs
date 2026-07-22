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
use crate::project_browser::ProjectBrowserError;
use crate::project_memory;
use crate::projects::ProjectRegistryError;
use crate::provider_auth;
use crate::providers;
use crate::security::{Authenticated, RuntimeCaller, CALLER_HEADER_NAME};
use crate::AppState;

mod project;

const V1_BODY_LIMIT_BYTES: usize = 256 * 1024;
const WEB_UI_BOOTSTRAP: &str = r#"<script>window.__yetAiInitialRuntimeConfig={runtimeAccess:"same_origin_proxy",runtimeBaseUrl:"/",runtimeProxyBaseUrl:"/"};</script>"#;
const WEB_UI_DIST_DIR_ENV: &str = "YET_AI_WEB_UI_DIST_DIR";

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(web_ui_index))
        .route("/index.html", get(web_ui_index))
        .route("/projects", get(web_ui_index))
        .route("/projects/legacy", get(web_ui_index))
        .route("/settings", get(web_ui_index))
        .route("/p/:project_id/", get(web_ui_project_index))
        .route("/p/:project_id/chat", get(web_ui_project_index))
        .route(
            "/p/:project_id/chat/:chat_id",
            get(web_ui_project_chat_index),
        )
        .route("/p/:project_id/memory", get(web_ui_project_index))
        .route("/p/:project_id/agent", get(web_ui_project_index))
        .route("/_yet_ai/browser-session", get(browser_session))
        .route("/assets/*asset_path", get(web_ui_asset))
        .nest(
            "/p/:project_id/v1",
            project::scoped_router()
                .layer(DefaultBodyLimit::max(V1_BODY_LIMIT_BYTES))
                .layer(from_fn(request_summary_middleware)),
        )
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
                .route("/projects", get(project::list))
                .route(
                    "/projects/:project_id",
                    get(project::get).patch(project::update),
                )
                .route("/projects/:project_id/archive", post(project::archive))
                .route("/projects/:project_id/restore", post(project::restore))
                .route("/agent-progress", get(agent_progress_list))
                .route("/agent-progress/events", post(agent_progress_event))
                .route(
                    "/project-browser/sessions",
                    post(project_browser_session_create),
                )
                .route(
                    "/project-browser/sessions/:session_id/list",
                    post(project_browser_list),
                )
                .route("/projects", post(project_register))
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

async fn web_ui_index(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !web_ui_request_uses_loopback_host(&headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read_to_string(web_ui_dist_dir().join("index.html")).await {
        Ok(index_html) => match inject_web_ui_bootstrap(&index_html, None) {
            Ok(html) => html_response(html, &state),
            Err(message) => web_ui_unavailable(message),
        },
        Err(error) => web_ui_unavailable(format!(
            "Built Web UI is missing at {}. Run `npm --prefix apps/gui run build` or set {WEB_UI_DIST_DIR_ENV} to a built GUI dist directory. ({error})",
            web_ui_dist_dir().join("index.html").display()
        )),
    }
}

async fn web_ui_project_index(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<String>,
) -> Response {
    web_ui_project_response(state, headers, project_id).await
}

async fn web_ui_project_chat_index(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_id, chat_id)): Path<(String, String)>,
) -> Response {
    if chat_history::validate_chat_id(&chat_id).is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }
    web_ui_project_response(state, headers, project_id).await
}

async fn web_ui_project_response(
    state: AppState,
    headers: HeaderMap,
    project_id: String,
) -> Response {
    if !web_ui_request_uses_loopback_host(&headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if project::public_summary(&state, &project_id).await.is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read_to_string(web_ui_dist_dir().join("index.html")).await {
        Ok(index_html) => match inject_web_ui_bootstrap(&index_html, Some(&project_id)) {
            Ok(html) => html_response(html, &state),
            Err(message) => web_ui_unavailable(message),
        },
        Err(error) => web_ui_unavailable(format!(
            "Built Web UI is missing. Run `npm --prefix apps/gui run build` or set {WEB_UI_DIST_DIR_ENV}. ({error})"
        )),
    }
}

async fn browser_session(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !web_ui_request_uses_loopback_host(&headers) {
        return StatusCode::NOT_FOUND.into_response();
    }
    (
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, browser_session_cookie(&state))],
    )
        .into_response()
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
    matches!(
        hostname.to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1"
    )
}

fn valid_port(port: &str) -> bool {
    !port.is_empty() && port.chars().all(|value| value.is_ascii_digit())
}

fn inject_web_ui_bootstrap(index_html: &str, project_id: Option<&str>) -> Result<String, String> {
    let Some(script_index) = index_html.find("<script type=\"module\"") else {
        return Err("Built Web UI index.html does not contain a Vite module script.".to_string());
    };
    let project_bootstrap = project_id.map(|project_id| {
        format!(
            r#"<script>window.__yetAiInitialRuntimeConfig={{runtimeAccess:"same_origin_proxy",runtimeBaseUrl:"/",runtimeProxyBaseUrl:"/",projectId:"{project_id}",projectApiBase:"/p/{project_id}/v1"}};</script>"#
        )
    });
    let bootstrap = project_bootstrap.as_deref().unwrap_or(WEB_UI_BOOTSTRAP);
    let mut html = String::with_capacity(index_html.len() + bootstrap.len() + 1);
    html.push_str(&index_html[..script_index]);
    html.push_str(bootstrap);
    html.push('\n');
    html.push_str(&index_html[script_index..]);
    Ok(html)
}

fn html_response(html: String, state: &AppState) -> Response {
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            ),
            (header::SET_COOKIE, browser_session_cookie(state)),
        ],
        html,
    )
        .into_response()
}

fn browser_session_cookie(state: &AppState) -> HeaderValue {
    HeaderValue::from_str(&state.browser_session_id.cookie_value()).unwrap()
}

fn web_ui_unavailable(message: String) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; charset=utf-8"),
        )],
        message,
    )
        .into_response()
}

fn safe_web_ui_asset_path(asset_path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(asset_path.trim_start_matches('/'));
    if path
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectoryListRequest {
    directory_handle: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectRegisterRequest {
    display_name: String,
    directory_session_id: String,
    directory_handle: String,
}

async fn project_browser_session_create(
    _auth: Authenticated,
    State(state): State<AppState>,
    request: Result<Json<EmptyProjectBrowserRequest>, JsonRejection>,
) -> Response {
    if let Err(rejection) = request {
        return invalid_json_body(rejection);
    }
    match state.project_browser_runtime.create_session().await {
        Ok(response) => (StatusCode::CREATED, Json(response)).into_response(),
        Err(error) => project_browser_error(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyProjectBrowserRequest {}

async fn project_browser_list(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    request: Result<Json<DirectoryListRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match state
        .project_browser_runtime
        .list(&session_id, &request.directory_handle)
        .await
    {
        Ok(response) => Json(response).into_response(),
        Err(error) => project_browser_error(error),
    }
}

async fn project_register(
    _auth: Authenticated,
    State(state): State<AppState>,
    request: Result<Json<ProjectRegisterRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_json_body(rejection),
    };
    match state
        .project_browser_runtime
        .register(
            &state.project_registry_runtime,
            &request.directory_session_id,
            &request.directory_handle,
            &request.display_name,
        )
        .await
    {
        Ok(summary) => (StatusCode::CREATED, Json(summary)).into_response(),
        Err(ProjectBrowserError::Registry(error)) => project_registry_error(error),
        Err(error) => project_browser_error(error),
    }
}

fn project_browser_error(error: ProjectBrowserError) -> Response {
    let (status, category) = match error {
        ProjectBrowserError::InvalidRequest | ProjectBrowserError::LimitReached => {
            (StatusCode::BAD_REQUEST, "invalid_request")
        }
        ProjectBrowserError::DiscoveryExpired => (StatusCode::GONE, "discovery_expired"),
        ProjectBrowserError::OutsideAllowedRoot => (StatusCode::FORBIDDEN, "outside_allowed_root"),
        ProjectBrowserError::UnsafeFilesystem => (StatusCode::FORBIDDEN, "unsafe_filesystem"),
        ProjectBrowserError::Registry(_) => {
            (StatusCode::SERVICE_UNAVAILABLE, "storage_unavailable")
        }
    };
    (status, Json(json!({ "error": category }))).into_response()
}

fn project_registry_error(error: ProjectRegistryError) -> Response {
    let (status, category) = match error {
        ProjectRegistryError::InvalidRequest
        | ProjectRegistryError::Conflict
        | ProjectRegistryError::LimitReached => (StatusCode::BAD_REQUEST, "invalid_request"),
        ProjectRegistryError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
        ProjectRegistryError::Archived => (StatusCode::CONFLICT, "archived"),
        ProjectRegistryError::RootUnavailable => (StatusCode::CONFLICT, "root_missing"),
        ProjectRegistryError::Storage => (StatusCode::SERVICE_UNAVAILABLE, "storage_unavailable"),
    };
    (status, Json(json!({ "error": category }))).into_response()
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
        provider_auth::start_with_callback_port(
            &state.storage_paths.config_dir,
            &provider,
            request,
            state.provider_auth_callback_port,
        )
        .await,
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

async fn project_chats_list(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Response {
    let context = match project::resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match chat_history::list_threads_in(&context.storage().chat_history).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => chat_history_error(error),
    }
}

async fn project_chats_create(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Response {
    let context = match project::resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match chat_history::create_thread_in(&context.storage().chat_history).await {
        Ok(thread) => (StatusCode::CREATED, Json(thread)).into_response(),
        Err(error) => chat_history_error(error),
    }
}

async fn project_chats_get(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path((project_id, chat_id)): Path<(String, String)>,
) -> Response {
    let context = match project_chat_context(&state, &project_id, &chat_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match chat_history::get_thread_in(&context.storage().chat_history, &chat_id).await {
        Ok(thread) => Json(thread).into_response(),
        Err(error) => chat_history_error(error),
    }
}

async fn project_chats_delete(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path((project_id, chat_id)): Path<(String, String)>,
) -> Response {
    let context = match project_chat_context(&state, &project_id, &chat_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match chat_history::delete_thread_in(&context.storage().chat_history, &chat_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => chat_history_error(error),
    }
}

async fn project_chat_context(
    state: &AppState,
    project_id: &str,
    chat_id: &str,
) -> Result<crate::projects::ProjectContext, Response> {
    if chat_history::validate_chat_id(chat_id).is_err() {
        return Err(invalid_chat_id_response());
    }
    let context = project::resolve_context(state, project_id).await?;
    match chat_history::get_thread_in(&context.storage().chat_history, chat_id).await {
        Ok(_) => Ok(context),
        Err(chat_history::ChatHistoryError::NotFound) => {
            Err(chat_history_error(chat_history::ChatHistoryError::NotFound))
        }
        Err(error) => Err(chat_history_error(error)),
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

async fn project_chat_command(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path((project_id, chat_id)): Path<(String, String)>,
    command: Result<Json<ChatCommandRequest>, JsonRejection>,
) -> Response {
    let context = match project_chat_context(&state, &project_id, &chat_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
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
            state
                .chat_runtime
                .accept_abort_in(context.project_id(), &chat_id)
                .await;
        }
        "user_message" => {
            let Some((content, chat_context)) = user_message_payload(command.payload.as_ref())
            else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            state
                .chat_runtime
                .accept_user_message_in(
                    context.project_id(),
                    state.storage_paths.config_dir.clone(),
                    context.storage().chat_history.clone(),
                    chat_id.clone(),
                    content.to_string(),
                    chat_context,
                )
                .await;
        }
        _ => {
            return (
                StatusCode::NOT_IMPLEMENTED,
                Json(json!({ "error": "unsupported command type" })),
            )
                .into_response();
        }
    }
    Json(json!({
        "accepted": true,
        "chatId": chat_id,
        "requestId": command.request_id,
        "type": command.command_type
    }))
    .into_response()
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

async fn project_chats_subscribe(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    query: Result<Query<SubscribeQuery>, QueryRejection>,
) -> Response {
    let Query(query) = match query {
        Ok(query) => query,
        Err(_) => return invalid_chat_id_response(),
    };
    let Some(chat_id) = query.chat_id else {
        return invalid_chat_id_response();
    };
    let context = match project_chat_context(&state, &project_id, &chat_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    let stream = state
        .chat_runtime
        .subscribe_in(
            context.project_id(),
            context.storage().chat_history.clone(),
            chat_id,
        )
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
mod project_tests {
    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use axum::response::Response;
    use http_body_util::BodyExt;
    use std::path::PathBuf;
    use tower::ServiceExt;

    use crate::identity::ProductIdentity;
    use crate::project_browser::ProjectBrowserRuntime;
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
        String::from_utf8(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn project_browser_http_registers_without_path_transport_and_consumes_handle() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join("Selected")).unwrap();
        let identity = ProductIdentity::load().unwrap();
        let mut state = AppState::with_storage_paths(
            identity,
            AuthToken::new("test-token").unwrap(),
            temp_storage_paths(),
        );
        state.project_browser_runtime =
            ProjectBrowserRuntime::with_home(Some(home.path().to_path_buf()));
        let app = super::router(state);

        let session_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/project-browser/sessions")
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(session_response.status(), StatusCode::CREATED);
        let session: serde_json::Value =
            serde_json::from_str(&response_text(session_response).await).unwrap();
        let session_id = session["sessionId"].as_str().unwrap();
        let root_handle = session["root"]["handle"].as_str().unwrap();
        let session_json = session.to_string();
        assert!(!session_json.contains(home.path().to_str().unwrap()));

        let list_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/project-browser/sessions/{session_id}/list"))
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"directoryHandle":"{root_handle}"}}"#
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(list_response.status(), StatusCode::OK);
        let list: serde_json::Value =
            serde_json::from_str(&response_text(list_response).await).unwrap();
        let selected_handle = list["entries"][0]["handle"].as_str().unwrap();
        assert_eq!(list["entries"][0]["displayName"], "Selected");
        assert!(!list.to_string().contains(home.path().to_str().unwrap()));

        let body = format!(
            r#"{{"displayName":"Selected","directorySessionId":"{session_id}","directoryHandle":"{selected_handle}"}}"#
        );
        let registered = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/projects")
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(registered.status(), StatusCode::CREATED);
        let registered_body = response_text(registered).await;
        assert!(!registered_body.contains(home.path().to_str().unwrap()));
        assert!(!registered_body.contains(selected_handle));

        let replayed = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/projects")
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(replayed.status(), StatusCode::GONE);
        assert_eq!(
            response_text(replayed).await,
            r#"{"error":"discovery_expired"}"#
        );
    }

    #[tokio::test]
    async fn project_browser_http_requires_auth_and_rejects_raw_path_fields() {
        let app = test_app();
        let unauthenticated = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/project-browser/sessions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
        let raw_path = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/projects")
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"displayName":"Unsafe","directorySessionId":"pds_00000000000000000000000000000000","directoryHandle":"dir_00000000000000000000000000000000","path":"/private"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(raw_path.status(), StatusCode::BAD_REQUEST);
        assert!(!response_text(raw_path).await.contains("/private"));
    }

    fn browser_session_cookie_for_state(state: &AppState) -> String {
        state
            .browser_session_id
            .cookie_value()
            .split(';')
            .next()
            .unwrap()
            .to_string()
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
        let set_cookie = response.headers().get(header::SET_COOKIE).unwrap();
        let set_cookie = set_cookie.to_str().unwrap();
        assert!(set_cookie.starts_with("yet_ai_loopback_session="));
        assert!(set_cookie.contains("HttpOnly"));
        assert!(set_cookie.contains("SameSite=Strict"));
        assert!(set_cookie.contains("Path=/"));
        assert!(!set_cookie.contains("test-token"));
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

    async fn project_test_state() -> (AppState, String, PathBuf) {
        let identity = ProductIdentity::load().unwrap();
        let paths = temp_storage_paths();
        let root = paths.project_dir.parent().unwrap().join(format!(
            "private-project-root-{}",
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&root).unwrap();
        let state =
            AppState::with_storage_paths(identity, AuthToken::new("test-token").unwrap(), paths);
        let summary = state
            .project_registry_runtime
            .register(&root, Some("HTTP project"))
            .await
            .unwrap();
        (state, summary.project_id, root)
    }

    async fn project_request(
        state: AppState,
        method: &str,
        uri: String,
        body: &'static str,
        authenticated: bool,
    ) -> Response {
        let mut builder = Request::builder().method(method).uri(uri);
        if authenticated {
            builder = builder.header(header::AUTHORIZATION, "Bearer test-token");
        }
        if !body.is_empty() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        super::router(state)
            .oneshot(builder.body(Body::from(body)).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn project_control_routes_require_auth_and_apply_revision_lifecycle() {
        let (state, project_id, root) = project_test_state().await;
        let unauthenticated =
            project_request(state.clone(), "GET", "/v1/projects".to_string(), "", false).await;
        assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

        let list =
            project_request(state.clone(), "GET", "/v1/projects".to_string(), "", true).await;
        assert_eq!(list.status(), StatusCode::OK);
        let list_body = response_text(list).await;
        assert!(list_body.contains(&project_id));
        assert!(!list_body.contains(root.to_str().unwrap()));

        let detail = project_request(
            state.clone(),
            "GET",
            format!("/v1/projects/{project_id}"),
            "",
            true,
        )
        .await;
        assert_eq!(detail.status(), StatusCode::OK);
        assert!(response_text(detail).await.contains("HTTP project"));

        let unknown = project_request(
            state.clone(),
            "GET",
            "/v1/projects/prj_AAAAAAAAAAAAAAAAAAAAAA".to_string(),
            "",
            true,
        )
        .await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        let unknown_body = response_text(unknown).await;
        assert!(unknown_body.contains("not_found"));
        assert!(!unknown_body.contains("prj_AAAAAAAAAAAAAAAAAAAAAA"));

        let renamed = project_request(
            state.clone(),
            "PATCH",
            format!("/v1/projects/{project_id}"),
            r#"{"displayName":"Renamed","expectedRevision":"1"}"#,
            true,
        )
        .await;
        assert_eq!(renamed.status(), StatusCode::OK);
        let renamed_body = response_text(renamed).await;
        assert!(renamed_body.contains("\"revision\":\"2\""));

        let stale = project_request(
            state.clone(),
            "POST",
            format!("/v1/projects/{project_id}/archive"),
            r#"{"expectedRevision":"1"}"#,
            true,
        )
        .await;
        assert_eq!(stale.status(), StatusCode::BAD_REQUEST);
        assert!(response_text(stale).await.contains("invalid_request"));

        let archived = project_request(
            state.clone(),
            "POST",
            format!("/v1/projects/{project_id}/archive"),
            r#"{"expectedRevision":"2"}"#,
            true,
        )
        .await;
        assert_eq!(archived.status(), StatusCode::OK);
        assert!(response_text(archived)
            .await
            .contains("\"status\":\"archived\""));

        let restored = project_request(
            state.clone(),
            "POST",
            format!("/v1/projects/{project_id}/restore"),
            r#"{"expectedRevision":"3"}"#,
            true,
        )
        .await;
        assert_eq!(restored.status(), StatusCode::OK);
        assert!(response_text(restored).await.contains("\"revision\":\"4\""));
        assert_eq!(
            project_request(
                state,
                "DELETE",
                format!("/v1/projects/{project_id}"),
                "",
                true
            )
            .await
            .status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[tokio::test]
    async fn project_scoped_routes_resolve_context_without_using_legacy_storage() {
        let (state, project_id, root) = project_test_state().await;
        let unauthenticated = project_request(
            state.clone(),
            "GET",
            format!("/p/{project_id}/v1/chats"),
            "",
            false,
        )
        .await;
        assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
        let scoped = project_request(
            state.clone(),
            "GET",
            format!("/p/{project_id}/v1/chats"),
            "",
            true,
        )
        .await;
        assert_eq!(scoped.status(), StatusCode::OK);
        assert_eq!(response_text(scoped).await, r#"{"chats":[]}"#);
        assert!(!state.storage_paths.config_dir.join("chat-history").exists());

        let unknown = project_request(
            state.clone(),
            "GET",
            "/p/prj_AAAAAAAAAAAAAAAAAAAAAA/v1/project-memory".to_string(),
            "",
            true,
        )
        .await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert!(!response_text(unknown)
            .await
            .contains(root.to_str().unwrap()));

        let archived = state
            .project_registry_runtime
            .archive(&project_id, "1")
            .await
            .unwrap();
        let archived_response = project_request(
            state.clone(),
            "GET",
            format!("/p/{project_id}/v1/agent-progress"),
            "",
            true,
        )
        .await;
        assert_eq!(archived_response.status(), StatusCode::CONFLICT);
        assert!(response_text(archived_response).await.contains("archived"));
        state
            .project_registry_runtime
            .restore(&project_id, &archived.revision)
            .await
            .unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        let missing =
            project_request(state, "GET", format!("/p/{project_id}/v1/chats"), "", true).await;
        assert_eq!(missing.status(), StatusCode::CONFLICT);
        assert!(response_text(missing).await.contains("root_missing"));
    }

    #[tokio::test]
    async fn project_scoped_requests_keep_concurrent_contexts_independent() {
        let (state, first_id, first_root) = project_test_state().await;
        let second_root = first_root
            .parent()
            .unwrap()
            .join("private-second-project-root");
        std::fs::create_dir_all(&second_root).unwrap();
        let second_id = state
            .project_registry_runtime
            .register(&second_root, Some("Second"))
            .await
            .unwrap()
            .project_id;
        let first = project_request(
            state.clone(),
            "GET",
            format!("/p/{first_id}/v1/chats"),
            "",
            true,
        );
        let second = project_request(state, "GET", format!("/p/{second_id}/v1/chats"), "", true);
        let (first, second) = tokio::join!(first, second);
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(second.status(), StatusCode::OK);
        let _ = std::fs::remove_dir_all(first_root.parent().unwrap());
    }

    #[tokio::test]
    async fn project_chat_crud_isolates_same_id_and_legacy_history() {
        let (state, first_id, first_root) = project_test_state().await;
        let second_root = first_root
            .parent()
            .unwrap()
            .join("private-chat-second-root");
        std::fs::create_dir_all(&second_root).unwrap();
        let second_id = state
            .project_registry_runtime
            .register(&second_root, Some("Second chat"))
            .await
            .unwrap()
            .project_id;
        let first_context = state
            .project_registry_runtime
            .resolve_context(&state.storage_paths, &first_id)
            .await
            .unwrap();
        let second_context = state
            .project_registry_runtime
            .resolve_context(&state.storage_paths, &second_id)
            .await
            .unwrap();
        for (root, content) in [
            (&first_context.storage().chat_history, "first"),
            (&second_context.storage().chat_history, "second"),
        ] {
            crate::chat_history::append_message_in(
                root,
                "chat_same",
                crate::chat_history::ChatMessageRole::User,
                content.to_string(),
                Some(crate::chat_history::ChatMessageStatus::Complete),
            )
            .await
            .unwrap();
        }
        crate::chat_history::append_message(
            &state.storage_paths.config_dir,
            "chat_same",
            crate::chat_history::ChatMessageRole::User,
            "legacy".to_string(),
            Some(crate::chat_history::ChatMessageStatus::Complete),
        )
        .await
        .unwrap();

        for (project_id, expected) in [(&first_id, "first"), (&second_id, "second")] {
            let list = project_request(
                state.clone(),
                "GET",
                format!("/p/{project_id}/v1/chats"),
                "",
                true,
            )
            .await;
            assert_eq!(list.status(), StatusCode::OK);
            let list_body = response_text(list).await;
            assert!(list_body.contains("chat_same"));
            assert!(!list_body.contains("legacy"));
            let response = project_request(
                state.clone(),
                "GET",
                format!("/p/{project_id}/v1/chats/chat_same"),
                "",
                true,
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            let body = response_text(response).await;
            assert!(body.contains(expected));
            assert!(!body.contains("legacy"));
        }

        let deleted = project_request(
            state.clone(),
            "DELETE",
            format!("/p/{first_id}/v1/chats/chat_same"),
            "",
            true,
        )
        .await;
        assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
        let wrong_project = project_request(
            state.clone(),
            "GET",
            format!("/p/{first_id}/v1/chats/chat_same"),
            "",
            true,
        )
        .await;
        assert_eq!(wrong_project.status(), StatusCode::NOT_FOUND);
        let wrong_project_command = project_request(
            state.clone(),
            "POST",
            format!("/p/{first_id}/v1/chats/chat_same/commands"),
            r#"{"requestId":"known-id","type":"abort","payload":{}}"#,
            true,
        )
        .await;
        assert_eq!(wrong_project_command.status(), StatusCode::NOT_FOUND);
        let wrong_project_stream = project_request(
            state.clone(),
            "GET",
            format!("/p/{first_id}/v1/chats/subscribe?chat_id=chat_same"),
            "",
            true,
        )
        .await;
        assert_eq!(wrong_project_stream.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            crate::chat_history::get_thread_in(&second_context.storage().chat_history, "chat_same")
                .await
                .unwrap()
                .messages[0]
                .content,
            "second"
        );
        assert_eq!(
            crate::chat_history::get_thread(&state.storage_paths.config_dir, "chat_same")
                .await
                .unwrap()
                .messages[0]
                .content,
            "legacy"
        );
        let created =
            project_request(state, "POST", format!("/p/{first_id}/v1/chats"), "", true).await;
        assert_eq!(created.status(), StatusCode::CREATED);
        assert!(response_text(created).await.contains("chat_"));
        let _ = std::fs::remove_dir_all(first_root.parent().unwrap());
    }

    #[tokio::test]
    async fn project_spa_deep_links_are_allowlisted_and_html_is_private() {
        let _guard = web_ui_test_lock().lock().await;
        let dist = temp_web_ui_dist();
        std::fs::write(
            dist.join("index.html"),
            r#"<html><body><script type="module" src="/assets/index-test.js"></script></body></html>"#,
        )
        .unwrap();
        std::env::set_var(super::WEB_UI_DIST_DIR_ENV, &dist);
        let (state, project_id, root) = project_test_state().await;

        for path in ["/projects", "/projects/legacy", "/settings"] {
            let response = super::router(state.clone())
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header(header::HOST, "127.0.0.1:8001")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
        }
        for path in [
            format!("/p/{project_id}/"),
            format!("/p/{project_id}/chat"),
            format!("/p/{project_id}/chat/chat_1"),
            format!("/p/{project_id}/memory"),
            format!("/p/{project_id}/agent"),
        ] {
            let response = super::router(state.clone())
                .oneshot(
                    Request::builder()
                        .uri(&path)
                        .header(header::HOST, "127.0.0.1:8001")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let html = response_text(response).await;
            assert!(html.contains(&format!("projectId:\"{project_id}\"")));
            assert!(html.contains(&format!("projectApiBase:\"/p/{project_id}/v1\"")));
            assert!(!html.contains(root.to_str().unwrap()));
            assert!(!html.contains("test-token"));
        }
        for path in [
            "/projectz".to_string(),
            format!("/p/{project_id}/unknown"),
            "/p/not-a-project/chat".to_string(),
            format!("/p/{project_id}/chat/../bad"),
        ] {
            let response = super::router(state.clone())
                .oneshot(
                    Request::builder()
                        .uri(&path)
                        .header(header::HOST, "127.0.0.1:8001")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
        std::env::remove_var(super::WEB_UI_DIST_DIR_ENV);
        let _ = std::fs::remove_dir_all(dist);
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[tokio::test]
    async fn browser_session_endpoint_sets_cookie_without_body_or_token() {
        let response = test_app()
            .oneshot(
                Request::builder()
                    .uri("/_yet_ai/browser-session")
                    .header(header::HOST, "127.0.0.1:8001")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let set_cookie = response.headers().get(header::SET_COOKIE).unwrap();
        let set_cookie = set_cookie.to_str().unwrap();
        assert!(set_cookie.starts_with("yet_ai_loopback_session="));
        assert!(set_cookie.contains("HttpOnly"));
        assert!(set_cookie.contains("SameSite=Strict"));
        assert!(set_cookie.contains("Path=/"));
        assert!(!set_cookie.contains("test-token"));
        assert!(response_text(response).await.is_empty());
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
            .oneshot(
                Request::builder()
                    .uri("/v1/ping")
                    .body(Body::empty())
                    .unwrap(),
            )
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

    async fn get_with_same_origin_web_ui_headers(
        path: &'static str,
        host: Option<&'static str>,
        caller: Option<&'static str>,
        fetch_site: Option<&'static str>,
        cookie: Option<&'static str>,
    ) -> StatusCode {
        let identity = ProductIdentity::load().unwrap();
        let state = AppState::with_storage_paths(
            identity,
            AuthToken::new("test-token").unwrap(),
            temp_storage_paths(),
        );
        let cookie = cookie
            .map(str::to_string)
            .unwrap_or_else(|| browser_session_cookie_for_state(&state));
        let mut builder = Request::builder().method("GET").uri(path);
        if let Some(host) = host {
            builder = builder.header(header::HOST, host);
        }
        if let Some(caller) = caller {
            builder = builder.header(crate::security::CALLER_HEADER_NAME, caller);
        }
        if let Some(fetch_site) = fetch_site {
            builder = builder.header("sec-fetch-site", fetch_site);
        }
        if !cookie.is_empty() {
            builder = builder.header(header::COOKIE, cookie);
        }
        let response = super::router(state)
            .oneshot(builder.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let _ = response.into_body().collect().await.unwrap();
        status
    }

    fn auth_reject_lines(endpoint: &str) -> Vec<String> {
        crate::logging::test_log_lines()
            .into_iter()
            .filter(|line| {
                line.contains("http.auth.reject") && line.contains(&format!("endpoint={endpoint}"))
            })
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
    async fn same_origin_web_ui_requests_without_authorization_return_non_401() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        for path in ["/v1/ping", "/v1/models", "/v1/caps", "/v1/demo-mode"] {
            let status = get_with_same_origin_web_ui_headers(
                path,
                Some("127.0.0.1:8001"),
                Some("gui_runtime_client"),
                Some("same-origin"),
                None,
            )
            .await;

            assert_ne!(status, StatusCode::UNAUTHORIZED, "{path}");
        }
        for endpoint in ["/v1/ping", "/v1/models", "/v1/caps", "/v1/demo-mode"] {
            assert!(auth_reject_lines(endpoint).is_empty(), "{endpoint}");
        }
    }

    #[tokio::test]
    async fn same_origin_web_ui_request_without_cookie_remains_401() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_with_same_origin_web_ui_headers(
            "/v1/ping",
            Some("127.0.0.1:8001"),
            Some("gui_runtime_client"),
            Some("same-origin"),
            Some(""),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn same_origin_web_ui_request_with_invalid_cookie_remains_401() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_with_same_origin_web_ui_headers(
            "/v1/ping",
            Some("127.0.0.1:8001"),
            Some("gui_runtime_client"),
            Some("same-origin"),
            Some("yet_ai_loopback_session=wrong-session"),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn same_origin_web_ui_request_missing_fetch_site_remains_401() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_with_same_origin_web_ui_headers(
            "/v1/ping",
            Some("127.0.0.1:8001"),
            Some("gui_runtime_client"),
            None,
            None,
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn same_origin_web_ui_request_non_loopback_host_remains_401() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_with_same_origin_web_ui_headers(
            "/v1/ping",
            Some("example.com:8001"),
            Some("gui_runtime_client"),
            Some("same-origin"),
            None,
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn same_origin_web_ui_request_malicious_caller_remains_401() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_with_same_origin_web_ui_headers(
            "/v1/ping",
            Some("127.0.0.1:8001"),
            Some("gui_runtime_client_evil"),
            Some("same-origin"),
            None,
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn missing_authorization_returns_401_and_logs_missing_header() {
        let _guard = http_log_test_lock().lock().await;
        crate::logging::clear_test_log_lines();
        let status = get_models_with_auth(None).await;
        let lines = auth_reject_lines("/v1/models");

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
        let lines = auth_reject_lines("/v1/models");

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
        let lines = auth_reject_lines("/v1/models");

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
        let lines = auth_reject_lines("/v1/models");

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
        let lines = auth_reject_lines("/v1/models");

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
        let lines = auth_reject_lines("/v1/models");

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
        let lines = auth_reject_lines("/v1/models");

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

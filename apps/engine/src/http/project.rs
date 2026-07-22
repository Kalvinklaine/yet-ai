use axum::body::Body;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use http::{Request, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;

use crate::agent_progress;
use crate::project_memory;
use crate::projects::{
    is_valid_project_id, ProjectContext, ProjectContextError, ProjectRegistryError, ProjectSummary,
};
use crate::security::Authenticated;
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectListResponse {
    projects: Vec<ProjectSummary>,
    legacy_unscoped_available: bool,
    cloud_required: bool,
    provider_access: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectUpdateRequest {
    display_name: String,
    expected_revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectLifecycleRequest {
    expected_revision: String,
}

pub(super) async fn list(_auth: Authenticated, State(state): State<AppState>) -> Response {
    match state.project_registry_runtime.list_summaries().await {
        Ok(projects) => Json(ProjectListResponse {
            projects: projects.into_iter().take(500).collect(),
            legacy_unscoped_available: legacy_unscoped_available(&state),
            cloud_required: false,
            provider_access: "direct",
        })
        .into_response(),
        Err(error) => registry_error(error),
    }
}

fn legacy_unscoped_available(state: &AppState) -> bool {
    [
        state.storage_paths.config_dir.join("chat-history"),
        state.storage_paths.config_dir.join("project-memory"),
        state.storage_paths.cache_dir.join("agent-progress"),
    ]
    .into_iter()
    .any(|path| path.is_dir())
}

pub(super) async fn get(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Response {
    match public_summary(&state, &project_id).await {
        Ok(summary) => Json(summary).into_response(),
        Err(response) => response,
    }
}

pub(super) async fn update(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    request: Result<Json<ProjectUpdateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_project_json(rejection),
    };
    match state
        .project_registry_runtime
        .update_display_name(
            &project_id,
            &request.display_name,
            &request.expected_revision,
        )
        .await
    {
        Ok(summary) => Json(summary).into_response(),
        Err(error) => registry_error(error),
    }
}

pub(super) async fn archive(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    request: Result<Json<ProjectLifecycleRequest>, JsonRejection>,
) -> Response {
    lifecycle(state, project_id, request, true).await
}

pub(super) async fn restore(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    request: Result<Json<ProjectLifecycleRequest>, JsonRejection>,
) -> Response {
    lifecycle(state, project_id, request, false).await
}

async fn lifecycle(
    state: AppState,
    project_id: String,
    request: Result<Json<ProjectLifecycleRequest>, JsonRejection>,
    archive: bool,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return invalid_project_json(rejection),
    };
    let result = if archive {
        state
            .project_registry_runtime
            .archive(&project_id, &request.expected_revision)
            .await
    } else {
        state
            .project_registry_runtime
            .restore(&project_id, &request.expected_revision)
            .await
    };
    match result {
        Ok(summary) => Json(summary).into_response(),
        Err(error) => registry_error(error),
    }
}

pub(super) async fn scoped_placeholder(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(parameters): Path<HashMap<String, String>>,
    mut request: Request<Body>,
) -> Response {
    let Some(project_id) = parameters.get("project_id") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match resolve_context(&state, &project_id).await {
        Ok(context) => {
            request.extensions_mut().insert(context);
            StatusCode::NOT_IMPLEMENTED.into_response()
        }
        Err(response) => response,
    }
}

pub(super) async fn memory_list(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Response {
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match project_memory::list(&context.storage().project_memory).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => super::project_memory_error(error),
    }
}

pub(super) async fn memory_create(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    request: Result<Json<project_memory::ProjectMemoryCreateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return super::invalid_json_body(rejection),
    };
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match project_memory::create(&context.storage().project_memory, request).await {
        Ok(note) => (StatusCode::CREATED, Json(note)).into_response(),
        Err(error) => super::project_memory_error(error),
    }
}

pub(super) async fn memory_get(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path((project_id, note_id)): Path<(String, String)>,
) -> Response {
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match project_memory::get(&context.storage().project_memory, &note_id).await {
        Ok(note) => Json(note).into_response(),
        Err(error) => super::project_memory_error(error),
    }
}

pub(super) async fn memory_update(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path((project_id, note_id)): Path<(String, String)>,
    request: Result<Json<project_memory::ProjectMemoryUpdateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return super::invalid_json_body(rejection),
    };
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match project_memory::update(&context.storage().project_memory, &note_id, request).await {
        Ok(note) => Json(note).into_response(),
        Err(error) => super::project_memory_error(error),
    }
}

pub(super) async fn memory_delete(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path((project_id, note_id)): Path<(String, String)>,
) -> Response {
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match project_memory::delete(&context.storage().project_memory, &note_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => super::project_memory_error(error),
    }
}

pub(super) async fn memory_search(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    request: Result<Json<project_memory::ProjectMemorySearchRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(rejection) => return super::invalid_json_body(rejection),
    };
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match project_memory::search(&context.storage().project_memory, request).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => super::project_memory_error(error),
    }
}

pub(super) async fn agent_progress_list(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Response {
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    match agent_progress::load_project_progress_with_runtime(
        &context.storage().agent_progress,
        context.project_id(),
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

pub(super) async fn agent_progress_event(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    request: Result<Json<agent_progress::AgentProgressEvent>, JsonRejection>,
) -> Response {
    let context = match resolve_context(&state, &project_id).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    let Json(event) = match request {
        Ok(event) => event,
        Err(rejection) => return invalid_project_json(rejection),
    };
    match state
        .agent_progress_runtime
        .publish_project_event(context.project_id(), event)
        .await
    {
        Ok(response) => Json(response).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(super) async fn resolve_context(
    state: &AppState,
    project_id: &str,
) -> Result<ProjectContext, Response> {
    state
        .project_registry_runtime
        .resolve_context(&state.storage_paths, project_id)
        .await
        .map_err(context_error)
}

pub(super) async fn public_summary(
    state: &AppState,
    project_id: &str,
) -> Result<ProjectSummary, Response> {
    if !is_valid_project_id(project_id) {
        return Err(project_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "Project not found.",
        ));
    }
    let projects = state
        .project_registry_runtime
        .list_summaries()
        .await
        .map_err(registry_error)?;
    projects
        .into_iter()
        .find(|project| project.project_id == project_id)
        .ok_or_else(|| project_error(StatusCode::NOT_FOUND, "not_found", "Project not found."))
}

fn context_error(error: ProjectContextError) -> Response {
    match error {
        ProjectContextError::NotFound => {
            project_error(StatusCode::NOT_FOUND, "not_found", "Project not found.")
        }
        ProjectContextError::Archived => {
            project_error(StatusCode::CONFLICT, "archived", "Project is archived.")
        }
        ProjectContextError::RootMissing => project_error(
            StatusCode::CONFLICT,
            "root_missing",
            "The project directory is unavailable.",
        ),
        ProjectContextError::StorageUnavailable => project_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage_unavailable",
            "Project storage is unavailable.",
        ),
    }
}

fn registry_error(error: ProjectRegistryError) -> Response {
    match error {
        ProjectRegistryError::InvalidRequest | ProjectRegistryError::Conflict => project_error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Invalid project request.",
        ),
        ProjectRegistryError::NotFound => {
            project_error(StatusCode::NOT_FOUND, "not_found", "Project not found.")
        }
        ProjectRegistryError::Archived => {
            project_error(StatusCode::CONFLICT, "archived", "Project is archived.")
        }
        ProjectRegistryError::RootUnavailable => project_error(
            StatusCode::CONFLICT,
            "root_missing",
            "The project directory is unavailable.",
        ),
        ProjectRegistryError::LimitReached => project_error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Project limit reached.",
        ),
        ProjectRegistryError::Storage => project_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage_unavailable",
            "Project storage is unavailable.",
        ),
    }
}

fn project_error(status: StatusCode, category: &'static str, message: &'static str) -> Response {
    (
        status,
        Json(json!({
            "category": category,
            "message": message,
            "cloudRequired": false,
            "providerAccess": "direct"
        })),
    )
        .into_response()
}

fn invalid_project_json(rejection: JsonRejection) -> Response {
    let status = match rejection.status() {
        StatusCode::PAYLOAD_TOO_LARGE | StatusCode::UNSUPPORTED_MEDIA_TYPE => rejection.status(),
        _ => StatusCode::BAD_REQUEST,
    };
    project_error(status, "invalid_request", "Invalid project request body.")
}

pub(super) fn scoped_router() -> Router<AppState> {
    Router::new()
        .route(
            "/chats",
            axum::routing::get(super::project_chats_list).post(super::project_chats_create),
        )
        .route(
            "/chats/subscribe",
            axum::routing::get(super::project_chats_subscribe),
        )
        .route(
            "/chats/:chat_id",
            axum::routing::get(super::project_chats_get).delete(super::project_chats_delete),
        )
        .route(
            "/chats/:chat_id/commands",
            axum::routing::post(super::project_chat_command),
        )
        .route(
            "/project-memory",
            axum::routing::get(memory_list).post(memory_create),
        )
        .route("/project-memory/search", axum::routing::post(memory_search))
        .route(
            "/project-memory/:note_id",
            axum::routing::get(memory_get)
                .patch(memory_update)
                .delete(memory_delete),
        )
        .route("/agent-progress", axum::routing::get(agent_progress_list))
        .route(
            "/agent-progress/events",
            axum::routing::post(agent_progress_event),
        )
        .route(
            "/agent-progress/*resource",
            axum::routing::any(scoped_placeholder),
        )
}

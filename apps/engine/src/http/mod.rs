use axum::extract::{Path, Query, State};
use axum::response::sse::{KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::provider_auth;
use crate::providers;
use crate::security::Authenticated;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .nest(
            "/v1",
            Router::new()
                .route("/ping", get(ping))
                .route("/caps", get(caps))
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
                .route("/chats/:chat_id/commands", post(chat_command))
                .route("/chats/subscribe", get(chats_subscribe)),
        )
        .with_state(state)
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
    pub models: Vec<ProviderModelCaps>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelCaps {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeCaps {
    pub bridge: bool,
    pub lsp: bool,
    pub host: String,
}

async fn caps(_auth: Authenticated, State(state): State<AppState>) -> Response {
    let provider_list =
        match providers::list_provider_configs(&state.storage_paths.config_dir).await {
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
                models: provider
                    .models
                    .into_iter()
                    .map(|model| ProviderModelCaps {
                        id: model.id,
                        display_name: model.display_name,
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

async fn providers_create(
    _auth: Authenticated,
    State(state): State<AppState>,
    Json(request): Json<providers::ProviderWriteRequest>,
) -> Response {
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
    match providers::get_provider_config(&state.storage_paths.config_dir, &provider_id).await {
        Ok(provider) => Json(provider.summary()).into_response(),
        Err(error) => provider_error(error),
    }
}

async fn providers_update(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    Json(request): Json<providers::ProviderWriteRequest>,
) -> Response {
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
    match providers::get_provider_config(&state.storage_paths.config_dir, &provider_id).await {
        Ok(provider) => Json(providers::ProviderTestResponse {
            ok: true,
            provider_id: provider.id,
            cloud_required: false,
            message: "configuration is valid".to_string(),
        })
        .into_response(),
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
) -> Response {
    provider_auth_response(provider_auth::start(&state.storage_paths.config_dir, &provider).await)
}

async fn provider_auth_exchange(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider): Path<String>,
) -> Response {
    provider_auth_response(
        provider_auth::exchange(&state.storage_paths.config_dir, &provider).await,
    )
}

async fn provider_auth_disconnect(
    _auth: Authenticated,
    State(state): State<AppState>,
    Path(provider): Path<String>,
) -> Response {
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

fn provider_error(error: providers::ProviderError) -> Response {
    let status = error.status();
    (status, Json(json!({ "error": error.to_string() }))).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    Json(command): Json<ChatCommandRequest>,
) -> Response {
    if chat_id.is_empty() || command.request_id.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    if command.command_type == "abort" {
        state.chat_runtime.accept_abort(&chat_id).await;
        return Json(json!({
            "accepted": true,
            "chatId": chat_id,
            "requestId": command.request_id,
            "type": command.command_type
        }))
        .into_response();
    }

    if command.command_type != "user_message" {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "unsupported command type" })),
        )
            .into_response();
    }

    let Some(payload) = command.payload else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(content) = payload.get("content").and_then(|value| value.as_str()) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if content.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    state
        .chat_runtime
        .accept_user_message(
            state.storage_paths.config_dir.clone(),
            chat_id.clone(),
            content.to_string(),
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

#[derive(Debug, Deserialize)]
struct SubscribeQuery {
    #[serde(rename = "chat_id")]
    chat_id: String,
}

async fn chats_subscribe(
    _auth: Authenticated,
    State(state): State<AppState>,
    Query(query): Query<SubscribeQuery>,
) -> Sse<
    impl futures_util::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
> {
    let stream = state.chat_runtime.subscribe(query.chat_id).await;
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(30))
            .text("keep-alive"),
    )
}

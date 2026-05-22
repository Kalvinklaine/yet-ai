use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use futures_util::stream;
use http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

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
                .route("/providers", get(providers_list))
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

async fn caps(_auth: Authenticated, State(state): State<AppState>) -> Json<CapsResponse> {
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
        providers: Vec::new(),
        ide: IdeCaps {
            bridge: true,
            lsp: false,
            host: "local".to_string(),
        },
    })
}

async fn providers_list(_auth: Authenticated) -> Json<providers::ProviderRegistrySummary> {
    Json(providers::empty_registry())
}

async fn models_list(_auth: Authenticated) -> Json<providers::ModelListResponse> {
    Json(providers::empty_models())
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
    Path(chat_id): Path<String>,
    Json(command): Json<ChatCommandRequest>,
) -> Response {
    if chat_id.is_empty() || command.request_id.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }

    if command.command_type != "user_message" {
        return (StatusCode::NOT_IMPLEMENTED, Json(json!({ "error": "unsupported command type" })))
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
    Query(query): Query<SubscribeQuery>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let data = json!({
        "seq": 0,
        "type": "snapshot",
        "chatId": query.chat_id,
        "payload": {
            "thread": {
                "id": query.chat_id,
                "title": "New chat",
                "messages": []
            },
            "runtime": {
                "streaming": false,
                "waitingForResponse": false
            }
        }
    });
    let event = Event::default().event("snapshot").data(data.to_string());
    Sse::new(stream::once(async move { Ok::<Event, Infallible>(event) })).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text("keep-alive"),
    )
}

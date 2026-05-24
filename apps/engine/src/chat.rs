use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::response::sse::Event;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::json;
use tokio::sync::{broadcast, Mutex};
use tokio_stream::wrappers::BroadcastStream;

use crate::providers::{self, AuthType, ProviderKind, StoredProviderConfig};

#[derive(Clone, Debug)]
pub struct ChatRuntime {
    inner: Arc<Mutex<HashMap<String, ChatState>>>,
    client: reqwest::Client,
}

#[derive(Debug)]
struct ChatState {
    events: Vec<ChatEvent>,
    next_seq: u64,
    sender: broadcast::Sender<ChatEvent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEvent {
    pub seq: u64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub chat_id: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    #[error("no enabled openai-compatible provider is configured")]
    NoProvider,
    #[error("provider has no configured model")]
    NoModel,
    #[error("provider authentication failed")]
    Unauthorized,
    #[error("provider request failed")]
    Request,
    #[error("provider stream timed out")]
    Timeout,
    #[error("provider returned malformed streaming data")]
    MalformedStream,
    #[error("provider config error")]
    ProviderConfig,
}

impl Default for ChatRuntime {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            client: reqwest::Client::new(),
        }
    }
}

impl ChatRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn accept_user_message(&self, config_dir: std::path::PathBuf, chat_id: String, content: String) {
        self.ensure_chat(&chat_id).await;
        let runtime = self.clone();
        tokio::spawn(async move {
            runtime.run_stream(config_dir, chat_id, content).await;
        });
    }

    pub async fn accept_abort(&self, chat_id: &str) {
        self.ensure_chat(chat_id).await;
    }

    pub async fn subscribe(
        &self,
        chat_id: String,
    ) -> impl futures_util::Stream<Item = Result<Event, Infallible>> {
        let (snapshot, replay, receiver) = {
            let mut guard = self.inner.lock().await;
            let state = guard.entry(chat_id.clone()).or_insert_with(|| ChatState::new(&chat_id));
            (snapshot_event(&chat_id), state.events.clone(), state.sender.subscribe())
        };
        let snapshot_stream = futures_util::stream::once(async move { Ok(to_sse_event(snapshot)) });
        let replay_stream = futures_util::stream::iter(
            replay.into_iter().map(|event| Ok::<Event, Infallible>(to_sse_event(event))),
        );
        let live_stream = BroadcastStream::new(receiver).filter_map(|event| async move {
            match event {
                Ok(event) => Some(Ok(to_sse_event(event))),
                Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(_)) => None,
            }
        });
        snapshot_stream.chain(replay_stream).chain(live_stream)
    }

    async fn ensure_chat(&self, chat_id: &str) {
        let mut guard = self.inner.lock().await;
        guard.entry(chat_id.to_string()).or_insert_with(|| ChatState::new(chat_id));
    }

    async fn push_event(&self, chat_id: &str, event_type: &str, payload: serde_json::Value) {
        let mut guard = self.inner.lock().await;
        let state = guard.entry(chat_id.to_string()).or_insert_with(|| ChatState::new(chat_id));
        let event = ChatEvent {
            seq: state.next_seq,
            event_type: event_type.to_string(),
            chat_id: chat_id.to_string(),
            payload,
        };
        state.next_seq += 1;
        state.events.push(event.clone());
        let _ = state.sender.send(event);
    }

    async fn run_stream(&self, config_dir: std::path::PathBuf, chat_id: String, content: String) {
        self.push_event(&chat_id, "stream_started", json!({ "role": "assistant" })).await;
        match self.stream_provider(&config_dir, &content).await {
            Ok(text) => {
                for delta in text {
                    self.push_event(&chat_id, "stream_delta", json!({ "delta": { "content": delta } }))
                        .await;
                }
                self.push_event(&chat_id, "stream_finished", json!({ "finishReason": "stop" })).await;
            }
            Err(error) => {
                self.push_event(
                    &chat_id,
                    "error",
                    json!({ "code": error.code(), "message": error.to_string() }),
                )
                .await;
            }
        }
    }

    async fn stream_provider(
        &self,
        config_dir: &std::path::Path,
        content: &str,
    ) -> Result<Vec<String>, ChatError> {
        let provider = providers::list_provider_configs(config_dir)
            .await
            .map_err(|_| ChatError::ProviderConfig)?
            .into_iter()
            .find(|provider| provider.enabled && provider.kind == ProviderKind::OpenAiCompatible)
            .ok_or(ChatError::NoProvider)?;
        let model = provider.models.first().ok_or(ChatError::NoModel)?.id.clone();
        openai_compatible_stream(&self.client, &provider, &model, content).await
    }
}

impl ChatState {
    fn new(_chat_id: &str) -> Self {
        let (sender, _) = broadcast::channel(64);
        Self {
            events: Vec::new(),
            next_seq: 1,
            sender,
        }
    }
}

impl ChatError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoProvider => "provider_not_configured",
            Self::NoModel => "model_not_configured",
            Self::Unauthorized => "provider_unauthorized",
            Self::Request => "provider_request_failed",
            Self::Timeout => "provider_timeout",
            Self::MalformedStream => "provider_malformed_stream",
            Self::ProviderConfig => "provider_config_error",
        }
    }
}

fn snapshot_event(chat_id: &str) -> ChatEvent {
    ChatEvent {
        seq: 0,
        event_type: "snapshot".to_string(),
        chat_id: chat_id.to_string(),
        payload: json!({
            "thread": {
                "id": chat_id,
                "title": "New chat",
                "messages": []
            },
            "runtime": {
                "streaming": false,
                "waitingForResponse": false
            }
        }),
    }
}

fn to_sse_event(event: ChatEvent) -> Event {
    Event::default().event(event.event_type.clone()).data(serde_json::to_string(&event).unwrap())
}

async fn openai_compatible_stream(
    client: &reqwest::Client,
    provider: &StoredProviderConfig,
    model: &str,
    content: &str,
) -> Result<Vec<String>, ChatError> {
    let url = chat_completions_url(&provider.base_url);
    let mut request = client
        .post(url)
        .timeout(Duration::from_secs(10))
        .json(&json!({
            "model": model,
            "stream": true,
            "messages": [{ "role": "user", "content": content }]
        }));
    if provider.auth.auth_type == AuthType::ApiKey {
        if let Some(api_key) = provider.auth.api_key.as_deref().filter(|value| !value.is_empty()) {
            request = request.bearer_auth(api_key);
        }
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ChatError::Timeout
        } else {
            ChatError::Request
        }
    })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(ChatError::Unauthorized);
    }
    if !response.status().is_success() {
        return Err(ChatError::Request);
    }
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut deltas = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                ChatError::Timeout
            } else {
                ChatError::Request
            }
        })?;
        let text = std::str::from_utf8(&chunk).map_err(|_| ChatError::MalformedStream)?;
        buffer.push_str(text);
        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim_end_matches('\r').to_string();
            buffer = buffer[index + 1..].to_string();
            handle_sse_line(&line, &mut deltas)?;
        }
    }
    if !buffer.trim().is_empty() {
        handle_sse_line(buffer.trim_end_matches('\r'), &mut deltas)?;
    }
    Ok(deltas)
}

fn handle_sse_line(line: &str, deltas: &mut Vec<String>) -> Result<(), ChatError> {
    let line = line.trim();
    if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
        return Ok(());
    }
    let Some(data) = line.strip_prefix("data:").map(str::trim) else {
        return Err(ChatError::MalformedStream);
    };
    if data == "[DONE]" {
        return Ok(());
    }
    let value: serde_json::Value = serde_json::from_str(data).map_err(|_| ChatError::MalformedStream)?;
    if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
        if !content.is_empty() {
            deltas.push(content.to_string());
        }
        Ok(())
    } else if value["choices"][0]["finish_reason"].is_string() {
        Ok(())
    } else {
        Err(ChatError::MalformedStream)
    }
}

fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

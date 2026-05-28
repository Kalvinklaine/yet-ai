use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::response::sse::Event;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::json;
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;

use crate::provider_auth::{self, ExperimentalCodexChatAuth};
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
    active_stream: Option<ActiveStream>,
    next_stream_id: u64,
}

#[derive(Debug)]
struct ActiveStream {
    id: u64,
    handle: JoinHandle<()>,
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

    pub async fn accept_user_message(
        &self,
        config_dir: std::path::PathBuf,
        chat_id: String,
        content: String,
    ) {
        let runtime = self.clone();
        let stream_id = {
            let mut guard = self.inner.lock().await;
            let state = guard
                .entry(chat_id.clone())
                .or_insert_with(|| ChatState::new(&chat_id));
            if let Some(active) = state.active_stream.take() {
                active.handle.abort();
            }
            let stream_id = state.next_stream_id;
            state.next_stream_id += 1;
            stream_id
        };
        let task_chat_id = chat_id.clone();
        let (start_sender, start_receiver) = oneshot::channel();
        let handle = tokio::spawn(async move {
            if start_receiver.await.is_ok() {
                runtime
                    .run_stream(config_dir, task_chat_id, stream_id, content)
                    .await;
            }
        });
        let mut guard = self.inner.lock().await;
        let state = guard
            .entry(chat_id.clone())
            .or_insert_with(|| ChatState::new(&chat_id));
        state.active_stream = Some(ActiveStream {
            id: stream_id,
            handle,
        });
        let _ = start_sender.send(());
    }

    pub async fn accept_abort(&self, chat_id: &str) {
        let active = {
            let mut guard = self.inner.lock().await;
            let state = guard
                .entry(chat_id.to_string())
                .or_insert_with(|| ChatState::new(chat_id));
            state.active_stream.take()
        };
        if let Some(active) = active {
            active.handle.abort();
            self.push_event(
                chat_id,
                "stream_finished",
                json!({ "finishReason": "abort" }),
            )
            .await;
        }
    }

    pub async fn subscribe(
        &self,
        chat_id: String,
    ) -> impl futures_util::Stream<Item = Result<Event, Infallible>> {
        let (snapshot, replay, receiver) = {
            let mut guard = self.inner.lock().await;
            let state = guard
                .entry(chat_id.clone())
                .or_insert_with(|| ChatState::new(&chat_id));
            (
                snapshot_event(&chat_id),
                state.events.clone(),
                state.sender.subscribe(),
            )
        };
        let snapshot_stream = futures_util::stream::once(async move { Ok(to_sse_event(snapshot)) });
        let replay_stream = futures_util::stream::iter(
            replay
                .into_iter()
                .map(|event| Ok::<Event, Infallible>(to_sse_event(event))),
        );
        let live_stream = BroadcastStream::new(receiver).filter_map(|event| async move {
            match event {
                Ok(event) => Some(Ok(to_sse_event(event))),
                Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(_)) => None,
            }
        });
        snapshot_stream.chain(replay_stream).chain(live_stream)
    }

    async fn push_event(&self, chat_id: &str, event_type: &str, payload: serde_json::Value) {
        let mut guard = self.inner.lock().await;
        let state = guard
            .entry(chat_id.to_string())
            .or_insert_with(|| ChatState::new(chat_id));
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

    async fn run_stream(
        &self,
        config_dir: std::path::PathBuf,
        chat_id: String,
        stream_id: u64,
        content: String,
    ) {
        self.push_event(&chat_id, "stream_started", json!({ "role": "assistant" }))
            .await;
        match self.stream_provider(&config_dir, &chat_id, &content).await {
            Ok(()) => {
                self.push_event(
                    &chat_id,
                    "stream_finished",
                    json!({ "finishReason": "stop" }),
                )
                .await;
            }
            Err(error) => {
                self.push_event(
                    &chat_id,
                    "error",
                    json!({ "code": error.code(), "message": error.client_message() }),
                )
                .await;
            }
        }
        self.clear_active_stream(&chat_id, stream_id).await;
    }

    async fn clear_active_stream(&self, chat_id: &str, stream_id: u64) {
        let mut guard = self.inner.lock().await;
        if let Some(state) = guard.get_mut(chat_id) {
            if state
                .active_stream
                .as_ref()
                .is_some_and(|active| active.id == stream_id)
            {
                state.active_stream = None;
            }
        }
    }

    async fn stream_provider(
        &self,
        config_dir: &std::path::Path,
        chat_id: &str,
        content: &str,
    ) -> Result<(), ChatError> {
        let selected = select_chat_provider(config_dir).await?;
        match selected {
            ChatProvider::OpenAiCompatible { provider_id, model } => {
                let provider =
                    providers::get_provider_config_with_secrets(config_dir, &provider_id)
                        .await
                        .map_err(|_| ChatError::ProviderConfig)?;
                openai_compatible_stream(self, &self.client, &provider, &model, chat_id, content)
                    .await
            }
            ChatProvider::ExperimentalCodex(auth) => {
                bearer_stream(
                    self,
                    &self.client,
                    &auth.base_url,
                    &auth.model,
                    &auth.access_token,
                    chat_id,
                    content,
                )
                .await
            }
        }
    }
}

async fn select_chat_provider(config_dir: &std::path::Path) -> Result<ChatProvider, ChatError> {
    let providers = providers::list_provider_configs(config_dir)
        .await
        .map_err(|_| ChatError::ProviderConfig)?;
    let mut saw_enabled_openai_compatible = false;
    for provider in providers
        .into_iter()
        .filter(|provider| provider.enabled && provider.kind == ProviderKind::OpenAiCompatible)
    {
        saw_enabled_openai_compatible = true;
        if let Some(model) = provider.models.first() {
            return Ok(ChatProvider::OpenAiCompatible {
                provider_id: provider.id,
                model: model.id.clone(),
            });
        }
    }
    if let Some(auth) = provider_auth::experimental_codex_chat_auth(config_dir)
        .await
        .map_err(|_| ChatError::ProviderConfig)?
    {
        return Ok(ChatProvider::ExperimentalCodex(auth));
    }
    if saw_enabled_openai_compatible {
        Err(ChatError::NoModel)
    } else {
        Err(ChatError::NoProvider)
    }
}

enum ChatProvider {
    OpenAiCompatible { provider_id: String, model: String },
    ExperimentalCodex(ExperimentalCodexChatAuth),
}

impl ChatState {
    fn new(_chat_id: &str) -> Self {
        let (sender, _) = broadcast::channel(64);
        Self {
            events: Vec::new(),
            next_seq: 1,
            sender,
            active_stream: None,
            next_stream_id: 1,
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

    fn client_message(&self) -> &'static str {
        match self {
            Self::NoProvider => "No enabled OpenAI-compatible provider is configured.",
            Self::NoModel => "The configured provider has no chat model.",
            Self::Unauthorized => {
                "Provider authentication failed. Check the configured credentials."
            }
            Self::Request => "Provider request failed.",
            Self::Timeout => "Provider stream timed out.",
            Self::MalformedStream => "Provider returned malformed streaming data.",
            Self::ProviderConfig => "Provider configuration is invalid.",
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
    Event::default()
        .event(event.event_type.clone())
        .data(serde_json::to_string(&event).unwrap())
}

async fn openai_compatible_stream(
    runtime: &ChatRuntime,
    client: &reqwest::Client,
    provider: &StoredProviderConfig,
    model: &str,
    chat_id: &str,
    content: &str,
) -> Result<(), ChatError> {
    let url = chat_completions_url(&provider.base_url)?;
    let mut request = client
        .post(url)
        .timeout(Duration::from_secs(10))
        .json(&json!({
            "model": model,
            "stream": true,
            "messages": [{ "role": "user", "content": content }]
        }));
    if provider.auth.auth_type == AuthType::ApiKey {
        if let Some(api_key) = provider
            .auth
            .api_key
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            request = request.bearer_auth(api_key);
        }
    }
    collect_openai_compatible_stream(runtime, chat_id, request).await
}

async fn bearer_stream(
    runtime: &ChatRuntime,
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    access_token: &str,
    chat_id: &str,
    content: &str,
) -> Result<(), ChatError> {
    let url = chat_completions_url(base_url)?;
    let request = client
        .post(url)
        .timeout(Duration::from_secs(10))
        .bearer_auth(access_token)
        .json(&json!({
            "model": model,
            "stream": true,
            "messages": [{ "role": "user", "content": content }]
        }));
    collect_openai_compatible_stream(runtime, chat_id, request).await
}

async fn collect_openai_compatible_stream(
    runtime: &ChatRuntime,
    chat_id: &str,
    request: reqwest::RequestBuilder,
) -> Result<(), ChatError> {
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
    let mut parser = OpenAiSseParser::default();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                ChatError::Timeout
            } else {
                ChatError::Request
            }
        })?;
        let text = std::str::from_utf8(&chunk).map_err(|_| ChatError::MalformedStream)?;
        parser.push(text)?;
        for delta in parser.drain_deltas() {
            runtime
                .push_event(
                    chat_id,
                    "stream_delta",
                    json!({ "delta": { "content": delta } }),
                )
                .await;
        }
    }
    for delta in parser.finish()? {
        runtime
            .push_event(
                chat_id,
                "stream_delta",
                json!({ "delta": { "content": delta } }),
            )
            .await;
    }
    Ok(())
}

#[derive(Default)]
struct OpenAiSseParser {
    buffer: String,
    data_lines: Vec<String>,
    deltas: Vec<String>,
    done: bool,
}

impl OpenAiSseParser {
    fn push(&mut self, text: &str) -> Result<(), ChatError> {
        self.buffer.push_str(text);
        while let Some(index) = self.buffer.find('\n') {
            let line = self.buffer[..index].trim_end_matches('\r').to_string();
            self.buffer = self.buffer[index + 1..].to_string();
            self.handle_line(&line)?;
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<String>, ChatError> {
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.handle_line(line.trim_end_matches('\r'))?;
        }
        self.flush_event()?;
        Ok(self.deltas)
    }

    fn drain_deltas(&mut self) -> Vec<String> {
        std::mem::take(&mut self.deltas)
    }

    fn handle_line(&mut self, line: &str) -> Result<(), ChatError> {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            return self.flush_event();
        }
        if line.starts_with(':') {
            return Ok(());
        }
        if line.starts_with("event:") || line.starts_with("id:") || line.starts_with("retry:") {
            return Ok(());
        }
        let Some(data) = line.strip_prefix("data:") else {
            return Err(ChatError::MalformedStream);
        };
        self.data_lines.push(data.trim_start().to_string());
        Ok(())
    }

    fn flush_event(&mut self) -> Result<(), ChatError> {
        if self.data_lines.is_empty() {
            return Ok(());
        }
        let data = self.data_lines.join("\n");
        self.data_lines.clear();
        self.handle_data(data.trim())
    }

    fn handle_data(&mut self, data: &str) -> Result<(), ChatError> {
        if data.is_empty() || self.done {
            return Ok(());
        }
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: serde_json::Value =
            serde_json::from_str(data).map_err(|_| ChatError::MalformedStream)?;
        if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
            if !content.is_empty() {
                self.deltas.push(content.to_string());
            }
            Ok(())
        } else if value["choices"][0]["finish_reason"].is_string() {
            Ok(())
        } else {
            Err(ChatError::MalformedStream)
        }
    }
}

fn chat_completions_url(base_url: &str) -> Result<String, ChatError> {
    providers::validate_provider_base_url(base_url).map_err(|_| ChatError::ProviderConfig)?;
    let mut url = reqwest::Url::parse(base_url).map_err(|_| ChatError::ProviderConfig)?;
    let normalized_path = url.path().trim_end_matches('/').to_string();
    if normalized_path.ends_with("/chat/completions") {
        url.set_path(&normalized_path);
    } else {
        url.set_path(&format!("{normalized_path}/chat/completions"));
    }
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::{chat_completions_url, OpenAiSseParser};

    #[test]
    fn chat_completions_url_normalizes_api_roots() {
        assert_eq!(
            chat_completions_url("http://127.0.0.1:8080/v1").unwrap(),
            "http://127.0.0.1:8080/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://127.0.0.1:8080/v1/").unwrap(),
            "http://127.0.0.1:8080/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("http://127.0.0.1:8080/v1/chat/completions/").unwrap(),
            "http://127.0.0.1:8080/v1/chat/completions"
        );
    }

    #[test]
    fn chat_completions_url_rejects_invalid_base_url() {
        assert!(chat_completions_url("file:///tmp/socket").is_err());
        assert!(chat_completions_url("http://user:pass@127.0.0.1:8080/v1").is_err());
    }

    #[test]
    fn openai_sse_parser_handles_common_framing() {
        let mut parser = OpenAiSseParser::default();
        parser.push(": comment\n\n").unwrap();
        parser.push("data: {\"choices\":[{\"delta\":{").unwrap();
        parser.push("\"content\":\"Hel\"}}]}\n\n").unwrap();
        parser
            .push("data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n")
            .unwrap();
        parser.push("data: [DONE]\n\n").unwrap();
        assert_eq!(parser.finish().unwrap(), vec!["Hel", "lo"]);
    }

    #[test]
    fn openai_sse_parser_handles_multiline_data() {
        let mut parser = OpenAiSseParser::default();
        parser.push("data: {\"choices\":[{\"delta\":{\n").unwrap();
        parser.push("data: \"content\":\"multi\"}}]}\n\n").unwrap();
        assert_eq!(parser.finish().unwrap(), vec!["multi"]);
    }

    #[test]
    fn openai_sse_parser_rejects_malformed_frames() {
        let mut parser = OpenAiSseParser::default();
        assert!(parser.push("data: { not-json }\n\n").is_err());
    }
}

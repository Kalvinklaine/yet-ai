use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::response::sse::Event;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;

use crate::chat_history::{self, ChatMessageRole, ChatMessageStatus};
use crate::demo_mode;
use crate::provider_auth::{self, ExperimentalCodexChatAuth};
use crate::providers::{self, AuthType, ModelReadinessStatus, ProviderKind, StoredProviderConfig};

#[derive(Clone, Debug)]
pub struct ChatRuntime {
    inner: Arc<Mutex<HashMap<String, ChatState>>>,
    history_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatContext {
    kind: String,
    source: String,
    file: Option<ChatContextFile>,
    selection: Option<ChatContextSelection>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChatContextFile {
    display_path: Option<String>,
    workspace_relative_path: Option<String>,
    language_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChatContextSelection {
    start_line: Option<u64>,
    start_character: Option<u64>,
    end_line: Option<u64>,
    end_character: Option<u64>,
    text: Option<String>,
}

const CHAT_CONTEXT_SELECTION_TEXT_MAX_CHARS: usize = 8_000;
const CHAT_CONTEXT_TOTAL_MAX_CHARS: usize = 12_000;
const CHAT_CONTEXT_DISPLAY_PATH_MAX_CHARS: usize = 256;
const CHAT_CONTEXT_WORKSPACE_PATH_MAX_CHARS: usize = 512;
const CHAT_CONTEXT_LANGUAGE_MAX_CHARS: usize = 64;
const CHAT_CONTEXT_MAX_POSITION: u64 = 1_000_000;

#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    #[error("no enabled openai-compatible provider is configured")]
    NoProvider,
    #[error("provider has no configured model")]
    NoModel,
    #[error("provider authentication failed")]
    Unauthorized,
    #[error("provider authentication failed")]
    PreStreamUnauthorized,
    #[error("provider rate limit or quota reached")]
    RateLimited,
    #[error("provider context window is too small")]
    ContextTooLarge,
    #[error("provider rejected the request")]
    InvalidRequest,
    #[error("provider service returned an error")]
    UpstreamError,
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
            history_locks: Arc::new(Mutex::new(HashMap::new())),
            client: reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
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
        context: Option<ChatContext>,
    ) {
        let lock = self.history_lock(&chat_id).await;
        let _history_guard = lock.lock().await;
        let runtime = self.clone();
        let task_config_dir = config_dir.clone();
        let task_chat_id = chat_id.clone();
        let task_content = content.clone();
        let (start_sender, start_receiver) = oneshot::channel();
        {
            let mut guard = self.inner.lock().await;
            let state = guard
                .entry(chat_id.clone())
                .or_insert_with(|| ChatState::new(&chat_id));
            if let Some(active) = state.active_stream.take() {
                active.handle.abort();
                state.push_event(
                    &chat_id,
                    "stream_finished",
                    json!({ "finishReason": "abort" }),
                );
                state.prune_replay_events_if_terminal();
            }
            let stream_id = state.next_stream_id;
            state.next_stream_id += 1;
            let handle = tokio::spawn(async move {
                if start_receiver.await.is_ok() {
                    runtime
                        .run_stream(
                            task_config_dir,
                            task_chat_id,
                            stream_id,
                            task_content,
                            context,
                        )
                        .await;
                }
            });
            state.active_stream = Some(ActiveStream {
                id: stream_id,
                handle,
            });
        }
        let _ = chat_history::append_message(
            &config_dir,
            &chat_id,
            ChatMessageRole::User,
            content,
            Some(ChatMessageStatus::Complete),
        )
        .await;
        let _ = start_sender.send(());
    }

    pub async fn accept_abort(&self, chat_id: &str) {
        self.abort_active_stream(chat_id).await;
    }

    pub async fn subscribe(
        &self,
        config_dir: std::path::PathBuf,
        chat_id: String,
    ) -> impl futures_util::Stream<Item = Result<Event, Infallible>> {
        let (snapshot, replay, receiver) = {
            let snapshot = self.snapshot_event(&config_dir, &chat_id).await;
            let mut guard = self.inner.lock().await;
            let state = guard
                .entry(chat_id.clone())
                .or_insert_with(|| ChatState::new(&chat_id));
            state.prune_replay_events_if_terminal();
            let replay = state.events.clone();
            (snapshot, replay, state.sender.subscribe())
        };
        let snapshot_stream = futures_util::stream::once(async move { Ok(to_sse_event(snapshot)) });
        let replay_stream = futures_util::stream::iter(replay.into_iter().map(Ok::<_, Infallible>));
        let live_stream = BroadcastStream::new(receiver).filter_map(|event| async move {
            match event {
                Ok(event) => Some(Ok(event)),
                Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(_)) => None,
            }
        });
        let event_stream = replay_stream.chain(live_stream).scan(1_u64, |next_seq, event| {
            let Ok(mut event) = event;
            let seq = *next_seq;
            *next_seq += 1;
            event.seq = seq;
            futures_util::future::ready(Some(Ok(to_sse_event(event))))
        });
        snapshot_stream.chain(event_stream)
    }

    async fn push_stream_event(
        &self,
        chat_id: &str,
        stream_id: u64,
        event_type: &str,
        payload: serde_json::Value,
    ) -> bool {
        let mut guard = self.inner.lock().await;
        let state = guard
            .entry(chat_id.to_string())
            .or_insert_with(|| ChatState::new(chat_id));
        if !state
            .active_stream
            .as_ref()
            .is_some_and(|active| active.id == stream_id)
        {
            return false;
        }
        state.push_event(chat_id, event_type, payload);
        true
    }

    async fn claim_stream_terminal_ownership(&self, chat_id: &str, stream_id: u64) -> bool {
        let mut guard = self.inner.lock().await;
        let Some(state) = guard.get_mut(chat_id) else {
            return false;
        };
        if !state
            .active_stream
            .as_ref()
            .is_some_and(|active| active.id == stream_id)
        {
            return false;
        }
        state.active_stream = None;
        true
    }

    async fn push_terminal_event(
        &self,
        chat_id: &str,
        event_type: &str,
        payload: serde_json::Value,
    ) {
        let mut guard = self.inner.lock().await;
        let state = guard
            .entry(chat_id.to_string())
            .or_insert_with(|| ChatState::new(chat_id));
        state.push_event(chat_id, event_type, payload);
    }

    async fn abort_active_stream(&self, chat_id: &str) -> bool {
        let lock = self.history_lock(chat_id).await;
        let _history_guard = lock.lock().await;
        let mut guard = self.inner.lock().await;
        let state = guard
            .entry(chat_id.to_string())
            .or_insert_with(|| ChatState::new(chat_id));
        let Some(active) = state.active_stream.take() else {
            return false;
        };
        active.handle.abort();
        state.push_event(
            chat_id,
            "stream_finished",
            json!({ "finishReason": "abort" }),
        );
        state.prune_replay_events_if_terminal();
        true
    }

    async fn run_stream(
        &self,
        config_dir: std::path::PathBuf,
        chat_id: String,
        stream_id: u64,
        content: String,
        context: Option<ChatContext>,
    ) {
        if !self
            .push_stream_event(
                &chat_id,
                stream_id,
                "stream_started",
                json!({ "role": "assistant" }),
            )
            .await
        {
            return;
        }
        if !self.is_active_stream(&chat_id, stream_id).await {
            return;
        }
        let prompt = assemble_provider_prompt(&content, context.as_ref());
        let result = self
            .stream_provider(&config_dir, &chat_id, stream_id, &prompt, &content, context.as_ref())
            .await;
        if !self.is_active_stream(&chat_id, stream_id).await {
            return;
        }
        match result {
            Ok(assistant_content) => {
                self.persist_terminal_history_and_event(
                    &config_dir,
                    &chat_id,
                    stream_id,
                    ChatMessageRole::Assistant,
                    assistant_content,
                    ChatMessageStatus::Complete,
                    "stream_finished",
                    json!({ "finishReason": "stop" }),
                )
                .await;
            }
            Err(error) => {
                self.persist_terminal_history_and_event(
                    &config_dir,
                    &chat_id,
                    stream_id,
                    ChatMessageRole::Error,
                    error.client_message().to_string(),
                    ChatMessageStatus::Error,
                    "error",
                    json!({ "code": error.code(), "message": error.client_message() }),
                )
                .await;
            }
        }
    }

    async fn persist_terminal_history_and_event(
        &self,
        config_dir: &std::path::Path,
        chat_id: &str,
        stream_id: u64,
        role: ChatMessageRole,
        content: String,
        status: ChatMessageStatus,
        event_type: &str,
        payload: serde_json::Value,
    ) -> bool {
        let lock = self.history_lock(chat_id).await;
        let _guard = lock.lock().await;
        if !self
            .claim_stream_terminal_ownership(chat_id, stream_id)
            .await
        {
            return false;
        }
        if let Ok(message) =
            chat_history::append_message(config_dir, chat_id, role, content, Some(status)).await
        {
            if message.role == ChatMessageRole::Assistant {
                self.push_terminal_event(chat_id, "message_added", json!({ "message": message }))
                    .await;
            }
        }
        self.push_terminal_event(chat_id, event_type, payload).await;
        self.prune_terminal_replay_events(chat_id).await;
        true
    }

    async fn prune_terminal_replay_events(&self, chat_id: &str) {
        let mut guard = self.inner.lock().await;
        if let Some(state) = guard.get_mut(chat_id) {
            state.prune_replay_events_if_terminal();
        }
    }

    async fn snapshot_event(&self, config_dir: &std::path::Path, chat_id: &str) -> ChatEvent {
        let lock = self.history_lock(chat_id).await;
        let _guard = lock.lock().await;
        let thread = chat_history::get_thread(config_dir, chat_id).await.ok();
        snapshot_event(chat_id, thread)
    }

    async fn history_lock(&self, chat_id: &str) -> Arc<Mutex<()>> {
        let mut guard = self.history_locks.lock().await;
        guard
            .entry(chat_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn is_active_stream(&self, chat_id: &str, stream_id: u64) -> bool {
        let guard = self.inner.lock().await;
        guard.get(chat_id).is_some_and(|state| {
            state
                .active_stream
                .as_ref()
                .is_some_and(|active| active.id == stream_id)
        })
    }

    async fn stream_provider(
        &self,
        config_dir: &std::path::Path,
        chat_id: &str,
        stream_id: u64,
        content: &str,
        original_content: &str,
        context: Option<&ChatContext>,
    ) -> Result<String, ChatError> {
        let selected = select_chat_provider(config_dir).await?;
        match selected {
            ChatProvider::OpenAiCompatible { provider_id, model } => {
                let provider =
                    providers::get_provider_config_with_secrets(config_dir, &provider_id)
                        .await
                        .map_err(|_| ChatError::ProviderConfig)?;
                openai_compatible_stream(
                    self,
                    &self.client,
                    &provider,
                    &model,
                    chat_id,
                    stream_id,
                    content,
                )
                .await
            }
            ChatProvider::DemoLocal => demo_stream(self, chat_id, stream_id, original_content, context).await,
            ChatProvider::ExperimentalCodex(auth) => {
                bearer_stream_with_unauthorized_retry(
                    self,
                    &self.client,
                    config_dir,
                    &auth,
                    chat_id,
                    stream_id,
                    content,
                )
                .await
            }
        }
    }
}

impl ChatContext {
    pub fn from_value(value: serde_json::Value) -> Option<Self> {
        let context: Self = serde_json::from_value(value).ok()?;
        context.is_valid().then_some(context)
    }

    fn is_valid(&self) -> bool {
        if self.kind != "active_editor" {
            return false;
        }
        if !matches!(self.source.as_str(), "vscode" | "jetbrains" | "browser") {
            return false;
        }
        let file_valid = self.file.as_ref().is_none_or(ChatContextFile::is_valid);
        let selection_valid = self
            .selection
            .as_ref()
            .is_none_or(ChatContextSelection::is_valid);
        file_valid && selection_valid && self.prompt_chars() <= CHAT_CONTEXT_TOTAL_MAX_CHARS
    }

    fn prompt_chars(&self) -> usize {
        self.source.chars().count()
            + self.file.as_ref().map_or(0, ChatContextFile::prompt_chars)
            + self
                .selection
                .as_ref()
                .map_or(0, ChatContextSelection::prompt_chars)
    }
}

impl ChatContextFile {
    fn is_valid(&self) -> bool {
        let has_field = self.display_path.is_some()
            || self.workspace_relative_path.is_some()
            || self.language_id.is_some();
        has_field
            && self
                .display_path
                .as_ref()
                .is_none_or(|value| valid_context_path(value, CHAT_CONTEXT_DISPLAY_PATH_MAX_CHARS))
            && self.workspace_relative_path.as_ref().is_none_or(|value| {
                valid_context_path(value, CHAT_CONTEXT_WORKSPACE_PATH_MAX_CHARS)
            })
            && self
                .language_id
                .as_ref()
                .is_none_or(|value| valid_context_language(value))
    }

    fn prompt_chars(&self) -> usize {
        self.display_path
            .as_ref()
            .map_or(0, |value| value.chars().count())
            + self
                .workspace_relative_path
                .as_ref()
                .map_or(0, |value| value.chars().count())
            + self
                .language_id
                .as_ref()
                .map_or(0, |value| value.chars().count())
    }
}

impl ChatContextSelection {
    fn is_valid(&self) -> bool {
        let has_field = self.start_line.is_some()
            || self.start_character.is_some()
            || self.end_line.is_some()
            || self.end_character.is_some()
            || self.text.is_some();
        has_field
            && self
                .start_line
                .is_none_or(|value| value <= CHAT_CONTEXT_MAX_POSITION)
            && self
                .start_character
                .is_none_or(|value| value <= CHAT_CONTEXT_MAX_POSITION)
            && self
                .end_line
                .is_none_or(|value| value <= CHAT_CONTEXT_MAX_POSITION)
            && self
                .end_character
                .is_none_or(|value| value <= CHAT_CONTEXT_MAX_POSITION)
            && self
                .text
                .as_ref()
                .is_none_or(|value| value.chars().count() <= CHAT_CONTEXT_SELECTION_TEXT_MAX_CHARS)
    }

    fn prompt_chars(&self) -> usize {
        self.text.as_ref().map_or(0, |value| value.chars().count())
    }
}

fn valid_context_path(value: &str, max_chars: usize) -> bool {
    !value.is_empty()
        && value.chars().count() <= max_chars
        && !value.starts_with('/')
        && !value.starts_with('~')
        && !value.contains('\\')
        && !value.contains(':')
        && !value.chars().any(|value| value.is_control())
        && value
            .split('/')
            .all(|part| !matches!(part, "" | "." | ".."))
}

fn valid_context_language(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= CHAT_CONTEXT_LANGUAGE_MAX_CHARS
        && value
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '.' | '+' | '-'))
}

fn assemble_provider_prompt(content: &str, context: Option<&ChatContext>) -> String {
    let Some(context) = context else {
        return content.to_string();
    };
    let mut lines = vec![
        "IDE context".to_string(),
        format!("Source: {}", context.source),
    ];
    if let Some(file) = &context.file {
        if let Some(value) = &file.display_path {
            lines.push(format!("File: {value}"));
        }
        if let Some(value) = &file.workspace_relative_path {
            lines.push(format!("Workspace-relative path: {value}"));
        }
        if let Some(value) = &file.language_id {
            lines.push(format!("Language: {value}"));
        }
    }
    if let Some(selection) = &context.selection {
        if selection.start_line.is_some()
            || selection.start_character.is_some()
            || selection.end_line.is_some()
            || selection.end_character.is_some()
        {
            lines.push(format!(
                "Range: {}:{}-{}:{}",
                selection.start_line.unwrap_or(0),
                selection.start_character.unwrap_or(0),
                selection.end_line.unwrap_or(0),
                selection.end_character.unwrap_or(0)
            ));
        }
        if let Some(value) = &selection.text {
            lines.push("Selection:".to_string());
            lines.push(value.clone());
        }
    }
    lines.push(String::new());
    lines.push("User request".to_string());
    lines.push(content.to_string());
    lines.join("\n")
}

async fn select_chat_provider(config_dir: &std::path::Path) -> Result<ChatProvider, ChatError> {
    let providers = providers::provider_summaries(config_dir)
        .await
        .map_err(|_| ChatError::ProviderConfig)?;
    let mut saw_enabled_openai_compatible = false;
    let mut saw_missing_credentials_capable_model = false;
    for provider in providers
        .into_iter()
        .filter(|provider| provider.enabled && provider.kind == ProviderKind::OpenAiCompatible)
    {
        saw_enabled_openai_compatible = true;
        for model in provider.models {
            if !model.capabilities.chat || !model.capabilities.streaming {
                continue;
            }
            match model.readiness.status {
                ModelReadinessStatus::Ready => {
                    return Ok(ChatProvider::OpenAiCompatible {
                        provider_id: provider.id,
                        model: model.id,
                    });
                }
                ModelReadinessStatus::MissingCredentials => {
                    saw_missing_credentials_capable_model = true;
                }
                _ => {}
            }
        }
    }
    match provider_auth::refresh_experimental_codex_chat_auth_if_needed(config_dir).await {
        Ok(Some(auth)) => return Ok(ChatProvider::ExperimentalCodex(auth)),
        Ok(None) | Err(provider_auth::ProviderAuthError::InvalidRequest) => {}
        Err(_) => return Err(ChatError::ProviderConfig),
    }
    if demo_mode::get(config_dir)
        .await
        .map_err(|_| ChatError::ProviderConfig)?
        .enabled
    {
        return Ok(ChatProvider::DemoLocal);
    }
    if saw_missing_credentials_capable_model {
        Err(ChatError::Unauthorized)
    } else if saw_enabled_openai_compatible {
        Err(ChatError::NoModel)
    } else {
        Err(ChatError::NoProvider)
    }
}

enum ChatProvider {
    OpenAiCompatible { provider_id: String, model: String },
    DemoLocal,
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

    fn push_event(&mut self, chat_id: &str, event_type: &str, payload: serde_json::Value) {
        let event = ChatEvent {
            seq: self.next_seq,
            event_type: event_type.to_string(),
            chat_id: chat_id.to_string(),
            payload,
        };
        self.next_seq += 1;
        self.events.push(event.clone());
        let _ = self.sender.send(event);
    }

    fn prune_replay_events_if_terminal(&mut self) {
        if self.active_stream.is_none() {
            self.events.clear();
        }
    }
}

impl ChatError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoProvider => "provider_not_configured",
            Self::NoModel => "model_not_configured",
            Self::Unauthorized | Self::PreStreamUnauthorized => "provider_unauthorized",
            Self::RateLimited => "provider_rate_limited",
            Self::ContextTooLarge => "provider_context_too_large",
            Self::InvalidRequest => "provider_invalid_request",
            Self::UpstreamError => "provider_upstream_error",
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
            Self::Unauthorized | Self::PreStreamUnauthorized => {
                "Provider credentials were rejected."
            }
            Self::RateLimited => "Provider rate limit or quota reached.",
            Self::ContextTooLarge => {
                "The request is too large for the selected model context window."
            }
            Self::InvalidRequest => "Provider rejected the request.",
            Self::UpstreamError => "Provider service returned an error.",
            Self::Request => {
                "Provider request failed. Check the local provider configuration and try again."
            }
            Self::Timeout => "Provider request timed out.",
            Self::MalformedStream => "Provider stream ended unexpectedly.",
            Self::ProviderConfig => "Provider configuration is invalid.",
        }
    }
}

fn snapshot_event(chat_id: &str, thread: Option<chat_history::ChatThread>) -> ChatEvent {
    let messages = thread
        .as_ref()
        .map(|thread| serde_json::to_value(&thread.messages).unwrap_or_else(|_| json!([])))
        .unwrap_or_else(|| json!([]));
    ChatEvent {
        seq: 0,
        event_type: "snapshot".to_string(),
        chat_id: chat_id.to_string(),
        payload: json!({
            "thread": {
                "id": chat_id,
                "title": thread.as_ref().map(|thread| thread.title.as_str()).unwrap_or("New chat"),
                "messages": messages
            },
            "messages": messages,
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

async fn demo_stream(
    runtime: &ChatRuntime,
    chat_id: &str,
    stream_id: u64,
    content: &str,
    context: Option<&ChatContext>,
) -> Result<String, ChatError> {
    let response = demo_response(content, context);
    for delta in response.split_inclusive([' ', '\n']) {
        if !runtime
            .push_stream_event(
                chat_id,
                stream_id,
                "stream_delta",
                json!({ "delta": { "content": delta } }),
            )
            .await
        {
            break;
        }
        tokio::task::yield_now().await;
    }
    Ok(response)
}

fn demo_response(content: &str, context: Option<&ChatContext>) -> String {
    if content.to_ascii_lowercase().contains("demo edit proposal") {
        return serde_json::to_string_pretty(&json!({
            "type": "confirmed_edit_proposal",
            "version": "2026-05-15",
            "summary": "Yet AI Demo Mode proposes a safe local preview-only edit. No provider call was made and nothing is applied automatically.",
            "edits": [{
                "workspaceRelativePath": "src/example.ts",
                "oldText": "export const demo = false;\n",
                "newText": "export const demo = true;\n",
                "range": {
                    "startLine": 1,
                    "startCharacter": 0,
                    "endLine": 1,
                    "endCharacter": 26
                }
            }]
        }))
        .unwrap_or_else(|_| "Yet AI Demo Mode could not render the edit proposal JSON.".to_string());
    }
    let mut response = "Hello from Yet AI Demo Mode — your local plugin, runtime, GUI, chat, SSE, and history path is working. Configure a BYOK provider for real model answers. This is a local canned response, not model quality, and no provider call was made.".to_string();
    if let Some(context) = context {
        response.push_str("\n\nAttached context metadata received (raw selected text omitted):");
        response.push_str(&format!(" source={}", context.source));
        if let Some(file) = &context.file {
            if let Some(path) = file
                .workspace_relative_path
                .as_ref()
                .or(file.display_path.as_ref())
            {
                response.push_str(&format!(", path={path}"));
            }
            if let Some(language) = &file.language_id {
                response.push_str(&format!(", language={language}"));
            }
        }
        if let Some(selection) = &context.selection {
            if selection.start_line.is_some()
                || selection.start_character.is_some()
                || selection.end_line.is_some()
                || selection.end_character.is_some()
            {
                response.push_str(&format!(
                    ", range={}:{}-{}:{}",
                    selection.start_line.unwrap_or(0),
                    selection.start_character.unwrap_or(0),
                    selection.end_line.unwrap_or(0),
                    selection.end_character.unwrap_or(0)
                ));
            }
        }
        response.push_str(". No selected text was included in this demo response.");
    }
    response
}

async fn openai_compatible_stream(
    runtime: &ChatRuntime,
    client: &reqwest::Client,
    provider: &StoredProviderConfig,
    model: &str,
    chat_id: &str,
    stream_id: u64,
    content: &str,
) -> Result<String, ChatError> {
    let api_key = if provider.auth.auth_type == AuthType::ApiKey {
        Some(
            provider
                .auth
                .api_key
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or(ChatError::Unauthorized)?,
        )
    } else {
        None
    };
    let url = chat_completions_url(&provider.base_url)?;
    let mut request = client
        .post(url)
        .timeout(Duration::from_secs(10))
        .json(&json!({
            "model": model,
            "stream": true,
            "messages": [{ "role": "user", "content": content }]
        }));
    if let Some(api_key) = api_key {
        request = request.bearer_auth(api_key);
    }
    collect_openai_compatible_stream(runtime, chat_id, stream_id, request).await
}

async fn bearer_stream(
    runtime: &ChatRuntime,
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    access_token: &str,
    chat_id: &str,
    stream_id: u64,
    content: &str,
) -> Result<String, ChatError> {
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
    collect_openai_compatible_stream(runtime, chat_id, stream_id, request).await
}

async fn bearer_stream_with_unauthorized_retry(
    runtime: &ChatRuntime,
    client: &reqwest::Client,
    config_dir: &std::path::Path,
    auth: &ExperimentalCodexChatAuth,
    chat_id: &str,
    stream_id: u64,
    content: &str,
) -> Result<String, ChatError> {
    let first = bearer_stream(
        runtime,
        client,
        &auth.base_url,
        &auth.model,
        &auth.access_token,
        chat_id,
        stream_id,
        content,
    )
    .await;
    if !matches!(first, Err(ChatError::PreStreamUnauthorized)) {
        return first;
    }
    let Some(refreshed) = provider_auth::refresh_experimental_codex_chat_auth_after_rejection(
        config_dir,
        &auth.access_token,
    )
    .await
    .map_err(|_| ChatError::ProviderConfig)?
    else {
        return first;
    };
    if refreshed.access_token == auth.access_token {
        return first;
    }
    bearer_stream(
        runtime,
        client,
        &refreshed.base_url,
        &refreshed.model,
        &refreshed.access_token,
        chat_id,
        stream_id,
        content,
    )
    .await
}

async fn collect_openai_compatible_stream(
    runtime: &ChatRuntime,
    chat_id: &str,
    stream_id: u64,
    request: reqwest::RequestBuilder,
) -> Result<String, ChatError> {
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ChatError::Timeout
        } else {
            ChatError::Request
        }
    })?;
    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ChatError::PreStreamUnauthorized);
        }
        return Err(classify_provider_http_error(response).await);
    }
    let mut stream = response.bytes_stream();
    let mut parser = OpenAiSseParser::default();
    let mut utf8_buffer = Vec::new();
    let mut assistant_content = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                ChatError::Timeout
            } else {
                ChatError::Request
            }
        })?;
        for text in decode_stream_utf8_chunk(&mut utf8_buffer, &chunk)? {
            parser.push(&text)?;
        }
        for delta in parser.drain_deltas() {
            assistant_content.push_str(&delta);
            let current = runtime
                .push_stream_event(
                    chat_id,
                    stream_id,
                    "stream_delta",
                    json!({ "delta": { "content": delta } }),
                )
                .await;
            if !current {
                return Ok(assistant_content);
            }
        }
    }
    if !utf8_buffer.is_empty() {
        return Err(ChatError::MalformedStream);
    }
    for delta in parser.finish()? {
        assistant_content.push_str(&delta);
        let current = runtime
            .push_stream_event(
                chat_id,
                stream_id,
                "stream_delta",
                json!({ "delta": { "content": delta } }),
            )
            .await;
        if !current {
            return Ok(assistant_content);
        }
    }
    Ok(assistant_content)
}

fn decode_stream_utf8_chunk(pending: &mut Vec<u8>, chunk: &[u8]) -> Result<Vec<String>, ChatError> {
    if pending.len() + chunk.len() > PROVIDER_STREAM_LINE_BUFFER_LIMIT {
        return Err(ChatError::MalformedStream);
    }
    pending.extend_from_slice(chunk);
    let error = match std::str::from_utf8(pending) {
        Ok(text) => {
            let text = text.to_string();
            pending.clear();
            return Ok(vec![text]);
        }
        Err(error) => error,
    };

    if error.error_len().is_some() {
        return Err(ChatError::MalformedStream);
    }
    let valid_up_to = error.valid_up_to();
    if pending.len() - valid_up_to > 3 {
        return Err(ChatError::MalformedStream);
    }
    if valid_up_to == 0 {
        return Ok(Vec::new());
    }
    let valid = String::from_utf8(pending[..valid_up_to].to_vec())
        .map_err(|_| ChatError::MalformedStream)?;
    let tail = pending[valid_up_to..].to_vec();
    *pending = tail;
    Ok(vec![valid])
}

const PROVIDER_ERROR_BODY_CLASSIFICATION_LIMIT: usize = 16 * 1024;
const PROVIDER_STREAM_EVENT_DATA_LIMIT: usize = 16 * 1024;
const PROVIDER_STREAM_LINE_BUFFER_LIMIT: usize = 16 * 1024;
const PROVIDER_STREAM_EVENT_DATA_LINE_LIMIT: usize = 256;

async fn classify_provider_http_error(response: reqwest::Response) -> ChatError {
    let status = response.status();
    match bounded_provider_error_body(response).await {
        Ok(body) => classify_provider_error(status, &body),
        Err(ChatError::Timeout) => ChatError::Timeout,
        Err(_) => classify_provider_error(status, &[]),
    }
}

async fn bounded_provider_error_body(response: reqwest::Response) -> Result<Vec<u8>, ChatError> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while body.len() < PROVIDER_ERROR_BODY_CLASSIFICATION_LIMIT {
        let Some(chunk) = stream.next().await else {
            break;
        };
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                ChatError::Timeout
            } else {
                ChatError::Request
            }
        })?;
        let remaining = PROVIDER_ERROR_BODY_CLASSIFICATION_LIMIT - body.len();
        body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
    Ok(body)
}

fn classify_provider_error(status: reqwest::StatusCode, body: &[u8]) -> ChatError {
    match status.as_u16() {
        401 | 403 => ChatError::Unauthorized,
        429 => ChatError::RateLimited,
        413 => ChatError::ContextTooLarge,
        400 | 422 if provider_body_has_context_signal(body) => ChatError::ContextTooLarge,
        400 | 404 | 422 => ChatError::InvalidRequest,
        408 | 504 => ChatError::Timeout,
        500..=599 => ChatError::UpstreamError,
        _ => ChatError::Request,
    }
}

fn classify_provider_stream_error(value: &serde_json::Value) -> ChatError {
    let body = serde_json::to_vec(value).unwrap_or_default();
    if provider_body_has_context_signal(&body) {
        return ChatError::ContextTooLarge;
    }
    let text = String::from_utf8_lossy(&body).to_ascii_lowercase();
    if text.contains("rate_limit") || text.contains("rate limit") || text.contains("quota") {
        ChatError::RateLimited
    } else if text.contains("unauthorized")
        || text.contains("authentication")
        || text.contains("invalid_api_key")
        || text.contains("permission")
        || text.contains("forbidden")
    {
        ChatError::Unauthorized
    } else if text.contains("invalid_request")
        || text.contains("bad request")
        || text.contains("not found")
        || text.contains("unprocessable")
    {
        ChatError::InvalidRequest
    } else if text.contains("server_error")
        || text.contains("internal error")
        || text.contains("service unavailable")
        || text.contains("upstream")
    {
        ChatError::UpstreamError
    } else {
        ChatError::Request
    }
}

fn provider_body_has_context_signal(body: &[u8]) -> bool {
    let text = if let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) {
        serde_json::to_string(&value).unwrap_or_default()
    } else {
        String::from_utf8_lossy(body).into_owned()
    };
    let text = text.to_ascii_lowercase();
    text.contains("context_length_exceeded")
        || text.contains("maximum context length")
        || text.contains("too many tokens")
        || text.contains("prompt is too long")
}

#[derive(Default)]
struct OpenAiSseParser {
    buffer: String,
    data_lines: Vec<String>,
    event_data_bytes: usize,
    deltas: Vec<String>,
    done: bool,
}

impl OpenAiSseParser {
    fn push(&mut self, text: &str) -> Result<(), ChatError> {
        if self.buffer.len() + text.len() > PROVIDER_STREAM_LINE_BUFFER_LIMIT {
            return Err(ChatError::MalformedStream);
        }
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
        let data = data.trim_start();
        let separator_bytes = usize::from(!self.data_lines.is_empty());
        if self.data_lines.len() >= PROVIDER_STREAM_EVENT_DATA_LINE_LIMIT
            || self.event_data_bytes + separator_bytes + data.len()
                > PROVIDER_STREAM_EVENT_DATA_LIMIT
        {
            return Err(ChatError::MalformedStream);
        }
        self.event_data_bytes += separator_bytes + data.len();
        self.data_lines.push(data.to_string());
        Ok(())
    }

    fn flush_event(&mut self) -> Result<(), ChatError> {
        if self.data_lines.is_empty() {
            return Ok(());
        }
        let data = self.data_lines.join("\n");
        self.data_lines.clear();
        self.event_data_bytes = 0;
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
        if value.get("error").is_some() {
            Err(classify_provider_stream_error(&value))
        } else if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
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
    use super::{
        chat_completions_url, OpenAiSseParser, PROVIDER_STREAM_EVENT_DATA_LIMIT,
        PROVIDER_STREAM_LINE_BUFFER_LIMIT,
    };

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

    #[test]
    fn openai_sse_parser_rejects_oversized_chat_error_frames() {
        let mut parser = OpenAiSseParser::default();
        let oversized = format!(
            "data: {{\"error\":{{\"message\":\"{} sk-oversized-frame-secret access_token=secret /Users/example\"}}}}\n\n",
            "x".repeat(PROVIDER_STREAM_EVENT_DATA_LIMIT)
        );
        let error = parser.push(&oversized).unwrap_err();
        assert_eq!(
            error.to_string(),
            "provider returned malformed streaming data"
        );
    }

    #[test]
    fn openai_sse_parser_rejects_fragmented_oversized_no_newline_data() {
        let mut parser = OpenAiSseParser::default();
        for _ in 0..PROVIDER_STREAM_LINE_BUFFER_LIMIT {
            parser.push("x").unwrap();
        }
        let error = parser.push("x").unwrap_err();
        assert_eq!(
            error.to_string(),
            "provider returned malformed streaming data"
        );
    }

    #[test]
    fn openai_sse_parser_rejects_huge_no_newline_chunk_before_append() {
        let mut parser = OpenAiSseParser::default();
        let chunk = "x".repeat(PROVIDER_STREAM_LINE_BUFFER_LIMIT + 1);
        let error = parser.push(&chunk).unwrap_err();
        assert!(parser.buffer.is_empty());
        assert_eq!(
            error.to_string(),
            "provider returned malformed streaming data"
        );
    }

    #[test]
    fn openai_sse_parser_rejects_huge_many_line_chunk_before_processing() {
        let mut parser = OpenAiSseParser::default();
        let mut chunk = String::new();
        while chunk.len() <= PROVIDER_STREAM_LINE_BUFFER_LIMIT {
            chunk.push_str("data: {}\n");
        }
        let error = parser.push(&chunk).unwrap_err();
        assert!(parser.buffer.is_empty());
        assert!(parser.data_lines.is_empty());
        assert_eq!(
            error.to_string(),
            "provider returned malformed streaming data"
        );
    }

    #[test]
    fn openai_sse_parser_accepts_large_allowed_chat_delta_event() {
        let mut parser = OpenAiSseParser::default();
        let prefix = r#"{"choices":[{"delta":{"content":"ok"}}],"pad":""#;
        let suffix = r#""}"#;
        let content = "x".repeat(
            PROVIDER_STREAM_LINE_BUFFER_LIMIT - "data: \n\n".len() - prefix.len() - suffix.len(),
        );
        let frame = format!("data: {prefix}{content}{suffix}\n\n");
        parser.push(&frame).unwrap();
        assert_eq!(parser.finish().unwrap(), vec!["ok"]);
    }

    #[test]
    fn chat_utf8_decoder_rejects_huge_pending_chunk() {
        let mut pending = Vec::new();
        let chunk = vec![b'x'; PROVIDER_STREAM_LINE_BUFFER_LIMIT + 1];
        let error = super::decode_stream_utf8_chunk(&mut pending, &chunk).unwrap_err();
        assert!(pending.is_empty());
        assert_eq!(
            error.to_string(),
            "provider returned malformed streaming data"
        );
    }

    #[test]
    fn openai_sse_parser_rejects_unlimited_empty_data_lines() {
        let mut parser = OpenAiSseParser::default();
        let mut frame = String::new();
        for _ in 0..=256 {
            frame.push_str("data: \n");
        }
        let error = parser.push(&frame).unwrap_err();
        assert_eq!(
            error.to_string(),
            "provider returned malformed streaming data"
        );
    }
}

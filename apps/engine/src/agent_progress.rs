use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;

pub const MAX_PROGRESS_SOURCE_BYTES: u64 = 256 * 1024;
pub const MAX_SNAPSHOTS: usize = 50;
pub const MAX_RECENT_EVENTS: usize = 20;

#[derive(Clone, Debug, Default)]
pub struct AgentProgressRuntime {
    inner: Arc<Mutex<AgentProgressListResponse>>,
}

impl AgentProgressRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn publish_event(
        &self,
        event: AgentProgressEvent,
    ) -> Result<AgentProgressListResponse, AgentProgressError> {
        validate_event(&event)?;
        let mut guard = self.inner.lock().await;
        guard.generated_at = Some(event.timestamp.clone());
        upsert_event_snapshot(&mut guard, event);
        normalize_response(&mut guard)?;
        Ok(guard.clone())
    }

    pub async fn snapshot(&self) -> AgentProgressListResponse {
        self.inner.lock().await.clone()
    }
}

pub fn progress_source_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join("agent-progress").join("progress.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressListResponse {
    pub cloud_required: bool,
    pub provider_access: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<String>,
    pub snapshots: Vec<AgentProgressSnapshot>,
}

impl AgentProgressListResponse {
    pub fn empty() -> Self {
        Self {
            cloud_required: false,
            provider_access: "direct".to_string(),
            generated_at: None,
            snapshots: Vec::new(),
        }
    }
}

impl Default for AgentProgressListResponse {
    fn default() -> Self {
        Self::empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressSnapshot {
    pub protocol_version: String,
    pub run_id: String,
    pub card_id: String,
    pub started_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub phase: String,
    pub status: String,
    pub message: String,
    pub elapsed_ms: u64,
    pub age_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_heartbeat_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_age_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tool_output_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output_age_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_tool: Option<AgentProgressToolSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stuck_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overflow_recovery: Option<AgentProgressOverflowRecovery>,
    pub recent_events: Vec<AgentProgressRecentEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressToolSummary {
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressOverflowRecovery {
    pub kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressRecentEvent {
    pub event_id: String,
    pub timestamp: String,
    pub phase: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressEvent {
    pub protocol_version: String,
    pub event_id: String,
    pub run_id: String,
    pub card_id: String,
    pub timestamp: String,
    pub phase: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<AgentProgressToolSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat: Option<AgentProgressHeartbeat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ide_action: Option<AgentProgressIdeAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressHeartbeat {
    pub last_heartbeat_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tool_output_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressIdeAction {
    pub request_id: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<AgentProgressRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressRange {
    pub start: AgentProgressPosition,
    pub end: AgentProgressPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentProgressPosition {
    pub line: u64,
    pub character: u64,
}

#[derive(Debug, Error)]
pub enum AgentProgressError {
    #[error("agent progress unavailable")]
    Unavailable,
}

pub async fn load_progress(
    cache_dir: &Path,
) -> Result<AgentProgressListResponse, AgentProgressError> {
    let path = progress_source_path(cache_dir);
    reject_symlink(path.parent().ok_or(AgentProgressError::Unavailable)?).await?;
    let metadata = match tokio::fs::symlink_metadata(&path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AgentProgressListResponse::empty());
        }
        Err(_) => return Err(AgentProgressError::Unavailable),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AgentProgressError::Unavailable);
    }
    let bytes = read_bounded(&path).await?;
    let mut response: AgentProgressListResponse =
        serde_json::from_slice(&bytes).map_err(|_| AgentProgressError::Unavailable)?;
    normalize_response(&mut response)?;
    Ok(response)
}

pub async fn load_progress_with_runtime(
    cache_dir: &Path,
    runtime: &AgentProgressRuntime,
) -> Result<AgentProgressListResponse, AgentProgressError> {
    let mut response = load_progress(cache_dir).await?;
    let runtime_response = runtime.snapshot().await;
    if runtime_response.snapshots.is_empty() {
        return Ok(response);
    }
    response.generated_at = runtime_response.generated_at;
    for snapshot in runtime_response.snapshots {
        if let Some(existing) = response
            .snapshots
            .iter_mut()
            .find(|value| value.run_id == snapshot.run_id && value.card_id == snapshot.card_id)
        {
            *existing = snapshot;
        } else {
            response.snapshots.push(snapshot);
        }
    }
    if response.snapshots.len() > MAX_SNAPSHOTS {
        response.snapshots.truncate(MAX_SNAPSHOTS);
    }
    normalize_response(&mut response)?;
    Ok(response)
}

fn upsert_event_snapshot(response: &mut AgentProgressListResponse, event: AgentProgressEvent) {
    let recent_event = AgentProgressRecentEvent {
        event_id: event.event_id.clone(),
        timestamp: event.timestamp.clone(),
        phase: event.phase.clone(),
        status: event.status.clone(),
        message: event.message.clone(),
    };
    let snapshot = response
        .snapshots
        .iter_mut()
        .find(|snapshot| snapshot.run_id == event.run_id && snapshot.card_id == event.card_id);
    if let Some(snapshot) = snapshot {
        snapshot.updated_at = event.timestamp.clone();
        snapshot.phase = event.phase;
        snapshot.status = event.status;
        snapshot.message = event.message;
        snapshot.current_tool = event.tool;
        snapshot.output_tail = event.output_tail;
        if let Some(heartbeat) = event.heartbeat {
            snapshot.last_heartbeat_at = Some(heartbeat.last_heartbeat_at);
            snapshot.last_tool_output_at = heartbeat.last_tool_output_at;
        }
        if matches!(snapshot.phase.as_str(), "done" | "failed") {
            snapshot.completed_at = Some(snapshot.updated_at.clone());
        }
        snapshot.recent_events.push(recent_event);
        if snapshot.recent_events.len() > MAX_RECENT_EVENTS {
            let overflow = snapshot.recent_events.len() - MAX_RECENT_EVENTS;
            snapshot.recent_events.drain(0..overflow);
        }
        return;
    }
    response.snapshots.insert(
        0,
        AgentProgressSnapshot {
            protocol_version: event.protocol_version,
            run_id: event.run_id,
            card_id: event.card_id,
            started_at: event.timestamp.clone(),
            updated_at: event.timestamp.clone(),
            completed_at: matches!(event.phase.as_str(), "done" | "failed")
                .then_some(event.timestamp.clone()),
            phase: event.phase,
            status: event.status,
            message: event.message,
            elapsed_ms: 0,
            age_ms: 0,
            last_heartbeat_at: event
                .heartbeat
                .as_ref()
                .map(|heartbeat| heartbeat.last_heartbeat_at.clone()),
            heartbeat_age_ms: None,
            last_tool_output_at: event
                .heartbeat
                .and_then(|heartbeat| heartbeat.last_tool_output_at),
            tool_output_age_ms: None,
            current_tool: event.tool,
            output_tail: event.output_tail,
            stuck_reason: None,
            overflow_recovery: None,
            recent_events: vec![recent_event],
        },
    );
    if response.snapshots.len() > MAX_SNAPSHOTS {
        response.snapshots.truncate(MAX_SNAPSHOTS);
    }
}

async fn reject_symlink(path: &Path) -> Result<(), AgentProgressError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(AgentProgressError::Unavailable),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(AgentProgressError::Unavailable),
    }
}

async fn read_bounded(path: &Path) -> Result<Vec<u8>, AgentProgressError> {
    let mut bytes = Vec::new();
    open_progress_file(path)
        .await?
        .take(MAX_PROGRESS_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| AgentProgressError::Unavailable)?;
    if bytes.len() as u64 > MAX_PROGRESS_SOURCE_BYTES {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(bytes)
}

#[cfg(unix)]
async fn open_progress_file(path: &Path) -> Result<tokio::fs::File, AgentProgressError> {
    tokio::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .await
        .map_err(|_| AgentProgressError::Unavailable)
}

#[cfg(not(unix))]
async fn open_progress_file(path: &Path) -> Result<tokio::fs::File, AgentProgressError> {
    tokio::fs::File::open(path)
        .await
        .map_err(|_| AgentProgressError::Unavailable)
}

fn normalize_response(response: &mut AgentProgressListResponse) -> Result<(), AgentProgressError> {
    if response.cloud_required || response.provider_access != "direct" {
        return Err(AgentProgressError::Unavailable);
    }
    if let Some(generated_at) = &response.generated_at {
        validate_timestamp(generated_at)?;
    }
    if response.snapshots.len() > MAX_SNAPSHOTS {
        return Err(AgentProgressError::Unavailable);
    }
    for snapshot in &response.snapshots {
        if snapshot.recent_events.len() > MAX_RECENT_EVENTS {
            return Err(AgentProgressError::Unavailable);
        }
        validate_snapshot(snapshot)?;
    }
    Ok(())
}

fn validate_snapshot(snapshot: &AgentProgressSnapshot) -> Result<(), AgentProgressError> {
    if snapshot.protocol_version != "2026-05-29" {
        return Err(AgentProgressError::Unavailable);
    }
    validate_id(&snapshot.run_id, 128)?;
    validate_card_id(&snapshot.card_id)?;
    validate_timestamp(&snapshot.started_at)?;
    validate_timestamp(&snapshot.updated_at)?;
    if let Some(completed_at) = &snapshot.completed_at {
        validate_timestamp(completed_at)?;
    }
    validate_enum(
        &snapshot.phase,
        &[
            "queued",
            "started",
            "reading_context",
            "editing",
            "running_command",
            "waiting_for_tool",
            "verifying",
            "finishing",
            "done",
            "failed",
            "stuck",
        ],
    )?;
    validate_enum(
        &snapshot.status,
        &[
            "pending",
            "running",
            "healthy_running",
            "long_running",
            "stalled",
            "stuck",
            "done",
            "failed",
        ],
    )?;
    validate_safe_string(&snapshot.message, 1, 280)?;
    validate_duration(snapshot.elapsed_ms, 604_800_000)?;
    validate_duration(snapshot.age_ms, 604_800_000)?;
    if let Some(last_heartbeat_at) = &snapshot.last_heartbeat_at {
        validate_timestamp(last_heartbeat_at)?;
    }
    if let Some(heartbeat_age_ms) = snapshot.heartbeat_age_ms {
        validate_duration(heartbeat_age_ms, 604_800_000)?;
    }
    if let Some(last_tool_output_at) = &snapshot.last_tool_output_at {
        validate_timestamp(last_tool_output_at)?;
    }
    if let Some(tool_output_age_ms) = snapshot.tool_output_age_ms {
        validate_duration(tool_output_age_ms, 604_800_000)?;
    }
    if let Some(tool) = &snapshot.current_tool {
        validate_tool(tool)?;
    }
    if let Some(output_tail) = &snapshot.output_tail {
        validate_safe_string(output_tail, 0, 2000)?;
    }
    if let Some(stuck_reason) = &snapshot.stuck_reason {
        validate_enum(
            stuck_reason,
            &[
                "heartbeat_timeout",
                "tool_output_timeout",
                "explicit_failure",
                "explicit_stuck",
                "none",
            ],
        )?;
    }
    if let Some(overflow_recovery) = &snapshot.overflow_recovery {
        if snapshot.phase == "done" {
            return Err(AgentProgressError::Unavailable);
        }
        validate_enum(&snapshot.status, &["failed", "stuck", "stalled"])?;
        validate_overflow_recovery(overflow_recovery)?;
    }
    for event in &snapshot.recent_events {
        validate_recent_event(event)?;
    }
    Ok(())
}

fn validate_event(event: &AgentProgressEvent) -> Result<(), AgentProgressError> {
    if event.protocol_version != "2026-05-29" {
        return Err(AgentProgressError::Unavailable);
    }
    validate_id(&event.event_id, 128)?;
    validate_id(&event.run_id, 128)?;
    validate_card_id(&event.card_id)?;
    validate_timestamp(&event.timestamp)?;
    validate_enum(
        &event.phase,
        &[
            "queued",
            "started",
            "reading_context",
            "editing",
            "running_command",
            "waiting_for_tool",
            "verifying",
            "finishing",
            "done",
            "failed",
            "stuck",
        ],
    )?;
    validate_enum(
        &event.status,
        &[
            "pending",
            "running",
            "healthy_running",
            "long_running",
            "stalled",
            "stuck",
            "done",
            "failed",
        ],
    )?;
    validate_safe_string(&event.message, 1, 280)?;
    if let Some(tool) = &event.tool {
        validate_tool(tool)?;
    }
    if let Some(heartbeat) = &event.heartbeat {
        validate_timestamp(&heartbeat.last_heartbeat_at)?;
        if let Some(last_tool_output_at) = &heartbeat.last_tool_output_at {
            validate_timestamp(last_tool_output_at)?;
        }
        if let Some(attempt) = heartbeat.attempt {
            if !(1..=100).contains(&attempt) {
                return Err(AgentProgressError::Unavailable);
            }
        }
    }
    if let Some(output_tail) = &event.output_tail {
        validate_safe_string(output_tail, 0, 2000)?;
    }
    if let Some(ide_action) = &event.ide_action {
        validate_ide_action(ide_action)?;
    }
    Ok(())
}

fn validate_ide_action(action: &AgentProgressIdeAction) -> Result<(), AgentProgressError> {
    validate_request_id(&action.request_id, 128)?;
    match action.action.as_str() {
        "getContextSnapshot" => {
            if action.workspace_relative_path.is_some() || action.range.is_some() {
                return Err(AgentProgressError::Unavailable);
            }
        }
        "openWorkspaceFile" => {
            let Some(path) = &action.workspace_relative_path else {
                return Err(AgentProgressError::Unavailable);
            };
            validate_safe_relative_path(path)?;
            if action.range.is_some() {
                return Err(AgentProgressError::Unavailable);
            }
        }
        "revealWorkspaceRange" => {
            let Some(path) = &action.workspace_relative_path else {
                return Err(AgentProgressError::Unavailable);
            };
            validate_safe_relative_path(path)?;
            let Some(range) = &action.range else {
                return Err(AgentProgressError::Unavailable);
            };
            validate_range(range)?;
        }
        _ => return Err(AgentProgressError::Unavailable),
    }
    if let Some(source) = &action.source {
        validate_enum(source, &["vscode", "engine"])?;
    }
    Ok(())
}

fn validate_range(range: &AgentProgressRange) -> Result<(), AgentProgressError> {
    validate_position(&range.start)?;
    validate_position(&range.end)?;
    if range.end.line < range.start.line
        || (range.end.line == range.start.line && range.end.character < range.start.character)
    {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn validate_position(position: &AgentProgressPosition) -> Result<(), AgentProgressError> {
    if position.line > 1_000_000 || position.character > 1_000_000 {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn validate_safe_relative_path(value: &str) -> Result<(), AgentProgressError> {
    if value.is_empty()
        || value.chars().count() > 512
        || value.starts_with('/')
        || value.starts_with('~')
        || value.starts_with('.')
        || value.ends_with('/')
        || value.contains("..")
        || value.contains("//")
        || value.contains('\\')
        || value.contains(':')
        || value.contains('%')
        || value.contains('?')
        || value.contains('#')
        || value.chars().any(|ch| ch.is_control())
    {
        return Err(AgentProgressError::Unavailable);
    }
    if value.split('/').any(is_secret_like_path_segment) {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn is_secret_like_path_segment(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("sk-")
        || lower == "auth"
        || lower == "authorization"
        || lower == "bearer"
        || lower == "cookie"
        || lower == "credential"
        || lower == "credentials"
        || lower == "password"
        || lower == "secret"
        || lower == "token"
        || lower == "access_token"
        || lower == "access-token"
        || lower == "apikey"
        || lower == "api_key"
        || lower == "api-key"
        || ["auth", "credential", "credentials", "password", "secret", "token", "access_token", "access-token", "api_key", "api-key"]
            .iter()
            .any(|marker| lower.starts_with(&format!("{marker}.")) || lower.starts_with(&format!("{marker}-")) || lower.starts_with(&format!("{marker}_")) || lower.ends_with(&format!(".{marker}")) || lower.ends_with(&format!("-{marker}")) || lower.ends_with(&format!("_{marker}")) || lower.contains(&format!(".{marker}.")) || lower.contains(&format!("-{marker}-")) || lower.contains(&format!("_{marker}_")))
}

fn validate_tool(tool: &AgentProgressToolSummary) -> Result<(), AgentProgressError> {
    validate_enum(
        &tool.kind,
        &[
            "read",
            "edit",
            "command",
            "test",
            "validation",
            "network",
            "planner",
            "other",
        ],
    )?;
    validate_safe_string(&tool.label, 1, 160)?;
    if let Some(started_at) = &tool.started_at {
        validate_timestamp(started_at)?;
    }
    if let Some(elapsed_ms) = tool.elapsed_ms {
        validate_duration(elapsed_ms, 86_400_000)?;
    }
    Ok(())
}

fn validate_overflow_recovery(
    recovery: &AgentProgressOverflowRecovery,
) -> Result<(), AgentProgressError> {
    validate_enum(
        &recovery.kind,
        &[
            "context_length_exceeded",
            "tool_output_too_large",
            "task_board_output_too_large",
        ],
    )?;
    validate_safe_string(&recovery.message, 1, 320)?;
    Ok(())
}

fn validate_recent_event(event: &AgentProgressRecentEvent) -> Result<(), AgentProgressError> {
    validate_id(&event.event_id, 128)?;
    validate_timestamp(&event.timestamp)?;
    validate_enum(
        &event.phase,
        &[
            "queued",
            "started",
            "reading_context",
            "editing",
            "running_command",
            "waiting_for_tool",
            "verifying",
            "finishing",
            "done",
            "failed",
            "stuck",
        ],
    )?;
    validate_enum(
        &event.status,
        &[
            "pending",
            "running",
            "healthy_running",
            "long_running",
            "stalled",
            "stuck",
            "done",
            "failed",
        ],
    )?;
    validate_safe_string(&event.message, 1, 280)?;
    Ok(())
}

fn validate_id(value: &str, max_length: usize) -> Result<(), AgentProgressError> {
    if value.is_empty() || value.len() > max_length {
        return Err(AgentProgressError::Unavailable);
    }
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(AgentProgressError::Unavailable);
    };
    if !first.is_ascii_alphanumeric() {
        return Err(AgentProgressError::Unavailable);
    }
    if !chars
        .all(|value| value.is_ascii_alphanumeric() || value == '_' || value == '.' || value == '-')
    {
        return Err(AgentProgressError::Unavailable);
    }
    if has_secret_id_marker(value) {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn has_secret_id_marker(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("authorization")
        || lower.contains("bearer")
        || lower.contains("apikey")
        || lower.contains("api_key")
        || lower.contains("api-key")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("access_token")
        || lower.contains("access-token")
        || lower.contains("accesstoken")
        || lower.contains("sk-proj-")
        || lower.starts_with("sk-")
}

fn validate_request_id(value: &str, max_length: usize) -> Result<(), AgentProgressError> {
    validate_id(value, max_length)?;
    let lower = value.to_ascii_lowercase();
    if lower.contains("authorization")
        || lower.contains("bearer")
        || lower.contains("apikey")
        || lower.contains("api_key")
        || lower.contains("api-key")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("access_token")
        || lower.contains("access-token")
        || lower.contains("accesstoken")
        || lower.contains("sk-proj-")
        || lower.starts_with("sk-")
    {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn validate_card_id(value: &str) -> Result<(), AgentProgressError> {
    if value.is_empty() || value.len() > 64 {
        return Err(AgentProgressError::Unavailable);
    }
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(AgentProgressError::Unavailable);
    };
    if !first.is_ascii_alphanumeric() {
        return Err(AgentProgressError::Unavailable);
    }
    if !chars.all(|value| value.is_ascii_alphanumeric() || value == '_' || value == '-') {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<(), AgentProgressError> {
    if value.len() < 20 || value.len() > 32 {
        return Err(AgentProgressError::Unavailable);
    }
    if !value.ends_with('Z') {
        return Err(AgentProgressError::Unavailable);
    }
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| AgentProgressError::Unavailable)
}

fn validate_duration(value: u64, max: u64) -> Result<(), AgentProgressError> {
    if value > max {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn validate_enum(value: &str, allowed: &[&str]) -> Result<(), AgentProgressError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(AgentProgressError::Unavailable)
    }
}

fn validate_safe_string(
    value: &str,
    min_length: usize,
    max_length: usize,
) -> Result<(), AgentProgressError> {
    let length = value.chars().count();
    if length < min_length || length > max_length || contains_unsafe_text(value) {
        return Err(AgentProgressError::Unavailable);
    }
    Ok(())
}

fn contains_unsafe_text(value: &str) -> bool {
    let lower = value.to_lowercase();
    for marker in [
        "authorization",
        "bearer",
        "token",
        "secret",
        "password",
        "cookie",
        "pkce",
        "refresh",
        "credential",
        "/users/",
        "/home/",
        "/tmp",
        "/tmp/",
        "/var",
        "/var/",
        "/etc",
        "/etc/",
        "/opt",
        "/opt/",
        "/mnt",
        "/mnt/",
        "/volumes",
        "/volumes/",
        "/private",
        "/private/",
        "~/",
        ".codex/auth.json",
        "auth.json",
        "credential.json",
        "credentials.json",
        "begin private key",
    ] {
        if lower.contains(marker) {
            return true;
        }
    }
    let normalized = lower
        .chars()
        .filter(|value| !matches!(value, '-' | '_' | ' '))
        .collect::<String>();
    for marker in [
        "apikey",
        "accesstoken",
        "authcode",
        "chainofthought",
        "rawprompt",
        "rawdump",
        "rawoutput",
        "rawfile",
        "rawworkspace",
        "providerresponse",
        "providerbody",
        "filecontent",
        "workspacefile",
        "workspacecontent",
    ] {
        if normalized.contains(marker) {
            return true;
        }
    }
    value.contains(":\\") || value.contains(":/")
}

#[cfg(test)]
mod tests {
    use super::{contains_unsafe_text, validate_safe_relative_path};

    #[test]
    fn agent_progress_safe_relative_path_rejects_secret_like_segments() {
        assert!(validate_safe_relative_path("src/main.rs").is_ok());
        assert!(validate_safe_relative_path("docs/navigation-notes.md").is_ok());
        for path in [
            "src/access_token.txt",
            "src/api-key.json",
            "credentials/config.json",
            "secret/local.env",
            "src/sk-proj-abcdef1234567890.txt",
        ] {
            assert!(validate_safe_relative_path(path).is_err(), "{path} should be rejected");
        }
    }

    #[test]
    fn agent_progress_safe_text_rejects_private_path_matrix() {
        for text in [
            "Read /tmp",
            "Read /TMP/log",
            "Read /var",
            "Read /Volumes",
            "Read /etc",
            "Read /opt",
            "Read /mnt",
            "Opened C:/Users/Alice/file.txt",
            "Opened C:\\Users\\Alice\\file.txt",
        ] {
            assert!(contains_unsafe_text(text), "{text} should be rejected");
        }
    }
}

use std::path::{Path, PathBuf};

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncReadExt;

pub const MAX_PROGRESS_SOURCE_BYTES: u64 = 256 * 1024;
pub const MAX_SNAPSHOTS: usize = 50;
pub const MAX_RECENT_EVENTS: usize = 20;

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
    value.contains(":\\")
}

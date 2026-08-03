use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::chat_history;
use crate::project_context::manifest::{ContextManifest, MANIFEST_SCHEMA_VERSION};

const SCHEMA_VERSION: u32 = 1;
const FILE_MAX_BYTES: usize = 1_000_000;
const RECORD_MAX_BYTES: usize = 256_000;
const MAX_RECORDS: usize = 1000;
const READ_LIMIT: usize = 100;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectiveModel {
    pub provider_id: String,
    pub provider_kind: String,
    pub model_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnContextRecord {
    pub chat_id: String,
    #[serde(alias = "messageId")]
    pub user_message_id: String,
    pub turn_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assistant_message_id: Option<String>,
    pub manifest: ContextManifest,
    pub effective_model: EffectiveModel,
    pub project_revision: String,
    pub index_generation: u64,
    #[serde(default = "legacy_status")]
    pub status: TurnContextStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continued_from_turn_id: Option<String>,
    #[serde(default)]
    pub continuation_depth: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation_request_id: Option<String>,
    #[serde(default)]
    pub context_changed: bool,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnContextStatus {
    Pending,
    Streaming,
    Complete,
    Error,
    Interrupted,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnContextResponse {
    pub available: bool,
    pub records: Vec<TurnContextRecord>,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReconciliationOutcome {
    None,
    Repaired,
    Removed,
}

pub struct ReconciledTurnContext {
    pub response: TurnContextResponse,
    pub outcome: ReconciliationOutcome,
}

#[derive(Debug, thiserror::Error)]
pub enum TurnContextError {
    #[error("invalid turn context request")]
    Invalid,
    #[error("turn context manifest migration required")]
    MigrationRequired,
    #[error("turn context storage error")]
    Storage,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: u32,
    project_id: String,
    chat_id: String,
    records: Vec<TurnContextRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyStore {
    project_id: String,
    chat_id: String,
    records: Vec<TurnContextRecord>,
}

pub fn record(
    project_id: &str,
    project_revision: &str,
    chat_id: &str,
    message_id: &str,
    manifest: ContextManifest,
    effective_model: EffectiveModel,
) -> Result<TurnContextRecord, TurnContextError> {
    validate_id(project_id)?;
    chat_history::validate_chat_id(chat_id).map_err(|_| TurnContextError::Invalid)?;
    chat_history::validate_chat_id(message_id).map_err(|_| TurnContextError::Invalid)?;
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION
        || manifest.project_id != project_id
        || manifest.inventory_generation > i64::MAX as u64
    {
        return Err(TurnContextError::Invalid);
    }
    let turn_id = new_id("turn")?;
    Ok(TurnContextRecord {
        chat_id: chat_id.into(),
        user_message_id: message_id.into(),
        turn_id,
        assistant_message_id: None,
        index_generation: manifest.inventory_generation,
        manifest,
        effective_model,
        project_revision: project_revision.into(),
        status: TurnContextStatus::Pending,
        finish_reason: None,
        error_code: None,
        continued_from_turn_id: None,
        continuation_depth: 0,
        continuation_request_id: None,
        context_changed: false,
        created_at: timestamp_now(),
        updated_at: timestamp_now(),
    })
}

pub async fn claim_continuation(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    source_turn_id: &str,
    request_id: &str,
    expected_project_revision: &str,
    expected_manifest_id: &str,
) -> Result<TurnContextRecord, TurnContextError> {
    validate_id(project_id)?;
    validate_id(source_turn_id)?;
    validate_id(request_id)?;
    let path = path(root, chat_id)?;
    let mut store = read_store(&path, project_id, chat_id)
        .await?
        .ok_or(TurnContextError::Invalid)?;
    if store.records.iter().any(|record| {
        record.continued_from_turn_id.as_deref() == Some(source_turn_id)
            || record.continuation_request_id.as_deref() == Some(request_id)
    }) {
        return Err(TurnContextError::Invalid);
    }
    let source_index = store
        .records
        .iter()
        .position(|record| record.turn_id == source_turn_id)
        .ok_or(TurnContextError::Invalid)?;
    let source = &store.records[source_index];
    if source.status != TurnContextStatus::Interrupted
        || source.assistant_message_id.is_none()
        || source.project_revision != expected_project_revision
        || source.manifest.manifest_id != expected_manifest_id
        || source.continuation_depth >= 3
        || store.records[source_index + 1..].iter().any(|record| {
            record.status != TurnContextStatus::Error
                || record.continued_from_turn_id.as_deref() == Some(source_turn_id)
        })
    {
        return Err(TurnContextError::Invalid);
    }
    let mut continuation = record(
        project_id,
        expected_project_revision,
        chat_id,
        &source.user_message_id,
        source.manifest.clone(),
        source.effective_model.clone(),
    )?;
    continuation.continued_from_turn_id = Some(source_turn_id.into());
    continuation.continuation_depth = source.continuation_depth + 1;
    continuation.continuation_request_id = Some(request_id.into());
    continuation.context_changed = false;
    store.records.push(continuation.clone());
    write_store(&path, &store).await?;
    Ok(continuation)
}

pub async fn append(
    root: &Path,
    project_id: &str,
    record: TurnContextRecord,
) -> Result<(), TurnContextError> {
    validate_id(project_id)?;
    if record.chat_id.is_empty()
        || record.manifest.schema_version != MANIFEST_SCHEMA_VERSION
        || record.manifest.project_id != project_id
    {
        return Err(TurnContextError::Invalid);
    }
    let path = path(root, &record.chat_id)?;
    crate::storage::ensure_store_namespace(root, true)
        .await
        .map_err(|_| TurnContextError::Storage)?;
    let mut store = match read_store(&path, project_id, &record.chat_id).await? {
        Some(store) => store,
        None => Store {
            schema_version: SCHEMA_VERSION,
            project_id: project_id.into(),
            chat_id: record.chat_id.clone(),
            records: Vec::new(),
        },
    };
    if let Some(existing) = store
        .records
        .iter()
        .find(|item| item.turn_id == record.turn_id)
    {
        return if existing == &record {
            Ok(())
        } else {
            Err(TurnContextError::Invalid)
        };
    }
    if store.records.len() >= MAX_RECORDS
        || serde_json::to_vec(&record)
            .map_err(|_| TurnContextError::Invalid)?
            .len()
            > RECORD_MAX_BYTES
    {
        return Err(TurnContextError::Storage);
    }
    store.records.push(record);
    write_store(&path, &store).await
}

pub async fn remove(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    turn_id: &str,
) -> Result<(), TurnContextError> {
    #[cfg(test)]
    fail_if_injected(root, FailureStage::Remove)?;
    validate_id(project_id)?;
    validate_id(turn_id)?;
    let path = path(root, chat_id)?;
    let mut store = read_store(&path, project_id, chat_id)
        .await?
        .ok_or(TurnContextError::Storage)?;
    let Some(index) = store
        .records
        .iter()
        .position(|record| record.turn_id == turn_id)
    else {
        return Ok(());
    };
    store.records.remove(index);
    write_store(&path, &store).await
}

pub async fn read(
    root: &Path,
    project_id: &str,
    chat_id: &str,
) -> Result<TurnContextResponse, TurnContextError> {
    Ok(read_with_outcome(root, project_id, chat_id).await?.0)
}

async fn read_with_outcome(
    root: &Path,
    project_id: &str,
    chat_id: &str,
) -> Result<(TurnContextResponse, bool), TurnContextError> {
    if !crate::storage::ensure_store_namespace(root, false)
        .await
        .map_err(|_| TurnContextError::Storage)?
    {
        return Ok((
            TurnContextResponse {
                available: false,
                records: Vec::new(),
                truncated: false,
            },
            false,
        ));
    }
    let path = path(root, chat_id)?;
    let Some(mut store) = read_store(&path, project_id, chat_id).await? else {
        return Ok((
            TurnContextResponse {
                available: false,
                records: Vec::new(),
                truncated: false,
            },
            false,
        ));
    };
    let mut repaired = false;
    for record in &mut store.records {
        if matches!(
            record.status,
            TurnContextStatus::Pending | TurnContextStatus::Streaming
        ) {
            record.assistant_message_id = None;
            record.status = TurnContextStatus::Interrupted;
            record.finish_reason = Some("interrupted".into());
            record.error_code = None;
            record.updated_at = timestamp_now();
            repaired = true;
        }
    }
    if repaired {
        write_store(&path, &store).await?;
    }
    let truncated = store.records.len() > READ_LIMIT;
    let records = store
        .records
        .into_iter()
        .rev()
        .take(READ_LIMIT)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    Ok((
        TurnContextResponse {
            available: true,
            records,
            truncated,
        },
        repaired,
    ))
}

pub async fn read_reconciled(
    root: &Path,
    history_root: &Path,
    project_id: &str,
    chat_id: &str,
) -> Result<TurnContextResponse, TurnContextError> {
    Ok(
        read_reconciled_with_outcome(root, history_root, project_id, chat_id)
            .await?
            .response,
    )
}

pub async fn read_reconciled_with_outcome(
    root: &Path,
    history_root: &Path,
    project_id: &str,
    chat_id: &str,
) -> Result<ReconciledTurnContext, TurnContextError> {
    let (mut response, read_repaired) = read_with_outcome(root, project_id, chat_id).await?;
    if !response.available {
        return Ok(ReconciledTurnContext {
            response,
            outcome: ReconciliationOutcome::None,
        });
    }
    let mut history = match chat_history::get_thread_in(history_root, chat_id).await {
        Ok(history) => Some(history),
        Err(chat_history::ChatHistoryError::NotFound) => None,
        Err(_) => return Err(TurnContextError::Storage),
    };
    let mut changed = false;
    let mut removed = Vec::new();
    for record in &mut response.records {
        let user_index = history.as_ref().and_then(|thread| {
            thread.messages.iter().position(|message| {
                message.id == record.user_message_id
                    && message.role == chat_history::ChatMessageRole::User
            })
        });
        if user_index.is_none() {
            removed.push(record.turn_id.clone());
            changed = true;
            continue;
        }
        let linked = record
            .assistant_message_id
            .as_ref()
            .is_some_and(|message_id| {
                history.as_ref().is_some_and(|thread| {
                    thread.messages.iter().any(|message| {
                        message.id == *message_id
                            && matches!(
                                message.role,
                                chat_history::ChatMessageRole::Assistant
                                    | chat_history::ChatMessageRole::Error
                            )
                    })
                })
            });
        let has_terminal_after_user = history.as_ref().is_some_and(|thread| {
            thread.messages[user_index.unwrap() + 1..]
                .iter()
                .take_while(|message| message.role != chat_history::ChatMessageRole::User)
                .any(|message| {
                    matches!(
                        message.role,
                        chat_history::ChatMessageRole::Assistant
                            | chat_history::ChatMessageRole::Error
                    )
                })
        });
        if !linked && !has_terminal_after_user {
            let mut tombstone = chat_history::new_message(
                chat_id,
                chat_history::ChatMessageRole::Error,
                "Chat response persistence was interrupted. Retry the request.".into(),
                Some(chat_history::ChatMessageStatus::Error),
            )
            .map_err(|_| TurnContextError::Storage)?;
            if let Some(message_id) = &record.assistant_message_id {
                tombstone.id = message_id.clone();
            }
            let tombstone = chat_history::append_existing_message_in(history_root, tombstone)
                .await
                .map_err(|_| TurnContextError::Storage)?;
            if let Some(thread) = &mut history {
                thread.messages.push(tombstone.clone());
            } else {
                history = Some(
                    chat_history::get_thread_in(history_root, chat_id)
                        .await
                        .map_err(|_| TurnContextError::Storage)?,
                );
            }
            record.assistant_message_id = Some(tombstone.id);
            record.status = TurnContextStatus::Error;
            record.finish_reason = None;
            record.error_code = Some("terminal_history_missing".into());
            record.updated_at = timestamp_now();
            changed = true;
        }
    }
    if changed {
        let path = path(root, chat_id)?;
        let mut store = read_store(&path, project_id, chat_id)
            .await?
            .ok_or(TurnContextError::Storage)?;
        store
            .records
            .retain(|record| !removed.contains(&record.turn_id));
        for repaired in &response.records {
            if removed.contains(&repaired.turn_id) {
                continue;
            }
            if let Some(record) = store
                .records
                .iter_mut()
                .find(|record| record.turn_id == repaired.turn_id)
            {
                *record = repaired.clone();
            }
        }
        write_store(&path, &store).await?;
        response
            .records
            .retain(|record| !removed.contains(&record.turn_id));
    }
    let outcome = if !removed.is_empty() {
        ReconciliationOutcome::Removed
    } else if read_repaired || changed {
        ReconciliationOutcome::Repaired
    } else {
        ReconciliationOutcome::None
    };
    Ok(ReconciledTurnContext { response, outcome })
}

pub async fn mark_streaming(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    turn_id: &str,
) -> Result<(), TurnContextError> {
    #[cfg(test)]
    fail_if_injected(root, FailureStage::MarkStreaming)?;
    update(root, project_id, chat_id, turn_id, |record| {
        record.status = TurnContextStatus::Streaming;
        record.updated_at = timestamp_now();
    })
    .await
}

pub async fn mark_terminal(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    turn_id: &str,
    assistant_message_id: &str,
    status: TurnContextStatus,
    finish_reason: Option<&str>,
    error_code: Option<&str>,
) -> Result<(), TurnContextError> {
    if !matches!(
        status,
        TurnContextStatus::Complete | TurnContextStatus::Error | TurnContextStatus::Interrupted
    ) {
        return Err(TurnContextError::Invalid);
    }
    chat_history::validate_chat_id(assistant_message_id).map_err(|_| TurnContextError::Invalid)?;
    #[cfg(test)]
    fail_if_injected(root, FailureStage::MarkTerminal)?;
    update(root, project_id, chat_id, turn_id, |record| {
        record.assistant_message_id = Some(assistant_message_id.into());
        record.status = status;
        record.finish_reason = finish_reason.map(str::to_string);
        record.error_code = error_code.map(str::to_string);
        record.updated_at = timestamp_now();
    })
    .await
}

pub async fn link_terminal(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    turn_id: &str,
    assistant_message_id: &str,
) -> Result<(), TurnContextError> {
    chat_history::validate_chat_id(assistant_message_id).map_err(|_| TurnContextError::Invalid)?;
    #[cfg(test)]
    fail_if_injected(root, FailureStage::LinkTerminal)?;
    update(root, project_id, chat_id, turn_id, |record| {
        record.assistant_message_id = Some(assistant_message_id.into());
        record.updated_at = timestamp_now();
    })
    .await
}

pub async fn mark_interrupted(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    turn_id: &str,
    error_code: &str,
) -> Result<(), TurnContextError> {
    #[cfg(test)]
    fail_if_injected(root, FailureStage::MarkInterrupted)?;
    update(root, project_id, chat_id, turn_id, |record| {
        record.assistant_message_id = None;
        record.status = TurnContextStatus::Interrupted;
        record.finish_reason = Some("interrupted".into());
        record.error_code = Some(error_code.into());
        record.updated_at = timestamp_now();
    })
    .await
}

pub async fn mark_interrupted_with_reason(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    turn_id: &str,
    finish_reason: &str,
) -> Result<(), TurnContextError> {
    if !matches!(finish_reason, "abort" | "superseded") {
        return Err(TurnContextError::Invalid);
    }
    #[cfg(test)]
    fail_if_injected(root, FailureStage::MarkInterrupted)?;
    update(root, project_id, chat_id, turn_id, |record| {
        record.assistant_message_id = None;
        record.status = TurnContextStatus::Interrupted;
        record.finish_reason = Some(finish_reason.into());
        record.error_code = None;
        record.updated_at = timestamp_now();
    })
    .await
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum FailureStage {
    Remove,
    MarkStreaming,
    MarkInterrupted,
    LinkTerminal,
    MarkTerminal,
}

#[cfg(test)]
fn injected_failures(
) -> &'static std::sync::Mutex<std::collections::HashSet<(PathBuf, FailureStage)>> {
    static FAILURES: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashSet<(PathBuf, FailureStage)>>,
    > = std::sync::OnceLock::new();
    FAILURES.get_or_init(Default::default)
}

#[cfg(test)]
fn fail_if_injected(root: &Path, stage: FailureStage) -> Result<(), TurnContextError> {
    if injected_failures()
        .lock()
        .unwrap()
        .remove(&(root.to_path_buf(), stage))
    {
        Err(TurnContextError::Storage)
    } else {
        Ok(())
    }
}

#[cfg(test)]
pub fn inject_failure(root: &Path, stage: FailureStage) {
    injected_failures()
        .lock()
        .unwrap()
        .insert((root.to_path_buf(), stage));
}

async fn update(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    turn_id: &str,
    mutate: impl FnOnce(&mut TurnContextRecord),
) -> Result<(), TurnContextError> {
    validate_id(project_id)?;
    validate_id(turn_id)?;
    let path = path(root, chat_id)?;
    let mut store = read_store(&path, project_id, chat_id)
        .await?
        .ok_or(TurnContextError::Storage)?;
    let record = store
        .records
        .iter_mut()
        .find(|record| record.turn_id == turn_id)
        .ok_or(TurnContextError::Storage)?;
    mutate(record);
    write_store(&path, &store).await
}

pub async fn delete_chat(root: &Path, chat_id: &str) -> Result<(), TurnContextError> {
    let path = path(root, chat_id)?;
    reject_symlink(&path).await?;
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(TurnContextError::Storage),
    }
}

pub async fn delete_project(root: &Path) -> Result<(), TurnContextError> {
    if !crate::storage::ensure_store_namespace(root, false)
        .await
        .map_err(|_| TurnContextError::Storage)?
    {
        return Ok(());
    }
    tokio::fs::remove_dir_all(root)
        .await
        .map_err(|_| TurnContextError::Storage)
}

async fn read_store(
    path: &Path,
    project_id: &str,
    chat_id: &str,
) -> Result<Option<Store>, TurnContextError> {
    reject_symlink(path).await?;
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) if bytes.len() <= FILE_MAX_BYTES => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        _ => return Err(TurnContextError::Storage),
    };
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| TurnContextError::Storage)?;
    let version = value
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let store = match version {
        0 => {
            let legacy: LegacyStore =
                serde_json::from_value(value).map_err(|_| TurnContextError::Storage)?;
            Store {
                schema_version: SCHEMA_VERSION,
                project_id: legacy.project_id,
                chat_id: legacy.chat_id,
                records: legacy.records,
            }
        }
        1 => serde_json::from_value(value).map_err(|_| TurnContextError::Storage)?,
        _ => return Err(TurnContextError::Storage),
    };
    if store.project_id != project_id
        || store.chat_id != chat_id
        || store.records.len() > MAX_RECORDS
        || store
            .records
            .iter()
            .any(|record| record.chat_id != chat_id || record.manifest.project_id != project_id)
    {
        return Err(TurnContextError::Storage);
    }
    if store
        .records
        .iter()
        .any(|record| record.manifest.schema_version != MANIFEST_SCHEMA_VERSION)
    {
        return Err(TurnContextError::MigrationRequired);
    }
    Ok(Some(store))
}

async fn write_store(path: &Path, store: &Store) -> Result<(), TurnContextError> {
    let bytes = serde_json::to_vec(store).map_err(|_| TurnContextError::Storage)?;
    crate::storage::atomic_write_private_file(
        path,
        &bytes,
        crate::storage::AtomicPrivateWriteOptions {
            max_bytes: FILE_MAX_BYTES,
            mode: crate::storage::AtomicPrivateWriteMode::Replace,
            parent_sync: crate::storage::AtomicPrivateParentSync::BestEffortUnsupported,
        },
    )
    .await
    .map(|_| ())
    .map_err(|_| TurnContextError::Storage)
}

fn path(root: &Path, chat_id: &str) -> Result<PathBuf, TurnContextError> {
    chat_history::validate_chat_id(chat_id).map_err(|_| TurnContextError::Invalid)?;
    let path = root.join(format!("{chat_id}.json"));
    (path.parent() == Some(root))
        .then_some(path)
        .ok_or(TurnContextError::Invalid)
}

async fn reject_symlink(path: &Path) -> Result<(), TurnContextError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(TurnContextError::Storage),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(TurnContextError::Storage),
    }
}

fn validate_id(value: &str) -> Result<(), TurnContextError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        Err(TurnContextError::Invalid)
    } else {
        Ok(())
    }
}

fn new_id(prefix: &str) -> Result<String, TurnContextError> {
    use base64::Engine;
    let mut bytes = [0_u8; 18];
    getrandom::getrandom(&mut bytes).map_err(|_| TurnContextError::Storage)?;
    Ok(format!(
        "{prefix}_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    ))
}

fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn legacy_status() -> TurnContextStatus {
    TurnContextStatus::Interrupted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(project_id: &str, id: &str) -> ContextManifest {
        ContextManifest {
            protocol_version: "2026-08-02".into(),
            schema_version: MANIFEST_SCHEMA_VERSION,
            manifest_id: id.into(),
            project_id: project_id.into(),
            profile_id: None,
            plan_id: "plan-1".into(),
            mode: crate::project_context::manifest::ContextMode::Balanced,
            inventory_generation: 7,
            query_hash: format!("sha256:{}", "a".repeat(64)),
            ranking_version: "lexical-symbol-ranking-1".into(),
            budget: crate::project_context::manifest::EffectiveBudget {
                max_files: 2,
                max_chunks: 3,
                max_bytes: 100,
                max_estimated_tokens: 25,
                used_files: 1,
                used_chunks: 1,
                used_bytes: 20,
                used_estimated_tokens: 5,
                truncated: false,
            },
            entries: Vec::new(),
            omissions: Vec::new(),
            redaction: crate::project_context::manifest::RedactionSummary {
                metadata_only_count: 0,
                content_redacted_count: 0,
                omitted_count: 0,
            },
            created_at: "2026-08-03T00:00:00Z".into(),
        }
    }

    fn item(
        project_id: &str,
        chat_id: &str,
        message_id: &str,
        manifest_id: &str,
    ) -> TurnContextRecord {
        record(
            project_id,
            "revision-1",
            chat_id,
            message_id,
            manifest(project_id, manifest_id),
            EffectiveModel {
                provider_id: "demo-local".into(),
                provider_kind: "demo_local".into(),
                model_id: "demo-local".into(),
            },
        )
        .unwrap()
    }

    #[tokio::test]
    async fn chat_turn_context_atomic_append_read_delete_and_cache_survival() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        append(
            &root,
            "project-a",
            item("project-a", "chat_1", "msg_1", "manifest-1"),
        )
        .await
        .unwrap();
        append(
            &root,
            "project-a",
            item("project-a", "chat_1", "msg_2", "manifest-2"),
        )
        .await
        .unwrap();
        std::fs::create_dir_all(temp.path().join("cache/projects/project-a/context")).unwrap();
        std::fs::remove_dir_all(temp.path().join("cache/projects/project-a/context")).unwrap();
        let loaded = read(&root, "project-a", "chat_1").await.unwrap();
        assert!(loaded.available);
        assert_eq!(loaded.records.len(), 2);
        assert_eq!(loaded.records[1].manifest.manifest_id, "manifest-2");
        assert_eq!(loaded.records[1].status, TurnContextStatus::Interrupted);
        assert!(!serde_json::to_string(&loaded)
            .unwrap()
            .contains(temp.path().to_str().unwrap()));
        delete_chat(&root, "chat_1").await.unwrap();
        assert!(!read(&root, "project-a", "chat_1").await.unwrap().available);
    }

    #[tokio::test]
    async fn chat_turn_context_links_terminal_message_and_recovers_pending() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        let pending = item("project-a", "chat_1", "msg_user", "manifest-1");
        let turn_id = pending.turn_id.clone();
        append(&root, "project-a", pending).await.unwrap();
        mark_streaming(&root, "project-a", "chat_1", &turn_id)
            .await
            .unwrap();
        let recovered = read(&root, "project-a", "chat_1").await.unwrap();
        assert_eq!(recovered.records[0].status, TurnContextStatus::Interrupted);
        assert_eq!(
            recovered.records[0].finish_reason.as_deref(),
            Some("interrupted")
        );
        assert!(recovered.records[0].assistant_message_id.is_none());

        let second = item("project-a", "chat_1", "msg_user_2", "manifest-2");
        let second_turn_id = second.turn_id.clone();
        append(&root, "project-a", second).await.unwrap();
        mark_terminal(
            &root,
            "project-a",
            "chat_1",
            &second_turn_id,
            "msg_assistant",
            TurnContextStatus::Complete,
            Some("stop"),
            None,
        )
        .await
        .unwrap();
        let loaded = read(&root, "project-a", "chat_1").await.unwrap();
        let terminal = loaded.records.last().unwrap();
        assert_eq!(terminal.user_message_id, "msg_user_2");
        assert_eq!(
            terminal.assistant_message_id.as_deref(),
            Some("msg_assistant")
        );
        assert_eq!(terminal.status, TurnContextStatus::Complete);
        assert_eq!(terminal.finish_reason.as_deref(), Some("stop"));
    }

    #[tokio::test]
    async fn chat_turn_context_remove_and_reconciliation_are_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        let history_root = temp.path().join("config/projects/project-a/chat-history");
        let pending = item("project-a", "chat_1", "msg_user", "manifest-1");
        let pending_id = pending.turn_id.clone();
        append(&root, "project-a", pending).await.unwrap();
        remove(&root, "project-a", "chat_1", &pending_id)
            .await
            .unwrap();
        remove(&root, "project-a", "chat_1", &pending_id)
            .await
            .unwrap();
        assert!(read(&root, "project-a", "chat_1")
            .await
            .unwrap()
            .records
            .is_empty());

        let user = chat_history::append_message_in(
            &history_root,
            "chat_1",
            chat_history::ChatMessageRole::User,
            "hello".into(),
            Some(chat_history::ChatMessageStatus::Complete),
        )
        .await
        .unwrap();
        let linked = item("project-a", "chat_1", &user.id, "manifest-2");
        let linked_id = linked.turn_id.clone();
        append(&root, "project-a", linked).await.unwrap();
        mark_terminal(
            &root,
            "project-a",
            "chat_1",
            &linked_id,
            "msg_missing",
            TurnContextStatus::Complete,
            Some("stop"),
            None,
        )
        .await
        .unwrap();
        for _ in 0..2 {
            let repaired = read_reconciled(&root, &history_root, "project-a", "chat_1")
                .await
                .unwrap();
            assert_eq!(repaired.records[0].status, TurnContextStatus::Error);
            assert!(repaired.records[0].assistant_message_id.is_some());
            assert_eq!(
                repaired.records[0].error_code.as_deref(),
                Some("terminal_history_missing")
            );
        }
    }

    #[tokio::test]
    async fn chat_turn_context_reconciliation_removes_evidence_without_user_history() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        let history_root = temp.path().join("config/projects/project-a/chat-history");
        append(
            &root,
            "project-a",
            item("project-a", "chat_1", "msg_missing", "manifest-1"),
        )
        .await
        .unwrap();

        for _ in 0..2 {
            let repaired = read_reconciled(&root, &history_root, "project-a", "chat_1")
                .await
                .unwrap();
            assert!(repaired.records.is_empty());
        }
    }

    #[tokio::test]
    async fn chat_turn_context_mark_streaming_failure_repairs_to_interrupted() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        let pending = item("project-a", "chat_1", "msg_user", "manifest-1");
        let turn_id = pending.turn_id.clone();
        append(&root, "project-a", pending).await.unwrap();
        inject_failure(&root, FailureStage::MarkStreaming);

        assert!(mark_streaming(&root, "project-a", "chat_1", &turn_id)
            .await
            .is_err());
        mark_interrupted(
            &root,
            "project-a",
            "chat_1",
            &turn_id,
            "turn_context_storage_error",
        )
        .await
        .unwrap();
        let repaired = read(&root, "project-a", "chat_1").await.unwrap();
        assert_eq!(repaired.records[0].status, TurnContextStatus::Interrupted);
        assert!(repaired.records[0].assistant_message_id.is_none());
    }

    #[tokio::test]
    async fn chat_turn_context_abort_reason_survives_restart_read() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        let pending = item("project-a", "chat_1", "msg_user", "manifest-1");
        let turn_id = pending.turn_id.clone();
        append(&root, "project-a", pending).await.unwrap();

        mark_interrupted_with_reason(&root, "project-a", "chat_1", &turn_id, "abort")
            .await
            .unwrap();
        mark_interrupted_with_reason(&root, "project-a", "chat_1", &turn_id, "abort")
            .await
            .unwrap();

        let restarted = read(&root, "project-a", "chat_1").await.unwrap();
        assert_eq!(restarted.records[0].status, TurnContextStatus::Interrupted);
        assert_eq!(restarted.records[0].finish_reason.as_deref(), Some("abort"));
        assert!(restarted.records[0].assistant_message_id.is_none());
    }

    #[tokio::test]
    async fn chat_turn_context_rejects_cross_project_and_reads_legacy_envelope() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        crate::storage::ensure_store_namespace(&root, true)
            .await
            .unwrap();
        let legacy = serde_json::json!({ "projectId": "project-a", "chatId": "chat_1", "records": [item("project-a", "chat_1", "msg_1", "manifest-1")] });
        std::fs::write(
            root.join("chat_1.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        assert_eq!(
            read(&root, "project-a", "chat_1")
                .await
                .unwrap()
                .records
                .len(),
            1
        );
        append(
            &root,
            "project-a",
            item("project-a", "chat_1", "msg_2", "manifest-2"),
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &std::fs::read(root.join("chat_1.json")).unwrap()
            )
            .unwrap()["schemaVersion"],
            1
        );
        assert!(read(&root, "project-b", "chat_1").await.is_err());
        assert!(append(
            &root,
            "project-b",
            item("project-a", "chat_1", "msg_3", "manifest-3")
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn chat_turn_context_rejects_older_manifest_without_reinterpretation() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        crate::storage::ensure_store_namespace(&root, true)
            .await
            .unwrap();
        let mut old = item("project-a", "chat_1", "msg_1", "manifest-1");
        old.manifest.schema_version = MANIFEST_SCHEMA_VERSION - 1;
        let store = serde_json::json!({
            "schemaVersion": SCHEMA_VERSION,
            "projectId": "project-a",
            "chatId": "chat_1",
            "records": [old]
        });
        let path = root.join("chat_1.json");
        std::fs::write(&path, serde_json::to_vec(&store).unwrap()).unwrap();

        assert!(matches!(
            read(&root, "project-a", "chat_1").await,
            Err(TurnContextError::MigrationRequired)
        ));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).unwrap()).unwrap()
                ["records"][0]["manifest"]["schemaVersion"],
            MANIFEST_SCHEMA_VERSION - 1
        );
    }

    #[tokio::test]
    async fn chat_turn_context_bounded_read_and_project_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        for index in 0..105 {
            append(
                &root,
                "project-a",
                item(
                    "project-a",
                    "chat_1",
                    &format!("msg_{index}"),
                    &format!("manifest-{index}"),
                ),
            )
            .await
            .unwrap();
        }
        let loaded = read(&root, "project-a", "chat_1").await.unwrap();
        assert_eq!(loaded.records.len(), READ_LIMIT);
        assert!(loaded.truncated);
        delete_project(&root).await.unwrap();
        assert!(!root.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn chat_turn_context_rejects_symlink_store_and_preserves_target() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        std::fs::create_dir_all(root.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(outside.path(), &root).unwrap();
        assert!(append(
            &root,
            "project-a",
            item("project-a", "chat_1", "msg_1", "manifest-1")
        )
        .await
        .is_err());
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}

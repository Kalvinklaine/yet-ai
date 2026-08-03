use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::chat_history;
use crate::project_context::manifest::ContextManifest;

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
    pub message_id: String,
    pub turn_id: String,
    pub manifest: ContextManifest,
    pub effective_model: EffectiveModel,
    pub project_revision: String,
    pub index_generation: u64,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnContextResponse {
    pub available: bool,
    pub records: Vec<TurnContextRecord>,
    pub truncated: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum TurnContextError {
    #[error("invalid turn context request")]
    Invalid,
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
    if manifest.project_id != project_id || manifest.inventory_generation > i64::MAX as u64 {
        return Err(TurnContextError::Invalid);
    }
    let turn_id = new_id("turn")?;
    Ok(TurnContextRecord {
        chat_id: chat_id.into(),
        message_id: message_id.into(),
        turn_id,
        index_generation: manifest.inventory_generation,
        manifest,
        effective_model,
        project_revision: project_revision.into(),
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
    })
}

pub async fn append(root: &Path, project_id: &str, record: TurnContextRecord) -> Result<(), TurnContextError> {
    validate_id(project_id)?;
    if record.chat_id.is_empty() || record.manifest.project_id != project_id {
        return Err(TurnContextError::Invalid);
    }
    let path = path(root, &record.chat_id)?;
    crate::storage::ensure_store_namespace(root, true).await.map_err(|_| TurnContextError::Storage)?;
    let mut store = match read_store(&path, project_id, &record.chat_id).await? {
        Some(store) => store,
        None => Store { schema_version: SCHEMA_VERSION, project_id: project_id.into(), chat_id: record.chat_id.clone(), records: Vec::new() },
    };
    if store.records.len() >= MAX_RECORDS || serde_json::to_vec(&record).map_err(|_| TurnContextError::Invalid)?.len() > RECORD_MAX_BYTES {
        return Err(TurnContextError::Storage);
    }
    store.records.push(record);
    write_store(&path, &store).await
}

pub async fn read(root: &Path, project_id: &str, chat_id: &str) -> Result<TurnContextResponse, TurnContextError> {
    let path = path(root, chat_id)?;
    let Some(store) = read_store(&path, project_id, chat_id).await? else {
        return Ok(TurnContextResponse { available: false, records: Vec::new(), truncated: false });
    };
    let truncated = store.records.len() > READ_LIMIT;
    let records = store.records.into_iter().rev().take(READ_LIMIT).collect::<Vec<_>>().into_iter().rev().collect();
    Ok(TurnContextResponse { available: true, records, truncated })
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
    if !crate::storage::ensure_store_namespace(root, false).await.map_err(|_| TurnContextError::Storage)? { return Ok(()); }
    tokio::fs::remove_dir_all(root).await.map_err(|_| TurnContextError::Storage)
}

async fn read_store(path: &Path, project_id: &str, chat_id: &str) -> Result<Option<Store>, TurnContextError> {
    reject_symlink(path).await?;
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) if bytes.len() <= FILE_MAX_BYTES => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        _ => return Err(TurnContextError::Storage),
    };
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| TurnContextError::Storage)?;
    let version = value.get("schemaVersion").and_then(|value| value.as_u64()).unwrap_or(0);
    let store = match version {
        0 => {
            let legacy: LegacyStore = serde_json::from_value(value).map_err(|_| TurnContextError::Storage)?;
            Store { schema_version: SCHEMA_VERSION, project_id: legacy.project_id, chat_id: legacy.chat_id, records: legacy.records }
        }
        1 => serde_json::from_value(value).map_err(|_| TurnContextError::Storage)?,
        _ => return Err(TurnContextError::Storage),
    };
    if store.project_id != project_id || store.chat_id != chat_id || store.records.len() > MAX_RECORDS || store.records.iter().any(|record| record.chat_id != chat_id || record.manifest.project_id != project_id) {
        return Err(TurnContextError::Storage);
    }
    Ok(Some(store))
}

async fn write_store(path: &Path, store: &Store) -> Result<(), TurnContextError> {
    let bytes = serde_json::to_vec(store).map_err(|_| TurnContextError::Storage)?;
    crate::storage::atomic_write_private_file(path, &bytes, crate::storage::AtomicPrivateWriteOptions { max_bytes: FILE_MAX_BYTES, mode: crate::storage::AtomicPrivateWriteMode::Replace, parent_sync: crate::storage::AtomicPrivateParentSync::BestEffortUnsupported }).await.map(|_| ()).map_err(|_| TurnContextError::Storage)
}

fn path(root: &Path, chat_id: &str) -> Result<PathBuf, TurnContextError> {
    chat_history::validate_chat_id(chat_id).map_err(|_| TurnContextError::Invalid)?;
    let path = root.join(format!("{chat_id}.json"));
    (path.parent() == Some(root)).then_some(path).ok_or(TurnContextError::Invalid)
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
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')) { Err(TurnContextError::Invalid) } else { Ok(()) }
}

fn new_id(prefix: &str) -> Result<String, TurnContextError> {
    use base64::Engine;
    let mut bytes = [0_u8; 18];
    getrandom::getrandom(&mut bytes).map_err(|_| TurnContextError::Storage)?;
    Ok(format!("{prefix}_{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(project_id: &str, id: &str) -> ContextManifest {
        ContextManifest {
            protocol_version: "2026-08-02".into(), schema_version: 1, manifest_id: id.into(), project_id: project_id.into(), profile_id: None, plan_id: "plan-1".into(), mode: crate::project_context::manifest::ContextMode::Balanced, inventory_generation: 7, query_hash: format!("sha256:{}", "a".repeat(64)), ranking_version: "lexical-symbol-ranking-1".into(), budget: crate::project_context::manifest::EffectiveBudget { max_files: 2, max_chunks: 3, max_bytes: 100, max_estimated_tokens: 25, used_files: 1, used_chunks: 1, used_bytes: 20, used_estimated_tokens: 5, truncated: false }, entries: Vec::new(), omissions: Vec::new(), redaction: crate::project_context::manifest::RedactionSummary { metadata_only_count: 0, content_redacted_count: 0, omitted_count: 0 }, created_at: "2026-08-03T00:00:00Z".into(),
        }
    }

    fn item(project_id: &str, chat_id: &str, message_id: &str, manifest_id: &str) -> TurnContextRecord {
        record(project_id, "revision-1", chat_id, message_id, manifest(project_id, manifest_id), EffectiveModel { provider_id: "demo-local".into(), provider_kind: "demo_local".into(), model_id: "demo-local".into() }).unwrap()
    }

    #[tokio::test]
    async fn chat_turn_context_atomic_append_read_delete_and_cache_survival() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        append(&root, "project-a", item("project-a", "chat_1", "msg_1", "manifest-1")).await.unwrap();
        append(&root, "project-a", item("project-a", "chat_1", "msg_2", "manifest-2")).await.unwrap();
        std::fs::create_dir_all(temp.path().join("cache/projects/project-a/context")).unwrap();
        std::fs::remove_dir_all(temp.path().join("cache/projects/project-a/context")).unwrap();
        let loaded = read(&root, "project-a", "chat_1").await.unwrap();
        assert!(loaded.available);
        assert_eq!(loaded.records.len(), 2);
        assert_eq!(loaded.records[1].manifest.manifest_id, "manifest-2");
        assert!(!serde_json::to_string(&loaded).unwrap().contains(temp.path().to_str().unwrap()));
        delete_chat(&root, "chat_1").await.unwrap();
        assert!(!read(&root, "project-a", "chat_1").await.unwrap().available);
    }

    #[tokio::test]
    async fn chat_turn_context_rejects_cross_project_and_migrates_legacy() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        crate::storage::ensure_store_namespace(&root, true).await.unwrap();
        let legacy = serde_json::json!({ "projectId": "project-a", "chatId": "chat_1", "records": [item("project-a", "chat_1", "msg_1", "manifest-1")] });
        std::fs::write(root.join("chat_1.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(read(&root, "project-a", "chat_1").await.unwrap().records.len(), 1);
        append(&root, "project-a", item("project-a", "chat_1", "msg_2", "manifest-2")).await.unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&std::fs::read(root.join("chat_1.json")).unwrap()).unwrap()["schemaVersion"], 1);
        assert!(read(&root, "project-b", "chat_1").await.is_err());
        assert!(append(&root, "project-b", item("project-a", "chat_1", "msg_3", "manifest-3")).await.is_err());
    }

    #[tokio::test]
    async fn chat_turn_context_bounded_read_and_project_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("config/projects/project-a/turn-context");
        for index in 0..105 { append(&root, "project-a", item("project-a", "chat_1", &format!("msg_{index}"), &format!("manifest-{index}"))).await.unwrap(); }
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
        assert!(append(&root, "project-a", item("project-a", "chat_1", "msg_1", "manifest-1")).await.is_err());
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}

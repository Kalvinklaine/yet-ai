use std::path::{Path, PathBuf};

use base64::Engine;
use chrono::{SecondsFormat, Utc};
use http::StatusCode;
use serde::{Deserialize, Serialize};

const CHAT_HISTORY_DIR: &str = "chat-history";
const CHAT_HISTORY_FILE_MAX_BYTES: u64 = 2_000_000;
const CHAT_HISTORY_MAX_THREADS: usize = 1000;
const CHAT_HISTORY_MAX_MESSAGES: usize = 1000;
const CHAT_HISTORY_TITLE_MAX_CHARS: usize = 160;
const CHAT_HISTORY_CONTENT_MAX_CHARS: usize = 20_000;
const CHAT_HISTORY_ID_RANDOM_BYTES: usize = 18;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatThread {
    pub chat_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadSummary {
    pub chat_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatListResponse {
    pub chats: Vec<ChatThreadSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub chat_id: String,
    pub role: ChatMessageRole,
    pub content: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ChatMessageStatus>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageRole {
    User,
    Assistant,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatMessageStatus {
    Pending,
    Streaming,
    Interrupted,
    Complete,
    Error,
}

#[derive(Debug, thiserror::Error)]
pub enum ChatHistoryError {
    #[error("invalid chat id")]
    InvalidChatId,
    #[error("chat not found")]
    NotFound,
    #[error("chat history storage error")]
    Storage,
    #[error("invalid chat history record")]
    InvalidRecord,
}

impl ChatHistoryError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::InvalidChatId | Self::InvalidRecord => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Storage => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ChatThread {
    fn summary(&self) -> ChatThreadSummary {
        ChatThreadSummary {
            chat_id: self.chat_id.clone(),
            title: self.title.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            message_count: self.messages.len(),
        }
    }
}

pub async fn list_threads(config_dir: &Path) -> Result<ChatListResponse, ChatHistoryError> {
    list_threads_in(&chat_history_root(config_dir)).await
}

pub async fn list_threads_in(root: &Path) -> Result<ChatListResponse, ChatHistoryError> {
    let root = root.to_path_buf();
    if !crate::storage::ensure_store_namespace(&root, false)
        .await
        .map_err(|_| ChatHistoryError::Storage)?
    {
        return Ok(ChatListResponse { chats: Vec::new() });
    }
    let mut entries = tokio::fs::read_dir(&root)
        .await
        .map_err(|_| ChatHistoryError::Storage)?;
    let mut chats = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|_| ChatHistoryError::Storage)?
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if chats.len() >= CHAT_HISTORY_MAX_THREADS {
            return Err(ChatHistoryError::Storage);
        }
        let thread = read_thread_path(&path).await?;
        chats.push(thread.summary());
    }
    chats.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.chat_id.cmp(&right.chat_id))
    });
    Ok(ChatListResponse { chats })
}

pub async fn create_thread(config_dir: &Path) -> Result<ChatThread, ChatHistoryError> {
    create_thread_in(&chat_history_root(config_dir)).await
}

pub async fn create_thread_in(root: &Path) -> Result<ChatThread, ChatHistoryError> {
    for _ in 0..8 {
        let chat_id = new_chat_id()?;
        let path = chat_history_path_in(root, &chat_id)?;
        match tokio::fs::symlink_metadata(&path).await {
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let now = timestamp_now();
                let thread = ChatThread {
                    chat_id,
                    title: "New chat".to_string(),
                    created_at: now.clone(),
                    updated_at: now,
                    messages: Vec::new(),
                };
                write_thread_path(&path, &thread).await?;
                return Ok(thread);
            }
            Err(_) => return Err(ChatHistoryError::Storage),
        }
    }
    Err(ChatHistoryError::Storage)
}

pub async fn get_thread(config_dir: &Path, chat_id: &str) -> Result<ChatThread, ChatHistoryError> {
    get_thread_in(&chat_history_root(config_dir), chat_id).await
}

pub async fn get_thread_in(root: &Path, chat_id: &str) -> Result<ChatThread, ChatHistoryError> {
    let path = chat_history_path_in(root, chat_id)?;
    if !ensure_existing_chat_history_root(&path).await? {
        return Err(ChatHistoryError::NotFound);
    }
    reject_chat_history_file_symlink(&path).await?;
    match read_thread_path(&path).await {
        Ok(thread) => Ok(thread),
        Err(ChatHistoryError::Storage) => match tokio::fs::symlink_metadata(&path).await {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Err(ChatHistoryError::NotFound)
            }
            _ => Err(ChatHistoryError::Storage),
        },
        Err(error) => Err(error),
    }
}

pub async fn delete_thread(config_dir: &Path, chat_id: &str) -> Result<(), ChatHistoryError> {
    delete_thread_in(&chat_history_root(config_dir), chat_id).await
}

pub async fn delete_thread_in(root: &Path, chat_id: &str) -> Result<(), ChatHistoryError> {
    let path = chat_history_path_in(root, chat_id)?;
    if !ensure_existing_chat_history_root(&path).await? {
        return Err(ChatHistoryError::NotFound);
    }
    reject_chat_history_file_symlink(&path).await?;
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(ChatHistoryError::NotFound)
        }
        Err(_) => Err(ChatHistoryError::Storage),
    }
}

pub async fn append_message(
    config_dir: &Path,
    chat_id: &str,
    role: ChatMessageRole,
    content: String,
    status: Option<ChatMessageStatus>,
) -> Result<ChatMessage, ChatHistoryError> {
    append_message_in(
        &chat_history_root(config_dir),
        chat_id,
        role,
        content,
        status,
    )
    .await
}

pub async fn append_message_in(
    root: &Path,
    chat_id: &str,
    role: ChatMessageRole,
    content: String,
    status: Option<ChatMessageStatus>,
) -> Result<ChatMessage, ChatHistoryError> {
    let message = new_message(chat_id, role, content, status)?;
    append_existing_message_in(root, message).await
}

pub fn new_message(
    chat_id: &str,
    role: ChatMessageRole,
    content: String,
    status: Option<ChatMessageStatus>,
) -> Result<ChatMessage, ChatHistoryError> {
    validate_chat_id(chat_id)?;
    let now = timestamp_now();
    Ok(ChatMessage {
        id: new_message_id()?,
        chat_id: chat_id.to_string(),
        role,
        content,
        created_at: now,
        status,
    })
}

pub async fn append_existing_message_in(
    root: &Path,
    message: ChatMessage,
) -> Result<ChatMessage, ChatHistoryError> {
    validate_message(&message.chat_id, &message)?;
    let chat_id = &message.chat_id;
    let path = chat_history_path_in(root, chat_id)?;
    let now = timestamp_now();
    let mut thread = match get_thread_in(root, chat_id).await {
        Ok(thread) => thread,
        Err(ChatHistoryError::NotFound) => ChatThread {
            chat_id: chat_id.to_string(),
            title: "New chat".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
            messages: Vec::new(),
        },
        Err(error) => return Err(error),
    };
    if let Some(existing) = thread.messages.iter().find(|item| item.id == message.id) {
        return if existing == &message {
            Ok(existing.clone())
        } else {
            Err(ChatHistoryError::InvalidRecord)
        };
    }
    #[cfg(test)]
    if consume_append_failure(root) {
        return Err(ChatHistoryError::Storage);
    }
    thread.updated_at = now;
    thread.messages.push(message.clone());
    write_thread_path(&path, &thread).await?;
    Ok(message)
}

pub async fn replace_existing_message_in(
    root: &Path,
    message: ChatMessage,
) -> Result<ChatMessage, ChatHistoryError> {
    validate_message(&message.chat_id, &message)?;
    let path = chat_history_path_in(root, &message.chat_id)?;
    let mut thread = get_thread_in(root, &message.chat_id).await?;
    let stored = thread
        .messages
        .iter_mut()
        .find(|stored| stored.id == message.id)
        .ok_or(ChatHistoryError::InvalidRecord)?;
    if stored.chat_id != message.chat_id || stored.role != message.role {
        return Err(ChatHistoryError::InvalidRecord);
    }
    *stored = message.clone();
    thread.updated_at = timestamp_now();
    write_thread_path(&path, &thread).await?;
    Ok(message)
}

pub async fn interrupt_streaming_messages_in(
    root: &Path,
    chat_id: &str,
) -> Result<Option<ChatThread>, ChatHistoryError> {
    let path = chat_history_path_in(root, chat_id)?;
    let mut thread = match get_thread_in(root, chat_id).await {
        Ok(thread) => thread,
        Err(ChatHistoryError::NotFound) => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut changed = false;
    let mut remove = Vec::new();
    for (index, message) in thread.messages.iter_mut().enumerate() {
        if message.role == ChatMessageRole::Assistant
            && message.status == Some(ChatMessageStatus::Streaming)
        {
            if message.content.is_empty() {
                remove.push(index);
            } else {
                message.status = Some(ChatMessageStatus::Interrupted);
            }
            changed = true;
        }
    }
    for index in remove.into_iter().rev() {
        thread.messages.remove(index);
    }
    if changed {
        thread.updated_at = timestamp_now();
        write_thread_path(&path, &thread).await?;
    }
    Ok(Some(thread))
}

#[cfg(test)]
fn append_failures() -> &'static std::sync::Mutex<std::collections::HashMap<PathBuf, usize>> {
    static FAILURES: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<PathBuf, usize>>,
    > = std::sync::OnceLock::new();
    FAILURES.get_or_init(Default::default)
}

#[cfg(test)]
fn consume_append_failure(root: &Path) -> bool {
    let mut failures = append_failures().lock().unwrap();
    let Some(remaining) = failures.get_mut(root) else {
        return false;
    };
    *remaining -= 1;
    if *remaining == 0 {
        failures.remove(root);
    }
    true
}

#[cfg(test)]
pub fn inject_next_append_failure(root: &Path) {
    inject_append_failures(root, 1);
}

#[cfg(test)]
pub fn inject_append_failures(root: &Path, count: usize) {
    append_failures()
        .lock()
        .unwrap()
        .insert(root.to_path_buf(), count);
}

pub async fn remove_message_in(
    root: &Path,
    chat_id: &str,
    message_id: &str,
) -> Result<(), ChatHistoryError> {
    validate_chat_id(message_id)?;
    let path = chat_history_path_in(root, chat_id)?;
    let mut thread = get_thread_in(root, chat_id).await?;
    let Some(index) = thread
        .messages
        .iter()
        .position(|message| message.id == message_id)
    else {
        return Err(ChatHistoryError::InvalidRecord);
    };
    thread.messages.remove(index);
    thread.updated_at = timestamp_now();
    write_thread_path(&path, &thread).await
}

pub fn chat_history_path(config_dir: &Path, chat_id: &str) -> Result<PathBuf, ChatHistoryError> {
    chat_history_path_in(&chat_history_root(config_dir), chat_id)
}

pub fn chat_history_path_in(root: &Path, chat_id: &str) -> Result<PathBuf, ChatHistoryError> {
    validate_chat_id(chat_id)?;
    let path = root.join(format!("{chat_id}.json"));
    if path.parent() != Some(root) || path.file_name().is_none() {
        return Err(ChatHistoryError::Storage);
    }
    Ok(path)
}

pub fn validate_chat_id(chat_id: &str) -> Result<(), ChatHistoryError> {
    if chat_id.is_empty() || chat_id.len() > 128 {
        return Err(ChatHistoryError::InvalidChatId);
    }
    let Some(first) = chat_id.as_bytes().first() else {
        return Err(ChatHistoryError::InvalidChatId);
    };
    if !first.is_ascii_alphanumeric() {
        return Err(ChatHistoryError::InvalidChatId);
    }
    if chat_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        Ok(())
    } else {
        Err(ChatHistoryError::InvalidChatId)
    }
}

fn chat_history_root(config_dir: &Path) -> PathBuf {
    config_dir.join(CHAT_HISTORY_DIR)
}

async fn read_thread_path(path: &Path) -> Result<ChatThread, ChatHistoryError> {
    reject_chat_history_file_symlink(path).await?;
    let Some(bytes) = read_chat_history_file(path).await? else {
        return Err(ChatHistoryError::Storage);
    };
    let thread: ChatThread =
        serde_json::from_slice(&bytes).map_err(|_| ChatHistoryError::Storage)?;
    validate_thread(&thread)?;
    Ok(thread)
}

async fn write_thread_path(path: &Path, thread: &ChatThread) -> Result<(), ChatHistoryError> {
    validate_thread(thread)?;
    ensure_chat_history_directory(path).await?;
    reject_chat_history_file_symlink(path).await?;
    let bytes = serde_json::to_vec_pretty(thread).map_err(|_| ChatHistoryError::Storage)?;
    atomic_write_chat_history(path, &bytes).await
}

fn validate_thread(thread: &ChatThread) -> Result<(), ChatHistoryError> {
    validate_chat_id(&thread.chat_id).map_err(|_| ChatHistoryError::InvalidRecord)?;
    validate_title(&thread.title)?;
    validate_timestamp(&thread.created_at)?;
    validate_timestamp(&thread.updated_at)?;
    if thread.messages.len() > CHAT_HISTORY_MAX_MESSAGES {
        return Err(ChatHistoryError::InvalidRecord);
    }
    for message in &thread.messages {
        validate_message(&thread.chat_id, message)?;
    }
    Ok(())
}

fn validate_message(chat_id: &str, message: &ChatMessage) -> Result<(), ChatHistoryError> {
    validate_chat_id(&message.id).map_err(|_| ChatHistoryError::InvalidRecord)?;
    if message.chat_id != chat_id {
        return Err(ChatHistoryError::InvalidRecord);
    }
    validate_chat_id(&message.chat_id).map_err(|_| ChatHistoryError::InvalidRecord)?;
    validate_timestamp(&message.created_at)?;
    if message.content.chars().count() > CHAT_HISTORY_CONTENT_MAX_CHARS {
        return Err(ChatHistoryError::InvalidRecord);
    }
    Ok(())
}

fn validate_title(title: &str) -> Result<(), ChatHistoryError> {
    if title.is_empty() || title.chars().count() > CHAT_HISTORY_TITLE_MAX_CHARS {
        Err(ChatHistoryError::InvalidRecord)
    } else {
        Ok(())
    }
}

fn validate_timestamp(value: &str) -> Result<(), ChatHistoryError> {
    if value.len() < 20 || value.len() > 32 || !value.ends_with('Z') {
        return Err(ChatHistoryError::InvalidRecord);
    }
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| ChatHistoryError::InvalidRecord)
}

fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn new_chat_id() -> Result<String, ChatHistoryError> {
    let mut bytes = vec![0u8; CHAT_HISTORY_ID_RANDOM_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|_| ChatHistoryError::Storage)?;
    Ok(format!(
        "chat_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    ))
}

fn new_message_id() -> Result<String, ChatHistoryError> {
    let mut bytes = vec![0u8; CHAT_HISTORY_ID_RANDOM_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|_| ChatHistoryError::Storage)?;
    Ok(format!(
        "msg_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    ))
}

async fn ensure_chat_history_directory(path: &Path) -> Result<(), ChatHistoryError> {
    let root = path.parent().ok_or(ChatHistoryError::Storage)?;
    crate::storage::ensure_store_namespace(root, true)
        .await
        .map_err(|_| ChatHistoryError::Storage)
        .map(|_| ())
}

async fn ensure_existing_chat_history_root(path: &Path) -> Result<bool, ChatHistoryError> {
    let root = path.parent().ok_or(ChatHistoryError::Storage)?;
    crate::storage::ensure_store_namespace(root, false)
        .await
        .map_err(|_| ChatHistoryError::Storage)
}

async fn reject_chat_history_file_symlink(path: &Path) -> Result<(), ChatHistoryError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(ChatHistoryError::Storage),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ChatHistoryError::Storage),
    }
}

async fn atomic_write_chat_history(path: &Path, bytes: &[u8]) -> Result<(), ChatHistoryError> {
    ensure_chat_history_directory(path).await?;
    reject_chat_history_file_symlink(path).await?;
    crate::storage::atomic_write_private_file(
        path,
        bytes,
        crate::storage::AtomicPrivateWriteOptions {
            max_bytes: CHAT_HISTORY_FILE_MAX_BYTES as usize,
            mode: crate::storage::AtomicPrivateWriteMode::Replace,
            parent_sync: crate::storage::AtomicPrivateParentSync::BestEffortUnsupported,
        },
    )
    .await
    .map(|_| ())
    .map_err(|_| ChatHistoryError::Storage)
}

#[cfg(unix)]
async fn read_chat_history_file(path: &Path) -> Result<Option<Vec<u8>>, ChatHistoryError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::io::Read;

        let mut file = match open_file_no_follow(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ChatHistoryError::Storage),
        };
        let metadata = file.metadata().map_err(|_| ChatHistoryError::Storage)?;
        if metadata.len() > CHAT_HISTORY_FILE_MAX_BYTES {
            return Err(ChatHistoryError::Storage);
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|_| ChatHistoryError::Storage)?;
        Ok(Some(bytes))
    })
    .await
    .map_err(|_| ChatHistoryError::Storage)?
}

#[cfg(not(unix))]
async fn read_chat_history_file(path: &Path) -> Result<Option<Vec<u8>>, ChatHistoryError> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ChatHistoryError::Storage),
    };
    if metadata.len() > CHAT_HISTORY_FILE_MAX_BYTES {
        return Err(ChatHistoryError::Storage);
    }
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ChatHistoryError::Storage),
    }
}

#[cfg(unix)]
fn open_file_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(test)]
mod tests {
    use super::{ChatHistoryError, ChatThread};

    static TEST_DIR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-chat-history-test-{}-{}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[cfg(unix)]
    fn file_mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::symlink_metadata(path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777
    }

    #[test]
    fn chat_history_id_validation_rejects_unsafe_paths() {
        assert!(super::validate_chat_id("chat_001").is_ok());
        for id in [
            "", ".", "..", "../bad", "bad/id", "~bad", "bad\\id", "bad:id", "bad%2Fid", "-bad",
        ] {
            assert!(super::validate_chat_id(id).is_err(), "{id}");
        }
    }

    #[tokio::test]
    async fn chat_history_store_create_list_get_delete_roundtrip() {
        let dir = temp_dir();
        let created = super::create_thread(&dir).await.unwrap();
        assert!(created.chat_id.starts_with("chat_"));
        assert_eq!(created.title, "New chat");
        assert!(created.messages.is_empty());

        let list = super::list_threads(&dir).await.unwrap();
        assert_eq!(list.chats.len(), 1);
        assert_eq!(list.chats[0].chat_id, created.chat_id);
        assert_eq!(list.chats[0].message_count, 0);

        let loaded = super::get_thread(&dir, &created.chat_id).await.unwrap();
        assert_eq!(loaded.chat_id, created.chat_id);

        super::delete_thread(&dir, &created.chat_id).await.unwrap();
        assert!(matches!(
            super::get_thread(&dir, &created.chat_id).await,
            Err(ChatHistoryError::NotFound)
        ));
    }

    #[tokio::test]
    async fn chat_history_project_namespaces_allow_same_id_without_blending() {
        let dir = temp_dir();
        let first = dir.join("projects/first/chat-history");
        let second = dir.join("projects/second/chat-history");
        super::append_message_in(
            &first,
            "chat_same",
            super::ChatMessageRole::User,
            "first".to_string(),
            Some(super::ChatMessageStatus::Complete),
        )
        .await
        .unwrap();
        super::append_message_in(
            &second,
            "chat_same",
            super::ChatMessageRole::User,
            "second".to_string(),
            Some(super::ChatMessageStatus::Complete),
        )
        .await
        .unwrap();

        assert_eq!(
            super::get_thread_in(&first, "chat_same")
                .await
                .unwrap()
                .messages[0]
                .content,
            "first"
        );
        assert_eq!(
            super::get_thread_in(&second, "chat_same")
                .await
                .unwrap()
                .messages[0]
                .content,
            "second"
        );
        super::delete_thread_in(&first, "chat_same").await.unwrap();
        assert!(matches!(
            super::get_thread_in(&first, "chat_same").await,
            Err(ChatHistoryError::NotFound)
        ));
        assert!(super::get_thread_in(&second, "chat_same").await.is_ok());
        assert!(!dir.join("chat-history").exists());
    }

    #[tokio::test]
    async fn chat_history_remove_message_rolls_back_exact_message() {
        let dir = temp_dir();
        let root = dir.join("projects/first/chat-history");
        let first = super::append_message_in(
            &root,
            "chat_rollback",
            super::ChatMessageRole::User,
            "first".into(),
            Some(super::ChatMessageStatus::Complete),
        )
        .await
        .unwrap();
        super::append_message_in(
            &root,
            "chat_rollback",
            super::ChatMessageRole::User,
            "second".into(),
            Some(super::ChatMessageStatus::Complete),
        )
        .await
        .unwrap();

        super::remove_message_in(&root, "chat_rollback", &first.id)
            .await
            .unwrap();
        let thread = super::get_thread_in(&root, "chat_rollback").await.unwrap();
        assert_eq!(thread.messages.len(), 1);
        assert_eq!(thread.messages[0].content, "second");
    }

    #[tokio::test]
    async fn chat_history_append_existing_message_is_idempotent() {
        let dir = temp_dir();
        let root = dir.join("projects/first/chat-history");
        let message = super::new_message(
            "chat_retry",
            super::ChatMessageRole::Error,
            "repair".into(),
            Some(super::ChatMessageStatus::Error),
        )
        .unwrap();

        super::append_existing_message_in(&root, message.clone())
            .await
            .unwrap();
        super::append_existing_message_in(&root, message)
            .await
            .unwrap();
        assert_eq!(
            super::get_thread_in(&root, "chat_retry")
                .await
                .unwrap()
                .messages
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn chat_partial_streaming_message_updates_and_interrupts_on_restart() {
        let dir = temp_dir();
        let root = dir.join("projects/first/chat-history");
        let mut message = super::new_message(
            "chat_partial",
            super::ChatMessageRole::Assistant,
            String::new(),
            Some(super::ChatMessageStatus::Streaming),
        )
        .unwrap();
        super::append_existing_message_in(&root, message.clone())
            .await
            .unwrap();
        message.content = "bounded partial".into();
        super::replace_existing_message_in(&root, message.clone())
            .await
            .unwrap();

        let thread = super::interrupt_streaming_messages_in(&root, "chat_partial")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(thread.messages.len(), 1);
        assert_eq!(thread.messages[0].id, message.id);
        assert_eq!(thread.messages[0].content, "bounded partial");
        assert_eq!(
            thread.messages[0].status,
            Some(super::ChatMessageStatus::Interrupted)
        );
    }

    #[tokio::test]
    async fn chat_partial_empty_stream_is_removed_on_restart() {
        let dir = temp_dir();
        let root = dir.join("projects/first/chat-history");
        let message = super::new_message(
            "chat_partial_empty",
            super::ChatMessageRole::Assistant,
            String::new(),
            Some(super::ChatMessageStatus::Streaming),
        )
        .unwrap();
        super::append_existing_message_in(&root, message)
            .await
            .unwrap();

        let thread = super::interrupt_streaming_messages_in(&root, "chat_partial_empty")
            .await
            .unwrap()
            .unwrap();
        assert!(thread.messages.is_empty());
    }

    #[tokio::test]
    async fn chat_history_store_missing_and_corrupt_are_safe() {
        let dir = temp_dir();
        assert!(matches!(
            super::get_thread(&dir, "chat_missing").await,
            Err(ChatHistoryError::NotFound | ChatHistoryError::Storage)
        ));
        let path = super::chat_history_path(&dir, "chat_corrupt").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"chatId":"chat_corrupt","messages":["#).unwrap();
        assert!(matches!(
            super::get_thread(&dir, "chat_corrupt").await,
            Err(ChatHistoryError::Storage)
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn chat_history_store_writes_private_directory_and_file_modes() {
        let dir = temp_dir();
        let created = super::create_thread(&dir).await.unwrap();
        let root = dir.join("chat-history");
        let path = super::chat_history_path(&dir, &created.chat_id).unwrap();
        assert_eq!(file_mode(&root), 0o700);
        assert_eq!(file_mode(&path), 0o600);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn chat_history_store_rejects_root_symlink_escape() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("chat-history")).unwrap();

        assert!(matches!(
            super::create_thread(&dir).await,
            Err(ChatHistoryError::Storage)
        ));
        assert!(std::fs::read_dir(outside).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn chat_history_rejects_project_and_subsystem_symlink_escapes() {
        for boundary in ["project", "subsystem"] {
            let temp = tempfile::tempdir().unwrap();
            let outside = tempfile::tempdir().unwrap();
            let sentinel = outside.path().join("sentinel");
            std::fs::write(&sentinel, "unchanged").unwrap();
            let project = temp.path().join("config/projects/project-a");
            let root = project.join("chat-history");
            std::fs::create_dir_all(project.parent().unwrap()).unwrap();
            if boundary == "project" {
                std::os::unix::fs::symlink(outside.path(), &project).unwrap();
            } else {
                std::fs::create_dir(&project).unwrap();
                std::os::unix::fs::symlink(outside.path(), &root).unwrap();
            }

            assert!(matches!(
                super::create_thread_in(&root).await,
                Err(ChatHistoryError::Storage)
            ));
            assert_eq!(std::fs::read_to_string(&sentinel).unwrap(), "unchanged");
            assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 1);
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn chat_history_store_rejects_final_file_symlink_and_cleans_temp() {
        let dir = temp_dir();
        let outside = temp_dir();
        let path = super::chat_history_path(&dir, "chat_link").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("outside.json");
        std::fs::write(&target, "{}").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        let thread = ChatThread {
            chat_id: "chat_link".to_string(),
            title: "New chat".to_string(),
            created_at: "2026-05-29T00:00:00Z".to_string(),
            updated_at: "2026-05-29T00:00:00Z".to_string(),
            messages: Vec::new(),
        };

        assert!(matches!(
            super::write_thread_path(&path, &thread).await,
            Err(ChatHistoryError::Storage)
        ));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "{}");
        let temp_files: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(temp_files.is_empty());
    }
}

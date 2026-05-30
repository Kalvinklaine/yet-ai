use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine;
use chrono::{SecondsFormat, Utc};
use http::StatusCode;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

static TEMP_CHAT_HISTORY_COUNTER: AtomicU64 = AtomicU64::new(0);

const CHAT_HISTORY_DIR: &str = "chat-history";
const CHAT_HISTORY_FILE_MAX_BYTES: u64 = 2_000_000;
const CHAT_HISTORY_MAX_THREADS: usize = 1000;
const CHAT_HISTORY_MAX_MESSAGES: usize = 1000;
const CHAT_HISTORY_TITLE_MAX_CHARS: usize = 160;
const CHAT_HISTORY_CONTENT_MAX_CHARS: usize = 20_000;
const CHAT_HISTORY_ID_RANDOM_BYTES: usize = 18;

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    let root = chat_history_root(config_dir);
    if !ensure_chat_history_root(&root, false).await? {
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
    for _ in 0..8 {
        let chat_id = new_chat_id()?;
        let path = chat_history_path(config_dir, &chat_id)?;
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
    let path = chat_history_path(config_dir, chat_id)?;
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
    let path = chat_history_path(config_dir, chat_id)?;
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
    validate_chat_id(chat_id)?;
    let path = chat_history_path(config_dir, chat_id)?;
    let now = timestamp_now();
    let mut thread = match get_thread(config_dir, chat_id).await {
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
    let message = ChatMessage {
        id: new_message_id()?,
        chat_id: chat_id.to_string(),
        role,
        content,
        created_at: now.clone(),
        status,
    };
    thread.updated_at = now;
    thread.messages.push(message.clone());
    write_thread_path(&path, &thread).await?;
    Ok(message)
}

pub fn chat_history_path(config_dir: &Path, chat_id: &str) -> Result<PathBuf, ChatHistoryError> {
    validate_chat_id(chat_id)?;
    let root = chat_history_root(config_dir);
    let path = root.join(format!("{chat_id}.json"));
    if path.parent() != Some(root.as_path()) || path.file_name().is_none() {
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
    let parent = root.parent().ok_or(ChatHistoryError::Storage)?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| ChatHistoryError::Storage)?;
    ensure_chat_history_root(root, true).await.map(|_| ())
}

async fn ensure_existing_chat_history_root(path: &Path) -> Result<bool, ChatHistoryError> {
    let root = path.parent().ok_or(ChatHistoryError::Storage)?;
    ensure_chat_history_root(root, false).await
}

async fn ensure_chat_history_root(root: &Path, create: bool) -> Result<bool, ChatHistoryError> {
    match tokio::fs::symlink_metadata(root).await {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(ChatHistoryError::Storage);
            }
            set_private_directory_permissions(root).await?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            tokio::fs::create_dir(root)
                .await
                .map_err(|_| ChatHistoryError::Storage)?;
            set_private_directory_permissions(root).await?;
            Ok(true)
        }
        Err(_) => Err(ChatHistoryError::Storage),
    }
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
    let temp_path = temp_chat_history_path(path);
    let mut options = tokio::fs::OpenOptions::new();
    options.create_new(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        tokio::fs::OpenOptions::mode(&mut options, 0o600);
    }
    let result = async {
        let mut file = options
            .open(&temp_path)
            .await
            .map_err(|_| ChatHistoryError::Storage)?;
        file.write_all(bytes)
            .await
            .map_err(|_| ChatHistoryError::Storage)?;
        file.sync_all()
            .await
            .map_err(|_| ChatHistoryError::Storage)?;
        set_private_permissions_for_open_file(file).await?;
        reject_chat_history_file_symlink(path).await?;
        tokio::fs::rename(&temp_path, path)
            .await
            .map_err(|_| ChatHistoryError::Storage)?;
        set_private_permissions(path).await?;
        sync_parent_directory(path).await
    }
    .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            cleanup_chat_history_temp_file(&temp_path).await?;
            Err(error)
        }
    }
}

fn temp_chat_history_path(path: &Path) -> PathBuf {
    let counter = TEMP_CHAT_HISTORY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("thread.json");
    path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        counter
    ))
}

async fn cleanup_chat_history_temp_file(path: &Path) -> Result<(), ChatHistoryError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ChatHistoryError::Storage),
    }
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

#[cfg(unix)]
fn open_directory_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(unix)]
async fn set_private_permissions_for_open_file(
    file: tokio::fs::File,
) -> Result<(), ChatHistoryError> {
    use std::os::unix::fs::PermissionsExt;

    let file = file.into_std().await;
    tokio::task::spawn_blocking(move || {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ChatHistoryError::Storage)
    })
    .await
    .map_err(|_| ChatHistoryError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions_for_open_file(
    file: tokio::fs::File,
) -> Result<(), ChatHistoryError> {
    drop(file);
    Ok(())
}

#[cfg(unix)]
async fn set_private_permissions(path: &Path) -> Result<(), ChatHistoryError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = open_file_no_follow(&path).map_err(|_| ChatHistoryError::Storage)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ChatHistoryError::Storage)
    })
    .await
    .map_err(|_| ChatHistoryError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions(_path: &Path) -> Result<(), ChatHistoryError> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_directory_permissions(path: &Path) -> Result<(), ChatHistoryError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let directory = open_directory_no_follow(&path).map_err(|_| ChatHistoryError::Storage)?;
        directory
            .set_permissions(std::fs::Permissions::from_mode(0o700))
            .map_err(|_| ChatHistoryError::Storage)
    })
    .await
    .map_err(|_| ChatHistoryError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_directory_permissions(_path: &Path) -> Result<(), ChatHistoryError> {
    Ok(())
}

#[cfg(unix)]
async fn sync_parent_directory(path: &Path) -> Result<(), ChatHistoryError> {
    let dir = path
        .parent()
        .ok_or(ChatHistoryError::Storage)?
        .to_path_buf();
    tokio::task::spawn_blocking(move || {
        match open_directory_no_follow(&dir).and_then(|directory| directory.sync_all()) {
            Ok(()) => Ok(()),
            Err(error) if is_unsupported_directory_sync_error(&error) => Ok(()),
            Err(_) => Err(ChatHistoryError::Storage),
        }
    })
    .await
    .map_err(|_| ChatHistoryError::Storage)?
}

#[cfg(unix)]
fn is_unsupported_directory_sync_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::PermissionDenied
            | std::io::ErrorKind::Unsupported
            | std::io::ErrorKind::InvalidInput
    ) || error.raw_os_error() == Some(22)
}

#[cfg(not(unix))]
async fn sync_parent_directory(_path: &Path) -> Result<(), ChatHistoryError> {
    Ok(())
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

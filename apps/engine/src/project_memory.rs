use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncWriteExt;

const PROTOCOL_VERSION: &str = "2026-06-17";
const STORE_FILE_MAX_BYTES: u64 = 1024 * 1024;
const TITLE_MAX_CHARS: usize = 120;
const TEXT_MAX_CHARS: usize = 8000;
const TAG_MAX_CHARS: usize = 32;
const QUERY_MAX_CHARS: usize = 160;
const NOTE_ID_RANDOM_BYTES: usize = 18;
const MAX_NOTES: usize = 100;
const MAX_TAGS: usize = 10;
const DEFAULT_SEARCH_LIMIT: usize = 20;
const MAX_SEARCH_LIMIT: usize = 20;

static TEMP_PROJECT_MEMORY_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMemoryNote {
    pub id: String,
    pub title: String,
    pub text: String,
    pub tags: Vec<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMemoryCreateRequest {
    pub protocol_version: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMemoryUpdateRequest {
    pub protocol_version: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMemorySearchRequest {
    pub protocol_version: String,
    pub query: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMemoryDeleteRequest {
    pub protocol_version: String,
    pub note_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryListResponse {
    pub protocol_version: String,
    pub cloud_required: bool,
    pub provider_access: String,
    pub notes: Vec<ProjectMemoryNote>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemorySearchResponse {
    pub protocol_version: String,
    pub cloud_required: bool,
    pub provider_access: String,
    pub query_label: String,
    pub matches: Vec<ProjectMemoryMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryMatch {
    pub note: ProjectMemoryNote,
    pub score_label: String,
}

#[derive(Debug, Error)]
pub enum ProjectMemoryError {
    #[error("invalid project memory request")]
    InvalidRequest,
    #[error("project memory note not found")]
    NotFound,
    #[error("project memory limit reached")]
    LimitReached,
    #[error("project memory storage error")]
    Storage,
}

impl ProjectMemoryError {
    pub fn status(&self) -> http::StatusCode {
        match self {
            ProjectMemoryError::InvalidRequest => http::StatusCode::BAD_REQUEST,
            ProjectMemoryError::NotFound => http::StatusCode::NOT_FOUND,
            ProjectMemoryError::LimitReached => http::StatusCode::CONFLICT,
            ProjectMemoryError::Storage => http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectMemoryStore {
    protocol_version: String,
    notes: Vec<ProjectMemoryNote>,
}

pub async fn list(config_dir: &Path) -> Result<ProjectMemoryListResponse, ProjectMemoryError> {
    let mut notes = load_notes(config_dir).await?;
    sort_notes(&mut notes);
    Ok(list_response(notes))
}

pub async fn get(
    config_dir: &Path,
    note_id: &str,
) -> Result<ProjectMemoryNote, ProjectMemoryError> {
    validate_note_id(note_id)?;
    load_notes(config_dir)
        .await?
        .into_iter()
        .find(|note| note.id == note_id)
        .ok_or(ProjectMemoryError::NotFound)
}

pub async fn create(
    config_dir: &Path,
    request: ProjectMemoryCreateRequest,
) -> Result<ProjectMemoryNote, ProjectMemoryError> {
    validate_create_request(&request)?;
    let mut notes = load_notes(config_dir).await?;
    if notes.len() >= MAX_NOTES {
        return Err(ProjectMemoryError::LimitReached);
    }
    let now = now_timestamp();
    let note = ProjectMemoryNote {
        id: new_note_id()?,
        title: request.title,
        text: request.text,
        tags: normalize_tags(request.tags)?,
        source: "manual".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };
    notes.push(note.clone());
    store_notes(config_dir, &notes).await?;
    Ok(note)
}

pub async fn update(
    config_dir: &Path,
    note_id: &str,
    request: ProjectMemoryUpdateRequest,
) -> Result<ProjectMemoryNote, ProjectMemoryError> {
    validate_note_id(note_id)?;
    validate_update_request(&request)?;
    let mut notes = load_notes(config_dir).await?;
    let Some(note) = notes.iter_mut().find(|note| note.id == note_id) else {
        return Err(ProjectMemoryError::NotFound);
    };
    note.title = request.title;
    note.text = request.text;
    note.tags = normalize_tags(request.tags)?;
    note.updated_at = now_timestamp();
    let updated = note.clone();
    store_notes(config_dir, &notes).await?;
    Ok(updated)
}

pub async fn delete(config_dir: &Path, note_id: &str) -> Result<(), ProjectMemoryError> {
    validate_note_id(note_id)?;
    let mut notes = load_notes(config_dir).await?;
    let before = notes.len();
    notes.retain(|note| note.id != note_id);
    if notes.len() == before {
        return Err(ProjectMemoryError::NotFound);
    }
    store_notes(config_dir, &notes).await
}

pub async fn delete_with_request(
    config_dir: &Path,
    request: ProjectMemoryDeleteRequest,
) -> Result<(), ProjectMemoryError> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err(ProjectMemoryError::InvalidRequest);
    }
    delete(config_dir, &request.note_id).await
}

pub async fn search(
    config_dir: &Path,
    request: ProjectMemorySearchRequest,
) -> Result<ProjectMemorySearchResponse, ProjectMemoryError> {
    if request.protocol_version != PROTOCOL_VERSION
        || !valid_text(&request.query, QUERY_MAX_CHARS)
        || request.query.trim() != request.query
    {
        return Err(ProjectMemoryError::InvalidRequest);
    }
    let tags = normalize_tags(request.tags)?;
    let limit = request.limit.unwrap_or(DEFAULT_SEARCH_LIMIT);
    if !(1..=MAX_SEARCH_LIMIT).contains(&limit) {
        return Err(ProjectMemoryError::InvalidRequest);
    }
    let query = request.query.to_lowercase();
    let mut matches = Vec::new();
    let mut notes = load_notes(config_dir).await?;
    sort_notes(&mut notes);
    for note in notes {
        if !tags.iter().all(|tag| note.tags.contains(tag)) {
            continue;
        }
        let label = if note.title.to_lowercase().contains(&query) {
            Some("title")
        } else if note
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(&query))
        {
            Some("tag")
        } else if note.text.to_lowercase().contains(&query) {
            Some("text")
        } else {
            None
        };
        if let Some(label) = label {
            matches.push(ProjectMemoryMatch {
                note,
                score_label: label.to_string(),
            });
        }
        if matches.len() >= limit {
            break;
        }
    }
    Ok(ProjectMemorySearchResponse {
        protocol_version: PROTOCOL_VERSION.to_string(),
        cloud_required: false,
        provider_access: "direct".to_string(),
        query_label: request.query,
        matches,
    })
}

fn list_response(notes: Vec<ProjectMemoryNote>) -> ProjectMemoryListResponse {
    ProjectMemoryListResponse {
        protocol_version: PROTOCOL_VERSION.to_string(),
        cloud_required: false,
        provider_access: "direct".to_string(),
        notes,
    }
}

fn validate_create_request(request: &ProjectMemoryCreateRequest) -> Result<(), ProjectMemoryError> {
    if request.protocol_version != PROTOCOL_VERSION
        || request.source != "manual"
        || !valid_text(&request.title, TITLE_MAX_CHARS)
        || !valid_text(&request.text, TEXT_MAX_CHARS)
    {
        return Err(ProjectMemoryError::InvalidRequest);
    }
    normalize_tags(request.tags.clone()).map(|_| ())
}

fn validate_update_request(request: &ProjectMemoryUpdateRequest) -> Result<(), ProjectMemoryError> {
    if request.protocol_version != PROTOCOL_VERSION
        || request.source != "manual"
        || !valid_text(&request.title, TITLE_MAX_CHARS)
        || !valid_text(&request.text, TEXT_MAX_CHARS)
    {
        return Err(ProjectMemoryError::InvalidRequest);
    }
    normalize_tags(request.tags.clone()).map(|_| ())
}

fn normalize_tags(tags: Vec<String>) -> Result<Vec<String>, ProjectMemoryError> {
    if tags.len() > MAX_TAGS {
        return Err(ProjectMemoryError::InvalidRequest);
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(tags.len());
    for tag in tags {
        if !valid_tag(&tag) || !seen.insert(tag.clone()) {
            return Err(ProjectMemoryError::InvalidRequest);
        }
        normalized.push(tag);
    }
    Ok(normalized)
}

fn validate_note_id(value: &str) -> Result<(), ProjectMemoryError> {
    if value.is_empty()
        || value.chars().count() > 128
        || !value
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
        || contains_unsafe_text(value)
    {
        return Err(ProjectMemoryError::InvalidRequest);
    }
    Ok(())
}

fn valid_tag(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= TAG_MAX_CHARS
        && value
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
        && value
            .chars()
            .next()
            .is_some_and(|value| value.is_ascii_alphanumeric())
        && !contains_unsafe_text(value)
}

fn valid_text(value: &str, max_chars: usize) -> bool {
    !value.is_empty()
        && value.chars().count() <= max_chars
        && value.trim() == value
        && !value
            .chars()
            .any(|value| is_c0_c1_control(value) && !matches!(value, '\n' | '\r' | '\t'))
        && !contains_unsafe_text(value)
}

fn contains_unsafe_text(value: &str) -> bool {
    let lower = value.to_lowercase();
    let compact = lower.replace(['_', '-', ' '], "");
    [
        "apikey",
        "authorization",
        "bearer",
        "token",
        "secret",
        "password",
        "cookie",
        "pkce",
        "refresh",
        "accesstoken",
        "authcode",
        "rawprompt",
        "rawcommand",
        "rawdump",
        "rawoutput",
        "rawfile",
        "rawworkspace",
        "providerresponse",
        "providerbody",
        "credential",
        "filebody",
        "filecontent",
        "workspacefile",
        "workspacecontent",
        "embedding",
        "embeddings",
        "index",
        "indexing",
        "workspacescan",
        "assistanttriggered",
    ]
    .iter()
    .any(|marker| compact.contains(marker))
        || lower.contains("sk-")
        || lower.contains("/users/")
        || lower == "/users"
        || lower.contains("/home/")
        || lower == "/home"
        || lower.contains("/tmp/")
        || lower == "/tmp"
        || lower.contains("/etc/")
        || lower == "/etc"
        || lower.contains("/opt/")
        || lower == "/opt"
        || lower.contains("/mnt/")
        || lower == "/mnt"
        || lower.contains("/var/")
        || lower == "/var"
        || lower.contains("/volumes/")
        || lower == "/volumes"
        || lower.contains("/private/")
        || lower == "/private"
        || lower.contains("~/")
        || lower.contains("auth.json")
        || lower.contains("credentials.json")
        || lower.contains(":/")
        || lower.contains("begin private key")
}

fn is_c0_c1_control(value: char) -> bool {
    matches!(value as u32, 0x00..=0x1f | 0x7f..=0x9f)
}

fn sort_notes(notes: &mut [ProjectMemoryNote]) {
    notes.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then(left.id.cmp(&right.id))
    });
}

fn now_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn new_note_id() -> Result<String, ProjectMemoryError> {
    let mut bytes = vec![0u8; NOTE_ID_RANDOM_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|_| ProjectMemoryError::Storage)?;
    Ok(format!(
        "mem_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    ))
}

async fn load_notes(config_dir: &Path) -> Result<Vec<ProjectMemoryNote>, ProjectMemoryError> {
    let path = project_memory_path(config_dir);
    if !ensure_existing_project_memory_root(&path).await? {
        return Ok(Vec::new());
    }
    reject_project_memory_file_symlink(&path).await?;
    let Some(bytes) = read_project_memory_file(&path).await? else {
        return Ok(Vec::new());
    };
    let store: ProjectMemoryStore =
        serde_json::from_slice(&bytes).map_err(|_| ProjectMemoryError::Storage)?;
    if store.protocol_version != PROTOCOL_VERSION || store.notes.len() > MAX_NOTES {
        return Err(ProjectMemoryError::Storage);
    }
    for note in &store.notes {
        validate_stored_note(note)?;
    }
    Ok(store.notes)
}

fn validate_stored_note(note: &ProjectMemoryNote) -> Result<(), ProjectMemoryError> {
    validate_note_id(&note.id)?;
    if note.source != "manual"
        || !valid_text(&note.title, TITLE_MAX_CHARS)
        || !valid_text(&note.text, TEXT_MAX_CHARS)
        || !valid_timestamp(&note.created_at)
        || !valid_timestamp(&note.updated_at)
    {
        return Err(ProjectMemoryError::Storage);
    }
    normalize_tags(note.tags.clone()).map(|_| ())
}

fn valid_timestamp(value: &str) -> bool {
    value.len() >= 20
        && value.len() <= 32
        && value.ends_with('Z')
        && chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

async fn store_notes(
    config_dir: &Path,
    notes: &[ProjectMemoryNote],
) -> Result<(), ProjectMemoryError> {
    if notes.len() > MAX_NOTES {
        return Err(ProjectMemoryError::LimitReached);
    }
    let path = project_memory_path(config_dir);
    ensure_project_memory_directory(&path).await?;
    reject_project_memory_file_symlink(&path).await?;
    let store = ProjectMemoryStore {
        protocol_version: PROTOCOL_VERSION.to_string(),
        notes: notes.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&store).map_err(|_| ProjectMemoryError::Storage)?;
    atomic_write_project_memory(&path, &bytes).await
}

fn project_memory_path(config_dir: &Path) -> PathBuf {
    config_dir.join("project-memory").join("notes.json")
}

async fn ensure_project_memory_directory(path: &Path) -> Result<(), ProjectMemoryError> {
    let root = path.parent().ok_or(ProjectMemoryError::Storage)?;
    let parent = root.parent().ok_or(ProjectMemoryError::Storage)?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| ProjectMemoryError::Storage)?;
    ensure_project_memory_root(root, true).await.map(|_| ())
}

async fn ensure_existing_project_memory_root(path: &Path) -> Result<bool, ProjectMemoryError> {
    let root = path.parent().ok_or(ProjectMemoryError::Storage)?;
    ensure_project_memory_root(root, false).await
}

async fn ensure_project_memory_root(root: &Path, create: bool) -> Result<bool, ProjectMemoryError> {
    match tokio::fs::symlink_metadata(root).await {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(ProjectMemoryError::Storage);
            }
            set_private_directory_permissions(root).await?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            tokio::fs::create_dir(root)
                .await
                .map_err(|_| ProjectMemoryError::Storage)?;
            set_private_directory_permissions(root).await?;
            Ok(true)
        }
        Err(_) => Err(ProjectMemoryError::Storage),
    }
}

async fn reject_project_memory_file_symlink(path: &Path) -> Result<(), ProjectMemoryError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(ProjectMemoryError::Storage),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ProjectMemoryError::Storage),
    }
}

async fn atomic_write_project_memory(path: &Path, bytes: &[u8]) -> Result<(), ProjectMemoryError> {
    let temp_path = temp_project_memory_path(path);
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
            .map_err(|_| ProjectMemoryError::Storage)?;
        file.write_all(bytes)
            .await
            .map_err(|_| ProjectMemoryError::Storage)?;
        file.sync_all()
            .await
            .map_err(|_| ProjectMemoryError::Storage)?;
        set_private_permissions_for_open_file(file).await?;
        reject_project_memory_file_symlink(path).await?;
        tokio::fs::rename(&temp_path, path)
            .await
            .map_err(|_| ProjectMemoryError::Storage)?;
        set_private_permissions(path).await?;
        sync_parent_directory(path).await
    }
    .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            cleanup_project_memory_temp_file(&temp_path).await?;
            Err(error)
        }
    }
}

fn temp_project_memory_path(path: &Path) -> PathBuf {
    let counter = TEMP_PROJECT_MEMORY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("notes.json");
    path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        counter
    ))
}

async fn cleanup_project_memory_temp_file(path: &Path) -> Result<(), ProjectMemoryError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ProjectMemoryError::Storage),
    }
}

#[cfg(unix)]
async fn read_project_memory_file(path: &Path) -> Result<Option<Vec<u8>>, ProjectMemoryError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::io::Read;

        let mut file = match open_file_no_follow(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ProjectMemoryError::Storage),
        };
        let metadata = file.metadata().map_err(|_| ProjectMemoryError::Storage)?;
        if metadata.len() > STORE_FILE_MAX_BYTES {
            return Err(ProjectMemoryError::Storage);
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|_| ProjectMemoryError::Storage)?;
        Ok(Some(bytes))
    })
    .await
    .map_err(|_| ProjectMemoryError::Storage)?
}

#[cfg(not(unix))]
async fn read_project_memory_file(path: &Path) -> Result<Option<Vec<u8>>, ProjectMemoryError> {
    let metadata = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ProjectMemoryError::Storage),
    };
    if metadata.len() > STORE_FILE_MAX_BYTES {
        return Err(ProjectMemoryError::Storage);
    }
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ProjectMemoryError::Storage),
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
async fn set_private_permissions_for_open_file(
    file: tokio::fs::File,
) -> Result<(), ProjectMemoryError> {
    use std::os::unix::fs::PermissionsExt;

    let file = file.into_std().await;
    tokio::task::spawn_blocking(move || {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ProjectMemoryError::Storage)
    })
    .await
    .map_err(|_| ProjectMemoryError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions_for_open_file(
    _file: tokio::fs::File,
) -> Result<(), ProjectMemoryError> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_permissions(path: &Path) -> Result<(), ProjectMemoryError> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .await
        .map_err(|_| ProjectMemoryError::Storage)
}

#[cfg(not(unix))]
async fn set_private_permissions(_path: &Path) -> Result<(), ProjectMemoryError> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_directory_permissions(path: &Path) -> Result<(), ProjectMemoryError> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .await
        .map_err(|_| ProjectMemoryError::Storage)
}

#[cfg(not(unix))]
async fn set_private_directory_permissions(_path: &Path) -> Result<(), ProjectMemoryError> {
    Ok(())
}

#[cfg(unix)]
async fn sync_parent_directory(path: &Path) -> Result<(), ProjectMemoryError> {
    let dir = path
        .parent()
        .ok_or(ProjectMemoryError::Storage)?
        .to_path_buf();
    tokio::task::spawn_blocking(move || {
        use std::os::unix::fs::OpenOptionsExt;

        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(dir)
            .map_err(|_| ProjectMemoryError::Storage)?;
        file.sync_all().map_err(|_| ProjectMemoryError::Storage)
    })
    .await
    .map_err(|_| ProjectMemoryError::Storage)?
}

#[cfg(not(unix))]
async fn sync_parent_directory(_path: &Path) -> Result<(), ProjectMemoryError> {
    Ok(())
}

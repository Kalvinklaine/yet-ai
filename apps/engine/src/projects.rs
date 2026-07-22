use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use base64::Engine;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::storage::{
    canonical_storage_boundary, validate_storage_chain, ProjectStoragePaths, StoragePaths,
};

const REGISTRY_VERSION: u32 = 3;
const INITIAL_REVISION: &str = "1";
const REGISTRY_MAX_BYTES: u64 = 2_000_000;
const REGISTRY_MAX_PROJECTS: usize = 10_000;
const DISPLAY_NAME_MAX_CHARS: usize = 120;
const PROJECT_ID_RANDOM_BYTES: usize = 16;
static TEMP_REGISTRY_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct ProjectRegistryRuntime {
    registry_path: PathBuf,
    config_dir: PathBuf,
    cache_dir: PathBuf,
    state: Arc<tokio::sync::Mutex<Option<ProjectRegistry>>>,
    #[cfg(test)]
    fail_writes: Arc<std::sync::atomic::AtomicBool>,
}

impl std::fmt::Debug for ProjectRegistryRuntime {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProjectRegistryRuntime")
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project_id: String,
    pub display_name: String,
    pub status: ProjectStatus,
    pub revision: String,
    pub created_at: String,
    pub last_opened_at: Option<String>,
    pub root_available: bool,
    pub cloud_required: bool,
    pub provider_access: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Available,
    Missing,
    Archived,
}

#[derive(Clone, PartialEq, Eq)]
pub struct PrivateProjectEntry {
    pub project_id: String,
    pub display_name: String,
    pub revision: String,
    pub created_at: String,
    pub last_opened_at: Option<String>,
    pub archived: bool,
    canonical_root: PathBuf,
    root_identity: Option<RootIdentity>,
}

impl std::fmt::Debug for PrivateProjectEntry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PrivateProjectEntry")
            .field("project_id", &self.project_id)
            .field("display_name", &self.display_name)
            .field("revision", &self.revision)
            .field("created_at", &self.created_at)
            .field("last_opened_at", &self.last_opened_at)
            .field("archived", &self.archived)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ProjectContext {
    project_id: String,
    revision: String,
    display_name: String,
    canonical_root: PathBuf,
    storage: ProjectStoragePaths,
}

impl ProjectContext {
    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn revision(&self) -> &str {
        &self.revision
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn canonical_root(&self) -> &Path {
        &self.canonical_root
    }

    pub fn storage(&self) -> &ProjectStoragePaths {
        &self.storage
    }
}

impl std::fmt::Debug for ProjectContext {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProjectContext")
            .field("project_id", &self.project_id)
            .field("revision", &self.revision)
            .field("display_name", &self.display_name)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProjectContextError {
    #[error("project not found")]
    NotFound,
    #[error("project is archived")]
    Archived,
    #[error("project root is unavailable")]
    RootMissing,
    #[error("project storage unavailable")]
    StorageUnavailable,
}

impl PrivateProjectEntry {
    pub fn canonical_root(&self) -> &Path {
        &self.canonical_root
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectRegistry {
    version: u32,
    revision: String,
    projects: Vec<StoredProjectEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredProjectEntry {
    project_id: String,
    display_name: String,
    canonical_root: PathBuf,
    revision: String,
    created_at: String,
    last_opened_at: Option<String>,
    archived: bool,
    root_identity: Option<RootIdentity>,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RootIdentity {
    device: u64,
    inode: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VersionTwoProjectRegistry {
    version: u32,
    revision: String,
    projects: Vec<VersionTwoStoredProjectEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VersionTwoStoredProjectEntry {
    project_id: String,
    display_name: String,
    canonical_root: PathBuf,
    revision: String,
    created_at: String,
    last_opened_at: Option<String>,
    archived: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyProjectRegistry {
    version: u32,
    projects: Vec<LegacyStoredProjectEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyStoredProjectEntry {
    project_id: String,
    display_name: String,
    canonical_root: PathBuf,
    created_at: String,
    last_opened_at: String,
    archived: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProjectRegistryError {
    #[error("invalid project registry request")]
    InvalidRequest,
    #[error("project not found")]
    NotFound,
    #[error("project is archived")]
    Archived,
    #[error("project registry revision conflict")]
    Conflict,
    #[error("project registry limit reached")]
    LimitReached,
    #[error("project root is unavailable")]
    RootUnavailable,
    #[error("project registry storage unavailable")]
    Storage,
}

impl ProjectRegistryRuntime {
    pub fn new(storage_paths: &StoragePaths) -> Self {
        Self {
            registry_path: storage_paths.project_registry_path(),
            config_dir: storage_paths.config_dir.clone(),
            cache_dir: storage_paths.cache_dir.clone(),
            state: Arc::new(tokio::sync::Mutex::new(None)),
            #[cfg(test)]
            fail_writes: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn registry_path(&self) -> &Path {
        &self.registry_path
    }

    pub async fn load(&self) -> Result<(), ProjectRegistryError> {
        self.validate_registry_storage()?;
        let mut state = self.state.lock().await;
        *state = Some(load_registry(&self.registry_path).await?);
        Ok(())
    }

    pub async fn list_summaries(&self) -> Result<Vec<ProjectSummary>, ProjectRegistryError> {
        self.validate_registry_storage()?;
        let mut state = self.state.lock().await;
        let registry = ensure_loaded(&self.registry_path, &mut state).await?;
        Ok(registry.projects.iter().map(project_summary).collect())
    }

    pub async fn get_private_entry(
        &self,
        project_id: &str,
    ) -> Result<PrivateProjectEntry, ProjectRegistryError> {
        validate_project_id(project_id)?;
        self.validate_registry_storage()?;
        let mut state = self.state.lock().await;
        let registry = ensure_loaded(&self.registry_path, &mut state).await?;
        registry
            .projects
            .iter()
            .find(|entry| entry.project_id == project_id)
            .map(private_entry)
            .ok_or(ProjectRegistryError::NotFound)
    }

    pub async fn get_active_private_entry(
        &self,
        project_id: &str,
    ) -> Result<PrivateProjectEntry, ProjectRegistryError> {
        let entry = self.get_private_entry(project_id).await?;
        if entry.archived {
            Err(ProjectRegistryError::Archived)
        } else if !root_is_available(entry.canonical_root(), entry.root_identity) {
            Err(ProjectRegistryError::RootUnavailable)
        } else {
            Ok(entry)
        }
    }

    pub async fn resolve_context(
        &self,
        storage_paths: &StoragePaths,
        project_id: &str,
    ) -> Result<ProjectContext, ProjectContextError> {
        if !is_valid_project_id(project_id) {
            return Err(ProjectContextError::NotFound);
        }
        if storage_paths.config_dir != self.config_dir || storage_paths.cache_dir != self.cache_dir
        {
            return Err(ProjectContextError::StorageUnavailable);
        }
        let entry = self
            .get_private_entry(project_id)
            .await
            .map_err(|error| match error {
                ProjectRegistryError::NotFound | ProjectRegistryError::InvalidRequest => {
                    ProjectContextError::NotFound
                }
                _ => ProjectContextError::StorageUnavailable,
            })?;
        if entry.archived {
            return Err(ProjectContextError::Archived);
        }
        if !root_is_available(entry.canonical_root(), entry.root_identity) {
            return Err(ProjectContextError::RootMissing);
        }
        let storage = storage_paths
            .project_storage_paths(project_id)
            .map_err(|_| ProjectContextError::StorageUnavailable)?;
        Ok(ProjectContext {
            project_id: entry.project_id,
            revision: entry.revision,
            display_name: entry.display_name,
            canonical_root: entry.canonical_root,
            storage,
        })
    }

    pub async fn register(
        &self,
        root: impl AsRef<Path>,
        display_name: Option<&str>,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        let canonical_root = canonical_directory(root.as_ref()).await?;
        let root_identity = readable_root_identity(&canonical_root)?;
        self.validate_registration_root(&canonical_root)?;
        let display_name = match display_name {
            Some(value) => validate_display_name(value)?.to_string(),
            None => default_display_name(&canonical_root),
        };
        let mut state = self.state.lock().await;
        let registry = ensure_loaded(&self.registry_path, &mut state).await?;
        let mut candidate = registry.clone();
        if let Some(entry) = registry
            .projects
            .iter()
            .find(|entry| entry.canonical_root == canonical_root)
        {
            if entry.root_identity == root_identity
                && root_is_available(&entry.canonical_root, entry.root_identity)
            {
                return Ok(project_summary(entry));
            }
            return Err(ProjectRegistryError::RootUnavailable);
        }
        if candidate.projects.len() >= REGISTRY_MAX_PROJECTS {
            return Err(ProjectRegistryError::LimitReached);
        }
        if !root_is_available(&canonical_root, root_identity) {
            return Err(ProjectRegistryError::RootUnavailable);
        }
        let now = timestamp_now();
        candidate.projects.push(StoredProjectEntry {
            project_id: unique_project_id(&candidate)?,
            display_name,
            canonical_root,
            revision: INITIAL_REVISION.to_string(),
            created_at: now.clone(),
            last_opened_at: None,
            archived: false,
            root_identity,
        });
        candidate.revision = increment_revision(&candidate.revision)?;
        self.persist(&candidate).await?;
        let summary = project_summary(candidate.projects.last().expect("inserted project"));
        *registry = candidate;
        Ok(summary)
    }

    pub async fn update_display_name(
        &self,
        project_id: &str,
        display_name: &str,
        expected_revision: &str,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_project_id(project_id)?;
        let display_name = validate_display_name(display_name)?.to_string();
        self.mutate(project_id, expected_revision, move |entry| {
            entry.display_name = display_name
        })
        .await
    }

    pub async fn archive(
        &self,
        project_id: &str,
        expected_revision: &str,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_project_id(project_id)?;
        self.mutate(project_id, expected_revision, |entry| entry.archived = true)
            .await
    }

    pub async fn restore(
        &self,
        project_id: &str,
        expected_revision: &str,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_project_id(project_id)?;
        self.mutate(project_id, expected_revision, |entry| {
            entry.archived = false
        })
        .await
    }

    pub async fn mark_opened(
        &self,
        project_id: &str,
        expected_revision: &str,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_project_id(project_id)?;
        let now = timestamp_now();
        self.mutate_checked(project_id, expected_revision, move |entry| {
            if entry.archived {
                return Err(ProjectRegistryError::Archived);
            }
            if !root_is_available(&entry.canonical_root, entry.root_identity) {
                return Err(ProjectRegistryError::RootUnavailable);
            }
            entry.last_opened_at = Some(now);
            Ok(())
        })
        .await
    }

    async fn mutate(
        &self,
        project_id: &str,
        expected_revision: &str,
        change: impl FnOnce(&mut StoredProjectEntry),
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        self.mutate_checked(project_id, expected_revision, |entry| {
            change(entry);
            Ok(())
        })
        .await
    }

    async fn mutate_checked(
        &self,
        project_id: &str,
        expected_revision: &str,
        change: impl FnOnce(&mut StoredProjectEntry) -> Result<(), ProjectRegistryError>,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_revision(expected_revision).map_err(|_| ProjectRegistryError::InvalidRequest)?;
        self.validate_registry_storage()?;
        let mut state = self.state.lock().await;
        let registry = ensure_loaded(&self.registry_path, &mut state).await?;
        let mut candidate = registry.clone();
        let entry = candidate
            .projects
            .iter_mut()
            .find(|entry| entry.project_id == project_id)
            .ok_or(ProjectRegistryError::NotFound)?;
        if entry.revision != expected_revision {
            return Err(ProjectRegistryError::Conflict);
        }
        change(entry)?;
        entry.revision = increment_revision(&entry.revision)?;
        candidate.revision = increment_revision(&candidate.revision)?;
        self.persist(&candidate).await?;
        let summary = candidate
            .projects
            .iter()
            .find(|entry| entry.project_id == project_id)
            .map(project_summary)
            .expect("mutated project");
        *registry = candidate;
        Ok(summary)
    }

    async fn persist(&self, registry: &ProjectRegistry) -> Result<(), ProjectRegistryError> {
        #[cfg(test)]
        if self.fail_writes.load(Ordering::SeqCst) {
            return Err(ProjectRegistryError::Storage);
        }
        self.validate_registry_storage()?;
        persist_registry(&self.registry_path, registry).await
    }

    fn validate_registry_storage(&self) -> Result<(), ProjectRegistryError> {
        validate_storage_chain(&self.config_dir).map_err(|_| ProjectRegistryError::Storage)?;
        validate_storage_chain(&self.cache_dir).map_err(|_| ProjectRegistryError::Storage)?;
        validate_storage_chain(
            self.registry_path
                .parent()
                .ok_or(ProjectRegistryError::Storage)?,
        )
        .map_err(|_| ProjectRegistryError::Storage)
    }

    fn validate_registration_root(&self, root: &Path) -> Result<(), ProjectRegistryError> {
        let config = canonical_storage_boundary(&self.config_dir)
            .map_err(|_| ProjectRegistryError::Storage)?;
        let cache = canonical_storage_boundary(&self.cache_dir)
            .map_err(|_| ProjectRegistryError::Storage)?;
        if [config.as_path(), cache.as_path()]
            .into_iter()
            .any(|boundary| root.starts_with(boundary) || boundary.starts_with(root))
        {
            return Err(ProjectRegistryError::InvalidRequest);
        }
        Ok(())
    }
}

async fn ensure_loaded<'a>(
    path: &Path,
    state: &'a mut Option<ProjectRegistry>,
) -> Result<&'a mut ProjectRegistry, ProjectRegistryError> {
    if state.is_none() {
        *state = Some(load_registry(path).await?);
    }
    Ok(state.as_mut().expect("loaded registry"))
}

fn private_entry(entry: &StoredProjectEntry) -> PrivateProjectEntry {
    PrivateProjectEntry {
        project_id: entry.project_id.clone(),
        display_name: entry.display_name.clone(),
        revision: entry.revision.clone(),
        created_at: entry.created_at.clone(),
        last_opened_at: entry.last_opened_at.clone(),
        archived: entry.archived,
        canonical_root: entry.canonical_root.clone(),
        root_identity: entry.root_identity,
    }
}

fn project_summary(entry: &StoredProjectEntry) -> ProjectSummary {
    let root_available = root_is_available(&entry.canonical_root, entry.root_identity);
    ProjectSummary {
        project_id: entry.project_id.clone(),
        display_name: entry.display_name.clone(),
        status: if entry.archived {
            ProjectStatus::Archived
        } else if root_available {
            ProjectStatus::Available
        } else {
            ProjectStatus::Missing
        },
        revision: entry.revision.clone(),
        created_at: entry.created_at.clone(),
        last_opened_at: entry.last_opened_at.clone(),
        root_available,
        cloud_required: false,
        provider_access: "direct".to_string(),
    }
}

async fn canonical_directory(path: &Path) -> Result<PathBuf, ProjectRegistryError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let canonical =
            std::fs::canonicalize(path).map_err(|_| ProjectRegistryError::RootUnavailable)?;
        if !canonical.is_absolute() || !canonical.is_dir() {
            return Err(ProjectRegistryError::RootUnavailable);
        }
        Ok(canonical)
    })
    .await
    .map_err(|_| ProjectRegistryError::Storage)?
}

fn default_display_name(root: &Path) -> String {
    root.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| validate_display_name(value).is_ok())
        .unwrap_or("Local project")
        .to_string()
}

fn validate_display_name(value: &str) -> Result<&str, ProjectRegistryError> {
    if value.is_empty()
        || value.chars().count() > DISPLAY_NAME_MAX_CHARS
        || value.trim() != value
        || value.chars().any(|character| {
            matches!(character as u32, 0x00..=0x1f | 0x7f..=0x9f) || matches!(character, '/' | '\\')
        })
    {
        return Err(ProjectRegistryError::InvalidRequest);
    }
    let lower = value.to_ascii_lowercase();
    if [
        "apikey",
        "api_key",
        "authorization",
        "bearer",
        "token",
        "secret",
        "password",
        "http://",
        "https://",
        "file:",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return Err(ProjectRegistryError::InvalidRequest);
    }
    Ok(value)
}

fn new_project_id() -> Result<String, ProjectRegistryError> {
    let mut bytes = [0u8; PROJECT_ID_RANDOM_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|_| ProjectRegistryError::Storage)?;
    Ok(format!(
        "prj_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    ))
}

fn unique_project_id(registry: &ProjectRegistry) -> Result<String, ProjectRegistryError> {
    for _ in 0..8 {
        let candidate = new_project_id()?;
        if !registry
            .projects
            .iter()
            .any(|entry| entry.project_id == candidate)
        {
            return Ok(candidate);
        }
    }
    Err(ProjectRegistryError::Storage)
}

pub(crate) fn is_valid_project_id(value: &str) -> bool {
    if value.len() != 26 || !value.starts_with("prj_") {
        return false;
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&value[4..])
        .is_ok_and(|decoded| {
            decoded.len() == PROJECT_ID_RANDOM_BYTES
                && base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(decoded) == value[4..]
        })
}

fn validate_project_id(value: &str) -> Result<(), ProjectRegistryError> {
    is_valid_project_id(value)
        .then_some(())
        .ok_or(ProjectRegistryError::InvalidRequest)
}

fn root_is_available(root: &Path, expected_identity: Option<RootIdentity>) -> bool {
    std::fs::canonicalize(root).is_ok_and(|current| {
        current == root
            && current.is_dir()
            && std::fs::read_dir(&current).is_ok()
            && current_root_identity(&current).is_some_and(|identity| identity == expected_identity)
    })
}

fn readable_root_identity(root: &Path) -> Result<Option<RootIdentity>, ProjectRegistryError> {
    if !root.is_dir() || std::fs::read_dir(root).is_err() {
        return Err(ProjectRegistryError::RootUnavailable);
    }
    current_root_identity(root).ok_or(ProjectRegistryError::RootUnavailable)
}

#[cfg(unix)]
fn current_root_identity(root: &Path) -> Option<Option<RootIdentity>> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::metadata(root).ok()?;
    Some(Some(RootIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }))
}

#[cfg(not(unix))]
fn current_root_identity(_root: &Path) -> Option<Option<RootIdentity>> {
    Some(None)
}

fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn validate_revision(value: &str) -> Result<u64, ProjectRegistryError> {
    if value.is_empty()
        || value == "0"
        || value.len() > 20
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(ProjectRegistryError::Storage);
    }
    value
        .parse::<u64>()
        .map_err(|_| ProjectRegistryError::Storage)
}

fn increment_revision(value: &str) -> Result<String, ProjectRegistryError> {
    validate_revision(value)?
        .checked_add(1)
        .map(|revision| revision.to_string())
        .ok_or(ProjectRegistryError::Conflict)
}

async fn load_registry(path: &Path) -> Result<ProjectRegistry, ProjectRegistryError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || load_registry_sync(&path))
        .await
        .map_err(|_| ProjectRegistryError::Storage)?
}

fn load_registry_sync(path: &Path) -> Result<ProjectRegistry, ProjectRegistryError> {
    ensure_existing_registry_directory(path)?;
    let Some(mut file) = open_registry_file(path)? else {
        return Ok(ProjectRegistry {
            version: REGISTRY_VERSION,
            revision: INITIAL_REVISION.to_string(),
            projects: Vec::new(),
        });
    };
    set_private_file(&file)?;
    if file
        .metadata()
        .map_err(|_| ProjectRegistryError::Storage)?
        .len()
        > REGISTRY_MAX_BYTES
    {
        return Err(ProjectRegistryError::Storage);
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| ProjectRegistryError::Storage)?;
    drop(file);
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| ProjectRegistryError::Storage)?;
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or(ProjectRegistryError::Storage)?;
    let (registry, migrated) = match version {
        current if current == REGISTRY_VERSION as u64 => (
            serde_json::from_value(value).map_err(|_| ProjectRegistryError::Storage)?,
            false,
        ),
        2 => (
            migrate_version_two_registry(
                serde_json::from_slice(&bytes).map_err(|_| ProjectRegistryError::Storage)?,
            )?,
            true,
        ),
        1 => (
            migrate_legacy_registry(
                serde_json::from_slice(&bytes).map_err(|_| ProjectRegistryError::Storage)?,
            )?,
            true,
        ),
        _ => return Err(ProjectRegistryError::Storage),
    };
    validate_registry(&registry)?;
    if migrated {
        let bytes =
            serde_json::to_vec_pretty(&registry).map_err(|_| ProjectRegistryError::Storage)?;
        if bytes.len() as u64 > REGISTRY_MAX_BYTES {
            return Err(ProjectRegistryError::Storage);
        }
        atomic_write_registry(path, &bytes)?;
    }
    Ok(registry)
}

fn migrate_version_two_registry(
    legacy: VersionTwoProjectRegistry,
) -> Result<ProjectRegistry, ProjectRegistryError> {
    if legacy.version != 2 {
        return Err(ProjectRegistryError::Storage);
    }
    Ok(ProjectRegistry {
        version: REGISTRY_VERSION,
        revision: legacy.revision,
        projects: legacy
            .projects
            .into_iter()
            .map(|entry| StoredProjectEntry {
                root_identity: backfill_root_identity(&entry.canonical_root),
                project_id: entry.project_id,
                display_name: entry.display_name,
                canonical_root: entry.canonical_root,
                revision: entry.revision,
                created_at: entry.created_at,
                last_opened_at: entry.last_opened_at,
                archived: entry.archived,
            })
            .collect(),
    })
}

fn migrate_legacy_registry(
    legacy: LegacyProjectRegistry,
) -> Result<ProjectRegistry, ProjectRegistryError> {
    if legacy.version != 1 {
        return Err(ProjectRegistryError::Storage);
    }
    let projects = legacy
        .projects
        .into_iter()
        .map(|entry| StoredProjectEntry {
            root_identity: backfill_root_identity(&entry.canonical_root),
            project_id: entry.project_id,
            display_name: entry.display_name,
            canonical_root: entry.canonical_root,
            revision: INITIAL_REVISION.to_string(),
            created_at: entry.created_at,
            last_opened_at: Some(entry.last_opened_at),
            archived: entry.archived,
        })
        .collect();
    Ok(ProjectRegistry {
        version: REGISTRY_VERSION,
        revision: INITIAL_REVISION.to_string(),
        projects,
    })
}

fn backfill_root_identity(root: &Path) -> Option<RootIdentity> {
    std::fs::canonicalize(root)
        .ok()
        .filter(|current| current == root)
        .and_then(|current| readable_root_identity(&current).ok())
        .flatten()
}

fn validate_registry(registry: &ProjectRegistry) -> Result<(), ProjectRegistryError> {
    if registry.version != REGISTRY_VERSION
        || registry.projects.len() > REGISTRY_MAX_PROJECTS
        || validate_revision(&registry.revision).is_err()
    {
        return Err(ProjectRegistryError::Storage);
    }
    let mut ids = HashSet::new();
    let mut roots = HashSet::new();
    for entry in &registry.projects {
        validate_project_id(&entry.project_id).map_err(|_| ProjectRegistryError::Storage)?;
        validate_display_name(&entry.display_name).map_err(|_| ProjectRegistryError::Storage)?;
        if !entry.canonical_root.is_absolute()
            || !ids.insert(&entry.project_id)
            || !roots.insert(&entry.canonical_root)
            || validate_revision(&entry.revision).is_err()
            || !valid_timestamp(&entry.created_at)
            || entry
                .last_opened_at
                .as_deref()
                .is_some_and(|timestamp| !valid_timestamp(timestamp))
        {
            return Err(ProjectRegistryError::Storage);
        }
    }
    Ok(())
}

fn valid_timestamp(value: &str) -> bool {
    value.len() >= 20
        && value.len() <= 32
        && value.ends_with('Z')
        && chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

async fn persist_registry(
    path: &Path,
    registry: &ProjectRegistry,
) -> Result<(), ProjectRegistryError> {
    validate_registry(registry)?;
    let bytes = serde_json::to_vec_pretty(registry).map_err(|_| ProjectRegistryError::Storage)?;
    if bytes.len() as u64 > REGISTRY_MAX_BYTES {
        return Err(ProjectRegistryError::Storage);
    }
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || atomic_write_registry(&path, &bytes))
        .await
        .map_err(|_| ProjectRegistryError::Storage)?
}

fn atomic_write_registry(path: &Path, bytes: &[u8]) -> Result<(), ProjectRegistryError> {
    ensure_registry_directory(path)?;
    reject_registry_file_symlink(path)?;
    let counter = TEMP_REGISTRY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = path.with_file_name(format!(
        ".registry.json.tmp.{}.{}",
        std::process::id(),
        counter
    ));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temp)
            .map_err(|_| ProjectRegistryError::Storage)?;
        file.write_all(bytes)
            .map_err(|_| ProjectRegistryError::Storage)?;
        file.sync_all().map_err(|_| ProjectRegistryError::Storage)?;
        set_private_file(&file)?;
        reject_registry_file_symlink(path)?;
        std::fs::rename(&temp, path).map_err(|_| ProjectRegistryError::Storage)?;
        let _ = sync_directory(path.parent().ok_or(ProjectRegistryError::Storage)?);
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn ensure_existing_registry_directory(path: &Path) -> Result<(), ProjectRegistryError> {
    let directory = path.parent().ok_or(ProjectRegistryError::Storage)?;
    match std::fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            set_private_directory(directory)
        }
        Ok(_) => Err(ProjectRegistryError::Storage),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ProjectRegistryError::Storage),
    }
}

fn ensure_registry_directory(path: &Path) -> Result<(), ProjectRegistryError> {
    let directory = path.parent().ok_or(ProjectRegistryError::Storage)?;
    let parent = directory.parent().ok_or(ProjectRegistryError::Storage)?;
    std::fs::create_dir_all(parent).map_err(|_| ProjectRegistryError::Storage)?;
    match std::fs::create_dir(directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(ProjectRegistryError::Storage),
    }
    let metadata =
        std::fs::symlink_metadata(directory).map_err(|_| ProjectRegistryError::Storage)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ProjectRegistryError::Storage);
    }
    set_private_directory(directory)
}

fn reject_registry_file_symlink(path: &Path) -> Result<(), ProjectRegistryError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(ProjectRegistryError::Storage),
        Ok(metadata) if !metadata.is_file() => Err(ProjectRegistryError::Storage),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ProjectRegistryError::Storage),
    }
}

#[cfg(unix)]
fn open_registry_file(path: &Path) -> Result<Option<std::fs::File>, ProjectRegistryError> {
    use std::os::unix::fs::OpenOptionsExt;
    match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Ok(file) => Ok(Some(file)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ProjectRegistryError::Storage),
    }
}

#[cfg(not(unix))]
fn open_registry_file(path: &Path) -> Result<Option<std::fs::File>, ProjectRegistryError> {
    reject_registry_file_symlink(path)?;
    match std::fs::File::open(path) {
        Ok(file) => Ok(Some(file)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ProjectRegistryError::Storage),
    }
}

#[cfg(unix)]
fn set_private_file(file: &std::fs::File) -> Result<(), ProjectRegistryError> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|_| ProjectRegistryError::Storage)
}

#[cfg(not(unix))]
fn set_private_file(_file: &std::fs::File) -> Result<(), ProjectRegistryError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> Result<(), ProjectRegistryError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| ProjectRegistryError::Storage)
}

#[cfg(not(unix))]
fn set_private_directory(_path: &Path) -> Result<(), ProjectRegistryError> {
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), ProjectRegistryError> {
    use std::os::unix::fs::OpenOptionsExt;
    let result = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .and_then(|directory| directory.sync_all());
    match result {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::PermissionDenied
                    | std::io::ErrorKind::Unsupported
                    | std::io::ErrorKind::InvalidInput
            ) =>
        {
            Ok(())
        }
        Err(_) => Err(ProjectRegistryError::Storage),
    }
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), ProjectRegistryError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage_paths(temp: &tempfile::TempDir) -> StoragePaths {
        StoragePaths {
            project_dir: temp.path().join("legacy"),
            config_dir: temp.path().join("config"),
            cache_dir: temp.path().join("cache"),
        }
    }

    fn registry_path(temp: &tempfile::TempDir) -> PathBuf {
        temp.path()
            .join("config")
            .join("projects")
            .join("registry.json")
    }

    fn paths_for_registry_path(path: &Path) -> StoragePaths {
        let config_dir = path.parent().unwrap().parent().unwrap().to_path_buf();
        StoragePaths {
            project_dir: config_dir.join("legacy"),
            cache_dir: config_dir.parent().unwrap().join("cache"),
            config_dir,
        }
    }

    #[test]
    fn projects_id_uses_exact_random_byte_contract() {
        for _ in 0..32 {
            let id = new_project_id().unwrap();
            assert_eq!(id.len(), 26);
            assert!(id.starts_with("prj_"));
            assert_eq!(
                base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(&id[4..])
                    .unwrap()
                    .len(),
                16
            );
            assert!(validate_project_id(&id).is_ok());
        }
    }

    #[tokio::test]
    async fn projects_persist_reload_and_public_json_hides_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("private-root-marker");
        std::fs::create_dir(&root).unwrap();
        let runtime = ProjectRegistryRuntime::new(&storage_paths(&temp));
        let created = runtime.register(&root, Some("Example")).await.unwrap();
        assert_eq!(created.revision, INITIAL_REVISION);
        assert_eq!(created.last_opened_at, None);
        let json = serde_json::to_string(&created).unwrap();
        assert!(!json.contains("private-root-marker"));
        assert!(!json.contains("canonical"));

        let reloaded = ProjectRegistryRuntime::new(&storage_paths(&temp));
        reloaded.load().await.unwrap();
        let summaries = reloaded.list_summaries().await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].project_id, created.project_id);
        assert_eq!(summaries[0].status, ProjectStatus::Available);
        assert_eq!(
            reloaded
                .get_private_entry(&created.project_id)
                .await
                .unwrap()
                .canonical_root(),
            std::fs::canonicalize(root).unwrap()
        );
        let private_debug = format!(
            "{:?}",
            reloaded
                .get_private_entry(&created.project_id)
                .await
                .unwrap()
        );
        assert!(!private_debug.contains("root_identity"));
        assert!(!private_debug.contains("device"));
        assert!(!private_debug.contains("inode"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn projects_replaced_root_is_unavailable_everywhere() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let old_root = temp.path().join("old-root");
        std::fs::create_dir(&root).unwrap();
        let paths = storage_paths(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths);
        let created = runtime.register(&root, Some("Original")).await.unwrap();

        std::fs::rename(&root, &old_root).unwrap();
        std::fs::create_dir(&root).unwrap();

        let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(summary.status, ProjectStatus::Missing);
        assert!(!summary.root_available);
        assert_eq!(
            runtime
                .get_active_private_entry(&created.project_id)
                .await
                .unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        assert_eq!(
            runtime
                .resolve_context(&paths, &created.project_id)
                .await
                .unwrap_err(),
            ProjectContextError::RootMissing
        );
        assert_eq!(
            runtime
                .mark_opened(&created.project_id, &created.revision)
                .await
                .unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        assert_eq!(
            runtime
                .register(&root, Some("Replacement"))
                .await
                .unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        assert_eq!(runtime.list_summaries().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn projects_same_root_is_idempotent_distinct_roots_and_duplicate_labels_are_allowed() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        let runtime = ProjectRegistryRuntime::new(&storage_paths(&temp));
        let one = runtime
            .register(first.join("..").join("first"), Some("Same"))
            .await
            .unwrap();
        let again = runtime.register(&first, Some("Ignored")).await.unwrap();
        let two = runtime.register(&second, Some("Same")).await.unwrap();
        assert_eq!(one.project_id, again.project_id);
        assert_eq!(one.display_name, again.display_name);
        assert_eq!(one.revision, again.revision);
        assert_eq!(one.created_at, again.created_at);
        assert_eq!(one.last_opened_at, again.last_opened_at);
        assert_ne!(one.project_id, two.project_id);
        assert_eq!(runtime.list_summaries().await.unwrap().len(), 2);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn projects_symlink_root_canonicalizes_to_target() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("target");
        let link = temp.path().join("link");
        std::fs::create_dir(&target).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let runtime = ProjectRegistryRuntime::new(&storage_paths(&temp));
        let linked = runtime.register(&link, Some("Linked")).await.unwrap();
        let direct = runtime.register(&target, Some("Direct")).await.unwrap();
        assert_eq!(linked.project_id, direct.project_id);
    }

    #[tokio::test]
    async fn projects_concurrent_same_root_registration_has_one_record() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let runtime = ProjectRegistryRuntime::new(&storage_paths(&temp));
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let runtime = runtime.clone();
            let root = root.clone();
            tasks.push(tokio::spawn(async move {
                runtime
                    .register(root, Some("Concurrent"))
                    .await
                    .unwrap()
                    .project_id
            }));
        }
        let mut ids = HashSet::new();
        for task in tasks {
            ids.insert(task.await.unwrap());
        }
        assert_eq!(ids.len(), 1);
        assert_eq!(runtime.list_summaries().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn projects_archive_restore_missing_and_private_access_policy() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let runtime = ProjectRegistryRuntime::new(&storage_paths(&temp));
        let created = runtime.register(&root, Some("Lifecycle")).await.unwrap();
        let archived = runtime
            .archive(&created.project_id, &created.revision)
            .await
            .unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        assert_eq!(
            runtime
                .get_active_private_entry(&created.project_id)
                .await
                .unwrap_err(),
            ProjectRegistryError::Archived
        );
        assert_eq!(
            runtime
                .restore(&created.project_id, &archived.revision)
                .await
                .unwrap()
                .status,
            ProjectStatus::Available
        );
        std::fs::remove_dir(&root).unwrap();
        assert_eq!(
            runtime
                .get_active_private_entry(&created.project_id)
                .await
                .unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(summary.status, ProjectStatus::Missing);
        assert!(!summary.root_available);
    }

    #[tokio::test]
    async fn projects_reject_private_storage_roots_and_accept_siblings() {
        let temp = tempfile::tempdir().unwrap();
        let paths = storage_paths(&temp);
        std::fs::create_dir_all(paths.config_dir.join("projects")).unwrap();
        std::fs::create_dir_all(&paths.cache_dir).unwrap();
        let sibling = temp.path().join("workspace");
        std::fs::create_dir(&sibling).unwrap();
        let runtime = ProjectRegistryRuntime::new(&paths);

        for root in [
            temp.path().to_path_buf(),
            paths.config_dir.clone(),
            paths.config_dir.join("projects"),
            paths.cache_dir.clone(),
        ] {
            assert_eq!(
                runtime.register(&root, Some("Private")).await.unwrap_err(),
                ProjectRegistryError::InvalidRequest
            );
        }
        assert!(runtime.register(&sibling, Some("Sibling")).await.is_ok());
    }

    #[tokio::test]
    async fn projects_corrupt_and_oversized_registry_fail_safely() {
        for content in [vec![b'{'], vec![b'x'; REGISTRY_MAX_BYTES as usize + 1]] {
            let temp = tempfile::tempdir().unwrap();
            let path = registry_path(&temp);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, content).unwrap();
            let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
            assert_eq!(
                runtime.load().await.unwrap_err(),
                ProjectRegistryError::Storage
            );
            assert!(path.exists());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn projects_registry_permissions_and_symlink_escape_are_hardened() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let path = registry_path(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.register(&root, Some("Private")).await.unwrap();
        assert_eq!(
            std::fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let other = tempfile::tempdir().unwrap();
        let escaped_path = other
            .path()
            .join("config")
            .join("projects")
            .join("registry.json");
        std::fs::create_dir_all(escaped_path.parent().unwrap().parent().unwrap()).unwrap();
        let outside = other.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, escaped_path.parent().unwrap()).unwrap();
        let escaped = ProjectRegistryRuntime::new(&paths_for_registry_path(&escaped_path));
        assert_eq!(
            escaped
                .register(&root, Some("No escape"))
                .await
                .unwrap_err(),
            ProjectRegistryError::Storage
        );
        assert!(std::fs::read_dir(outside).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn projects_registry_rejects_symlinked_trusted_storage_chain() {
        let root_temp = tempfile::tempdir().unwrap();
        let root = root_temp.path().join("root");
        std::fs::create_dir(&root).unwrap();

        for boundary in ["config", "cache", "ancestor"] {
            let temp = tempfile::tempdir().unwrap();
            let outside = tempfile::tempdir().unwrap();
            let mut paths = storage_paths(&temp);
            match boundary {
                "config" => std::os::unix::fs::symlink(outside.path(), &paths.config_dir).unwrap(),
                "cache" => std::os::unix::fs::symlink(outside.path(), &paths.cache_dir).unwrap(),
                _ => {
                    let ancestor = temp.path().join("redirected");
                    std::os::unix::fs::symlink(outside.path(), &ancestor).unwrap();
                    paths.config_dir = ancestor.join("config");
                }
            }
            let runtime = ProjectRegistryRuntime::new(&paths);
            assert_eq!(
                runtime.register(&root, Some("Blocked")).await.unwrap_err(),
                ProjectRegistryError::Storage
            );
            assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
        }
    }

    #[tokio::test]
    async fn projects_failed_write_leaves_memory_and_disk_unchanged() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        let path = registry_path(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        let created = runtime.register(&first, Some("First")).await.unwrap();
        let before = std::fs::read(&path).unwrap();
        runtime.fail_writes.store(true, Ordering::SeqCst);
        assert_eq!(
            runtime.register(&second, Some("Second")).await.unwrap_err(),
            ProjectRegistryError::Storage
        );
        let summaries = runtime.list_summaries().await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].project_id, created.project_id);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[tokio::test]
    async fn projects_open_and_mutations_require_current_revision() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let runtime = ProjectRegistryRuntime::new(&storage_paths(&temp));
        let created = runtime.register(&root, Some("Original")).await.unwrap();

        assert_eq!(
            runtime
                .update_display_name(&created.project_id, "Zero", "0")
                .await
                .unwrap_err(),
            ProjectRegistryError::InvalidRequest
        );

        let opened = runtime
            .mark_opened(&created.project_id, &created.revision)
            .await
            .unwrap();
        assert_eq!(opened.revision, "2");
        assert!(opened.last_opened_at.is_some());
        for error in [
            runtime
                .mark_opened(&created.project_id, &created.revision)
                .await
                .unwrap_err(),
            runtime
                .update_display_name(&created.project_id, "Stale", &created.revision)
                .await
                .unwrap_err(),
            runtime
                .archive(&created.project_id, &created.revision)
                .await
                .unwrap_err(),
            runtime
                .restore(&created.project_id, &created.revision)
                .await
                .unwrap_err(),
        ] {
            assert_eq!(error, ProjectRegistryError::Conflict);
        }
    }

    #[tokio::test]
    async fn projects_concurrent_same_revision_mutation_has_one_conflict() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let runtime = ProjectRegistryRuntime::new(&storage_paths(&temp));
        let created = runtime.register(&root, Some("Original")).await.unwrap();
        let first = runtime.update_display_name(&created.project_id, "First", &created.revision);
        let second = runtime.update_display_name(&created.project_id, "Second", &created.revision);
        let (first, second) = tokio::join!(first, second);
        let results = [first, second];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(ProjectRegistryError::Conflict)))
                .count(),
            1
        );
        assert_eq!(runtime.list_summaries().await.unwrap()[0].revision, "2");
    }

    #[tokio::test]
    async fn projects_failed_mutation_write_preserves_revision_and_timestamp() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let path = registry_path(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        let created = runtime.register(&root, Some("Original")).await.unwrap();
        let before = std::fs::read(&path).unwrap();
        runtime.fail_writes.store(true, Ordering::SeqCst);
        assert_eq!(
            runtime
                .mark_opened(&created.project_id, &created.revision)
                .await
                .unwrap_err(),
            ProjectRegistryError::Storage
        );
        let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(summary.revision, created.revision);
        assert_eq!(summary.last_opened_at, None);
        assert_eq!(std::fs::read(path).unwrap(), before);
    }

    #[tokio::test]
    async fn projects_migrate_v1_and_reject_invalid_revisions() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let path = registry_path(&temp);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let project_id = new_project_id().unwrap();
        let timestamp = timestamp_now();
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "version": 1,
                "projects": [{
                    "projectId": project_id,
                    "displayName": "Legacy",
                    "canonicalRoot": std::fs::canonicalize(&root).unwrap(),
                    "createdAt": timestamp,
                    "lastOpenedAt": timestamp,
                    "archived": false
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.load().await.unwrap();
        let migrated = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(migrated.revision, INITIAL_REVISION);
        assert!(migrated.last_opened_at.is_some());
        let migrated_json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(migrated_json["version"], REGISTRY_VERSION);
        #[cfg(unix)]
        assert!(migrated_json["projects"][0]["rootIdentity"]["device"].is_u64());
        #[cfg(unix)]
        assert!(migrated_json["projects"][0]["rootIdentity"]["inode"].is_u64());

        for revision in ["0", "01", "18446744073709551616"] {
            let mut value: serde_json::Value = serde_json::from_slice(
                &serde_json::to_vec(&ProjectRegistry {
                    version: REGISTRY_VERSION,
                    revision: INITIAL_REVISION.to_string(),
                    projects: vec![StoredProjectEntry {
                        project_id: new_project_id().unwrap(),
                        display_name: "Invalid".to_string(),
                        canonical_root: std::fs::canonicalize(&root).unwrap(),
                        revision: INITIAL_REVISION.to_string(),
                        created_at: timestamp_now(),
                        last_opened_at: None,
                        archived: false,
                        root_identity: readable_root_identity(&root).unwrap(),
                    }],
                })
                .unwrap(),
            )
            .unwrap();
            value["projects"][0]["revision"] = serde_json::json!(revision);
            std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
            let invalid = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
            assert_eq!(
                invalid.load().await.unwrap_err(),
                ProjectRegistryError::Storage
            );
        }
    }

    #[tokio::test]
    async fn projects_v2_migration_leaves_unavailable_root_unbound() {
        let temp = tempfile::tempdir().unwrap();
        let path = registry_path(&temp);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let missing = temp.path().join("missing");
        let project_id = new_project_id().unwrap();
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "revision": "7",
                "projects": [{
                    "projectId": project_id,
                    "displayName": "Missing",
                    "canonicalRoot": missing,
                    "revision": "4",
                    "createdAt": timestamp_now(),
                    "lastOpenedAt": null,
                    "archived": false
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.load().await.unwrap();
        let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(summary.status, ProjectStatus::Missing);
        let migrated: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(migrated["version"], REGISTRY_VERSION);
        assert!(migrated["projects"][0]["rootIdentity"].is_null());
    }

    #[tokio::test]
    async fn project_context_paths_are_private_confined_and_concurrent() {
        let temp = tempfile::tempdir().unwrap();
        let first_root = temp.path().join("private-first-root");
        let second_root = temp.path().join("private-second-root");
        std::fs::create_dir(&first_root).unwrap();
        std::fs::create_dir(&second_root).unwrap();
        let paths = storage_paths(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths);
        let first = runtime.register(&first_root, Some("First")).await.unwrap();
        let second = runtime
            .register(&second_root, Some("Second"))
            .await
            .unwrap();

        let (first_context, second_context) = tokio::join!(
            runtime.resolve_context(&paths, &first.project_id),
            runtime.resolve_context(&paths, &second.project_id)
        );
        let first_context = first_context.unwrap();
        let second_context = second_context.unwrap();
        assert_ne!(
            first_context.storage().config_root,
            second_context.storage().config_root
        );
        assert_ne!(
            first_context.storage().cache_root,
            second_context.storage().cache_root
        );
        assert_eq!(first_context.project_id(), first.project_id);
        assert_eq!(first_context.revision(), first.revision);
        assert_eq!(first_context.display_name(), "First");
        assert_eq!(
            first_context.canonical_root(),
            std::fs::canonicalize(&first_root).unwrap()
        );
        assert_eq!(
            first_context.storage().config_root.parent(),
            Some(paths.config_dir.join("projects").as_path())
        );
        assert_eq!(
            first_context.storage().cache_root.parent(),
            Some(paths.cache_dir.join("projects").as_path())
        );
        let debug = format!("{first_context:?}");
        assert!(!debug.contains("private-first-root"));
        assert!(!ProjectContextError::RootMissing
            .to_string()
            .contains("private-first-root"));
    }

    #[tokio::test]
    async fn project_context_invalid_unknown_archived_missing_and_registry_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("private-root-marker");
        std::fs::create_dir(&root).unwrap();
        let paths = storage_paths(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths);
        let created = runtime.register(&root, Some("Lifecycle")).await.unwrap();

        assert_eq!(
            runtime
                .resolve_context(&paths, "../private-root-marker")
                .await
                .unwrap_err(),
            ProjectContextError::NotFound
        );
        assert_eq!(
            runtime
                .resolve_context(&paths, &new_project_id().unwrap())
                .await
                .unwrap_err(),
            ProjectContextError::NotFound
        );
        let archived = runtime
            .archive(&created.project_id, &created.revision)
            .await
            .unwrap();
        assert_eq!(
            runtime
                .resolve_context(&paths, &created.project_id)
                .await
                .unwrap_err(),
            ProjectContextError::Archived
        );
        runtime
            .restore(&created.project_id, &archived.revision)
            .await
            .unwrap();
        std::fs::remove_dir(&root).unwrap();
        assert_eq!(
            runtime
                .resolve_context(&paths, &created.project_id)
                .await
                .unwrap_err(),
            ProjectContextError::RootMissing
        );

        let corrupt = tempfile::tempdir().unwrap();
        let corrupt_paths = storage_paths(&corrupt);
        std::fs::create_dir_all(corrupt_paths.project_registry_path().parent().unwrap()).unwrap();
        std::fs::write(corrupt_paths.project_registry_path(), b"{").unwrap();
        let corrupt_runtime = ProjectRegistryRuntime::new(&corrupt_paths);
        assert_eq!(
            corrupt_runtime
                .resolve_context(&corrupt_paths, &created.project_id)
                .await
                .unwrap_err(),
            ProjectContextError::StorageUnavailable
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn project_context_unsafe_storage_symlink_has_no_global_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let paths = storage_paths(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths);
        let created = runtime
            .register(&root, Some("Unsafe storage"))
            .await
            .unwrap();
        std::os::unix::fs::symlink(
            outside.path(),
            paths.config_dir.join("projects").join(&created.project_id),
        )
        .unwrap();

        assert_eq!(
            runtime
                .resolve_context(&paths, &created.project_id)
                .await
                .unwrap_err(),
            ProjectContextError::StorageUnavailable
        );
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
        assert!(!paths.config_dir.join("chat-history").exists());
        assert!(!paths.cache_dir.join("agent-progress").exists());
    }
}

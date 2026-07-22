use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use chrono::{SecondsFormat, Utc};
use fs2::FileExt;
use serde::{Deserialize, Serialize};

use crate::storage::{
    canonical_storage_boundary, validate_storage_chain, ProjectStoragePaths, StoragePaths,
};

const REGISTRY_VERSION: u32 = 4;
const INITIAL_REVISION: &str = "1";
const REGISTRY_MAX_BYTES: u64 = 2_000_000;
const REGISTRY_MAX_PROJECTS: usize = 10_000;
const DISPLAY_NAME_MAX_CHARS: usize = 120;
const PROJECT_ID_RANDOM_BYTES: usize = 16;
static TEMP_REGISTRY_COUNTER: AtomicU64 = AtomicU64::new(0);
const REGISTRY_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
const REGISTRY_LOCK_RETRY: Duration = Duration::from_millis(10);

#[derive(Clone)]
pub struct ProjectRegistryRuntime {
    registry_path: PathBuf,
    config_dir: PathBuf,
    cache_dir: PathBuf,
    ordering: Arc<tokio::sync::Mutex<()>>,
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
    root_binding: RootBinding,
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

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectRegistry {
    version: u32,
    revision: String,
    projects: Vec<StoredProjectEntry>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredProjectEntry {
    project_id: String,
    display_name: String,
    canonical_root: PathBuf,
    revision: String,
    created_at: String,
    last_opened_at: Option<String>,
    archived: bool,
    root_binding: RootBinding,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RootIdentity {
    device: u64,
    inode: u64,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
enum RootBinding {
    Bound { device: u64, inode: u64 },
    Unsupported,
    Unbound,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VersionThreeProjectRegistry {
    version: u32,
    revision: String,
    projects: Vec<VersionThreeStoredProjectEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VersionThreeStoredProjectEntry {
    project_id: String,
    display_name: String,
    canonical_root: PathBuf,
    revision: String,
    created_at: String,
    last_opened_at: Option<String>,
    archived: bool,
    root_identity: Option<RootIdentity>,
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
            ordering: Arc::new(tokio::sync::Mutex::new(())),
            #[cfg(test)]
            fail_writes: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn registry_path(&self) -> &Path {
        &self.registry_path
    }

    pub async fn load(&self) -> Result<(), ProjectRegistryError> {
        self.validate_registry_storage()?;
        let _ordering = self.ordering.lock().await;
        self.transaction(|_| Ok(())).await?;
        Ok(())
    }

    pub async fn list_summaries(&self) -> Result<Vec<ProjectSummary>, ProjectRegistryError> {
        self.validate_registry_storage()?;
        let _ordering = self.ordering.lock().await;
        let summaries = self
            .transaction(|registry| Ok(registry.projects.iter().map(project_summary).collect()))
            .await?;
        Ok(summaries)
    }

    pub async fn get_private_entry(
        &self,
        project_id: &str,
    ) -> Result<PrivateProjectEntry, ProjectRegistryError> {
        validate_project_id(project_id)?;
        self.validate_registry_storage()?;
        let _ordering = self.ordering.lock().await;
        let project_id = project_id.to_string();
        let entry = self
            .transaction(move |registry| {
                registry
                    .projects
                    .iter()
                    .find(|entry| entry.project_id == project_id)
                    .map(private_entry)
                    .ok_or(ProjectRegistryError::NotFound)
            })
            .await?;
        Ok(entry)
    }

    pub async fn get_active_private_entry(
        &self,
        project_id: &str,
    ) -> Result<PrivateProjectEntry, ProjectRegistryError> {
        let entry = self.get_private_entry(project_id).await?;
        if entry.archived {
            Err(ProjectRegistryError::Archived)
        } else if !root_is_available(entry.canonical_root(), entry.root_binding) {
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
        if !root_is_available(entry.canonical_root(), entry.root_binding) {
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
        let root_binding = readable_root_binding(&canonical_root)?;
        self.validate_registration_root(&canonical_root)?;
        let display_name = match display_name {
            Some(value) => validate_display_name(value)?.to_string(),
            None => default_display_name(&canonical_root),
        };
        let _ordering = self.ordering.lock().await;
        let summary = self
            .transaction(move |registry| {
                if let Some(entry) = registry
                    .projects
                    .iter()
                    .find(|entry| entry.canonical_root == canonical_root)
                {
                    if entry.root_binding == root_binding
                        && root_is_available(&entry.canonical_root, entry.root_binding)
                    {
                        return Ok(project_summary(entry));
                    }
                    return Err(ProjectRegistryError::RootUnavailable);
                }
                if registry.projects.len() >= REGISTRY_MAX_PROJECTS {
                    return Err(ProjectRegistryError::LimitReached);
                }
                if !root_is_available(&canonical_root, root_binding) {
                    return Err(ProjectRegistryError::RootUnavailable);
                }
                let now = timestamp_now();
                registry.projects.push(StoredProjectEntry {
                    project_id: unique_project_id(registry)?,
                    display_name,
                    canonical_root,
                    revision: INITIAL_REVISION.to_string(),
                    created_at: now,
                    last_opened_at: None,
                    archived: false,
                    root_binding,
                });
                registry.revision = increment_revision(&registry.revision)?;
                Ok(project_summary(
                    registry.projects.last().expect("inserted project"),
                ))
            })
            .await?;
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
            if !root_is_available(&entry.canonical_root, entry.root_binding) {
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
        change: impl FnOnce(&mut StoredProjectEntry) + Send + 'static,
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
        change: impl FnOnce(&mut StoredProjectEntry) -> Result<(), ProjectRegistryError>
            + Send
            + 'static,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_revision(expected_revision).map_err(|_| ProjectRegistryError::InvalidRequest)?;
        self.validate_registry_storage()?;
        let _ordering = self.ordering.lock().await;
        let project_id = project_id.to_string();
        let expected_revision = expected_revision.to_string();
        let summary = self
            .transaction(move |registry| {
                let entry = registry
                    .projects
                    .iter_mut()
                    .find(|entry| entry.project_id == project_id)
                    .ok_or(ProjectRegistryError::NotFound)?;
                if entry.revision != expected_revision {
                    return Err(ProjectRegistryError::Conflict);
                }
                change(entry)?;
                entry.revision = increment_revision(&entry.revision)?;
                let summary = project_summary(entry);
                registry.revision = increment_revision(&registry.revision)?;
                Ok(summary)
            })
            .await?;
        Ok(summary)
    }

    async fn transaction<T, F>(&self, operation: F) -> Result<T, ProjectRegistryError>
    where
        T: Send + 'static,
        F: FnOnce(&mut ProjectRegistry) -> Result<T, ProjectRegistryError> + Send + 'static,
    {
        let path = self.registry_path.clone();
        let config_dir = self.config_dir.clone();
        let cache_dir = self.cache_dir.clone();
        #[cfg(test)]
        let fail_writes = self.fail_writes.load(Ordering::SeqCst);
        #[cfg(not(test))]
        let fail_writes = false;
        tokio::task::spawn_blocking(move || {
            registry_transaction(&path, &config_dir, &cache_dir, fail_writes, operation)
        })
        .await
        .map_err(|_| ProjectRegistryError::Storage)?
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

fn private_entry(entry: &StoredProjectEntry) -> PrivateProjectEntry {
    PrivateProjectEntry {
        project_id: entry.project_id.clone(),
        display_name: entry.display_name.clone(),
        revision: entry.revision.clone(),
        created_at: entry.created_at.clone(),
        last_opened_at: entry.last_opened_at.clone(),
        archived: entry.archived,
        canonical_root: entry.canonical_root.clone(),
        root_binding: entry.root_binding,
    }
}

fn project_summary(entry: &StoredProjectEntry) -> ProjectSummary {
    let root_available = root_is_available(&entry.canonical_root, entry.root_binding);
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

fn root_is_available(root: &Path, binding: RootBinding) -> bool {
    std::fs::canonicalize(root).is_ok_and(|current| {
        current == root
            && current.is_dir()
            && std::fs::read_dir(&current).is_ok()
            && binding_matches_current(binding, current_root_identity(&current))
    })
}

fn readable_root_binding(root: &Path) -> Result<RootBinding, ProjectRegistryError> {
    if !root.is_dir() || std::fs::read_dir(root).is_err() {
        return Err(ProjectRegistryError::RootUnavailable);
    }
    current_root_identity(root)
        .map(|identity| match identity {
            Some(identity) => RootBinding::Bound {
                device: identity.device,
                inode: identity.inode,
            },
            None => RootBinding::Unsupported,
        })
        .ok_or(ProjectRegistryError::RootUnavailable)
}

fn binding_matches_current(binding: RootBinding, current: Option<Option<RootIdentity>>) -> bool {
    match (binding, current) {
        (RootBinding::Bound { device, inode }, Some(Some(identity))) => {
            identity == RootIdentity { device, inode }
        }
        (RootBinding::Unsupported, Some(None)) => true,
        (RootBinding::Unbound, _) => false,
        _ => false,
    }
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

fn registry_transaction<T>(
    path: &Path,
    config_dir: &Path,
    cache_dir: &Path,
    fail_writes: bool,
    operation: impl FnOnce(&mut ProjectRegistry) -> Result<T, ProjectRegistryError>,
) -> Result<T, ProjectRegistryError> {
    registry_transaction_after(path, config_dir, cache_dir, fail_writes, operation, || {
        Ok(())
    })
}

fn registry_transaction_after<T>(
    path: &Path,
    config_dir: &Path,
    cache_dir: &Path,
    fail_writes: bool,
    operation: impl FnOnce(&mut ProjectRegistry) -> Result<T, ProjectRegistryError>,
    before_validation: impl FnOnce() -> Result<(), ProjectRegistryError>,
) -> Result<T, ProjectRegistryError> {
    before_validation()?;
    validate_registry_storage_sync(path, config_dir, cache_dir)?;
    let lock = acquire_registry_lock(path)?;
    validate_registry_storage_sync(path, config_dir, cache_dir)?;
    let mut registry = load_registry_sync(path)?;
    let before = registry.clone();
    let result = operation(&mut registry)?;
    if registry != before {
        if fail_writes {
            return Err(ProjectRegistryError::Storage);
        }
        persist_registry_sync(path, &registry)?;
    }
    drop(lock);
    Ok(result)
}

fn validate_registry_storage_sync(
    path: &Path,
    config_dir: &Path,
    cache_dir: &Path,
) -> Result<(), ProjectRegistryError> {
    validate_storage_chain(config_dir).map_err(|_| ProjectRegistryError::Storage)?;
    validate_storage_chain(cache_dir).map_err(|_| ProjectRegistryError::Storage)?;
    validate_storage_chain(path.parent().ok_or(ProjectRegistryError::Storage)?)
        .map_err(|_| ProjectRegistryError::Storage)
}

fn acquire_registry_lock(path: &Path) -> Result<std::fs::File, ProjectRegistryError> {
    acquire_registry_lock_with(path, REGISTRY_LOCK_TIMEOUT, |_| Ok(()))
}

fn acquire_registry_lock_with(
    path: &Path,
    timeout: Duration,
    mut before_acquire: impl FnMut(&Path) -> Result<(), ProjectRegistryError>,
) -> Result<std::fs::File, ProjectRegistryError> {
    ensure_registry_directory(path)?;
    let lock_path = path.with_file_name("registry.lock");
    let deadline = Instant::now() + timeout;
    loop {
        reject_registry_file_symlink(&lock_path)?;
        let mut options = std::fs::OpenOptions::new();
        options.create(true).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let lock = options
            .open(&lock_path)
            .map_err(|_| ProjectRegistryError::Storage)?;
        if verify_open_regular_file(&lock_path, &lock).is_err() {
            if Instant::now() >= deadline {
                return Err(ProjectRegistryError::Storage);
            }
            std::thread::sleep(REGISTRY_LOCK_RETRY);
            continue;
        }
        set_private_file(&lock)?;
        before_acquire(&lock_path)?;
        loop {
            match lock.try_lock_exclusive() {
                Ok(()) => match verify_open_regular_file(&lock_path, &lock) {
                    Ok(()) => return Ok(lock),
                    Err(_) if Instant::now() < deadline => break,
                    Err(_) => return Err(ProjectRegistryError::Storage),
                },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(ProjectRegistryError::Storage);
                    }
                    std::thread::sleep(REGISTRY_LOCK_RETRY);
                }
                Err(_) => return Err(ProjectRegistryError::Storage),
            }
        }
    }
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
    verify_open_regular_file(path, &file)?;
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
        3 => (
            migrate_version_three_registry(
                serde_json::from_slice(&bytes).map_err(|_| ProjectRegistryError::Storage)?,
            )?,
            true,
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

fn migrate_version_three_registry(
    legacy: VersionThreeProjectRegistry,
) -> Result<ProjectRegistry, ProjectRegistryError> {
    if legacy.version != 3 {
        return Err(ProjectRegistryError::Storage);
    }
    Ok(ProjectRegistry {
        version: REGISTRY_VERSION,
        revision: legacy.revision,
        projects: legacy
            .projects
            .into_iter()
            .map(|entry| StoredProjectEntry {
                root_binding: entry
                    .root_identity
                    .map_or(RootBinding::Unbound, |identity| RootBinding::Bound {
                        device: identity.device,
                        inode: identity.inode,
                    }),
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
                root_binding: RootBinding::Unbound,
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
            root_binding: RootBinding::Unbound,
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

fn persist_registry_sync(
    path: &Path,
    registry: &ProjectRegistry,
) -> Result<(), ProjectRegistryError> {
    validate_registry(registry)?;
    let bytes = serde_json::to_vec_pretty(registry).map_err(|_| ProjectRegistryError::Storage)?;
    if bytes.len() as u64 > REGISTRY_MAX_BYTES {
        return Err(ProjectRegistryError::Storage);
    }
    atomic_write_registry(path, &bytes)
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
        sync_directory(path.parent().ok_or(ProjectRegistryError::Storage)?)?;
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
    ensure_registry_directory_with_sync(path, sync_directory)
}

fn ensure_registry_directory_with_sync(
    path: &Path,
    mut sync: impl FnMut(&Path) -> Result<(), ProjectRegistryError>,
) -> Result<(), ProjectRegistryError> {
    let directory = path.parent().ok_or(ProjectRegistryError::Storage)?;
    let parent = directory.parent().ok_or(ProjectRegistryError::Storage)?;
    create_missing_directories_durable(parent, &mut sync)?;
    let mut created = false;
    match std::fs::create_dir(directory) {
        Ok(()) => created = true,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(ProjectRegistryError::Storage),
    }
    let metadata =
        std::fs::symlink_metadata(directory).map_err(|_| ProjectRegistryError::Storage)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(ProjectRegistryError::Storage);
    }
    set_private_directory(directory)?;
    if created {
        sync(parent)?;
    }
    Ok(())
}

fn create_missing_directories_durable(
    directory: &Path,
    sync: &mut impl FnMut(&Path) -> Result<(), ProjectRegistryError>,
) -> Result<(), ProjectRegistryError> {
    let mut missing = Vec::new();
    let mut existing = directory;
    loop {
        match std::fs::symlink_metadata(existing) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => break,
            Ok(_) => return Err(ProjectRegistryError::Storage),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(existing.to_path_buf());
                existing = existing.parent().ok_or(ProjectRegistryError::Storage)?;
            }
            Err(_) => return Err(ProjectRegistryError::Storage),
        }
    }
    for child in missing.iter().rev() {
        match std::fs::create_dir(child) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let metadata =
                    std::fs::symlink_metadata(child).map_err(|_| ProjectRegistryError::Storage)?;
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    return Err(ProjectRegistryError::Storage);
                }
            }
            Err(_) => return Err(ProjectRegistryError::Storage),
        }
        set_private_directory(child)?;
        sync(child.parent().ok_or(ProjectRegistryError::Storage)?)?;
    }
    Ok(())
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

fn verify_open_regular_file(path: &Path, file: &std::fs::File) -> Result<(), ProjectRegistryError> {
    let opened = file.metadata().map_err(|_| ProjectRegistryError::Storage)?;
    let current = std::fs::symlink_metadata(path).map_err(|_| ProjectRegistryError::Storage)?;
    if !opened.is_file() || !current.is_file() || current.file_type().is_symlink() {
        return Err(ProjectRegistryError::Storage);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != current.dev() || opened.ino() != current.ino() {
            return Err(ProjectRegistryError::Storage);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        let opened_identity = (opened.volume_serial_number(), opened.file_index());
        let current_identity = (current.volume_serial_number(), current.file_index());
        if opened_identity.0.is_none()
            || opened_identity.1.is_none()
            || opened_identity != current_identity
        {
            return Err(ProjectRegistryError::Storage);
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        return Err(ProjectRegistryError::Storage);
    }
    Ok(())
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
        Err(error) if ignorable_directory_sync_error(error.kind()) => Ok(()),
        Err(_) => Err(ProjectRegistryError::Storage),
    }
}

fn ignorable_directory_sync_error(kind: std::io::ErrorKind) -> bool {
    matches!(
        kind,
        std::io::ErrorKind::PermissionDenied
            | std::io::ErrorKind::Unsupported
            | std::io::ErrorKind::InvalidInput
    )
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
    async fn projects_independent_runtimes_preserve_concurrent_registrations_and_refresh_reads() {
        let temp = tempfile::tempdir().unwrap();
        let first_root = temp.path().join("first");
        let second_root = temp.path().join("second");
        std::fs::create_dir(&first_root).unwrap();
        std::fs::create_dir(&second_root).unwrap();
        let paths = storage_paths(&temp);
        let first_runtime = ProjectRegistryRuntime::new(&paths);
        let second_runtime = ProjectRegistryRuntime::new(&paths);
        first_runtime.load().await.unwrap();

        let (first, second) = tokio::join!(
            first_runtime.register(&first_root, Some("First")),
            second_runtime.register(&second_root, Some("Second"))
        );
        let first = first.unwrap();
        let second = second.unwrap();
        assert_ne!(first.project_id, second.project_id);

        let summaries = first_runtime.list_summaries().await.unwrap();
        assert_eq!(summaries.len(), 2);
        assert!(summaries
            .iter()
            .any(|summary| summary.project_id == first.project_id));
        assert!(summaries
            .iter()
            .any(|summary| summary.project_id == second.project_id));
    }

    #[tokio::test]
    async fn projects_independent_same_revision_mutations_have_one_conflict() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let paths = storage_paths(&temp);
        let first_runtime = ProjectRegistryRuntime::new(&paths);
        let second_runtime = ProjectRegistryRuntime::new(&paths);
        let created = first_runtime
            .register(&root, Some("Original"))
            .await
            .unwrap();

        let (first, second) = tokio::join!(
            first_runtime.update_display_name(&created.project_id, "First", &created.revision),
            second_runtime.update_display_name(&created.project_id, "Second", &created.revision)
        );
        assert_eq!(
            [&first, &second]
                .iter()
                .filter(|result| result.is_ok())
                .count(),
            1
        );
        assert_eq!(
            [&first, &second]
                .iter()
                .filter(|result| matches!(result, Err(ProjectRegistryError::Conflict)))
                .count(),
            1
        );
        assert_eq!(
            first_runtime.list_summaries().await.unwrap()[0].revision,
            "2"
        );
    }

    #[tokio::test]
    async fn projects_lock_timeout_leaves_registry_intact() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let path = registry_path(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.register(&root, Some("Original")).await.unwrap();
        let before = std::fs::read(&path).unwrap();
        let lock = acquire_registry_lock(&path).unwrap();

        assert_eq!(
            acquire_registry_lock_with(&path, Duration::from_millis(50), |_| Ok(())).unwrap_err(),
            ProjectRegistryError::Storage
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        drop(lock);
        assert_eq!(runtime.list_summaries().await.unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn projects_retries_when_lock_path_is_replaced_before_acquire() {
        let temp = tempfile::tempdir().unwrap();
        let path = registry_path(&temp);
        let mut calls = 0;

        let lock = acquire_registry_lock_with(&path, Duration::from_secs(1), |lock_path| {
            calls += 1;
            if calls == 1 {
                std::fs::remove_file(lock_path).unwrap();
                std::fs::File::create(lock_path).unwrap();
            }
            Ok(())
        })
        .unwrap();

        assert_eq!(calls, 2);
        verify_open_regular_file(&path.with_file_name("registry.lock"), &lock).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn projects_symlinked_lock_file_is_rejected_without_registry_damage() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let path = registry_path(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.register(&root, Some("Original")).await.unwrap();
        let before = std::fs::read(&path).unwrap();
        let lock_path = path.with_file_name("registry.lock");
        std::fs::remove_file(&lock_path).unwrap();
        let outside = temp.path().join("outside-lock");
        std::fs::write(&outside, b"untouched").unwrap();
        std::os::unix::fs::symlink(&outside, &lock_path).unwrap();

        assert_eq!(
            runtime.list_summaries().await.unwrap_err(),
            ProjectRegistryError::Storage
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(std::fs::read(outside).unwrap(), b"untouched");
    }

    #[tokio::test]
    async fn projects_non_file_lock_is_rejected_without_registry_damage() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let path = registry_path(&temp);
        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.register(&root, Some("Original")).await.unwrap();
        let before = std::fs::read(&path).unwrap();
        let lock_path = path.with_file_name("registry.lock");
        std::fs::remove_file(&lock_path).unwrap();
        std::fs::create_dir(&lock_path).unwrap();

        assert_eq!(
            runtime.list_summaries().await.unwrap_err(),
            ProjectRegistryError::Storage
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[cfg(unix)]
    #[test]
    fn projects_transaction_revalidates_chain_after_caller_check() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let path = registry_path(&temp);
        let paths = paths_for_registry_path(&path);
        std::fs::create_dir_all(&paths.config_dir).unwrap();
        std::fs::create_dir_all(&paths.cache_dir).unwrap();
        validate_registry_storage_sync(&path, &paths.config_dir, &paths.cache_dir).unwrap();
        let redirected = paths.config_dir.clone();

        let error = registry_transaction_after(
            &path,
            &paths.config_dir,
            &paths.cache_dir,
            false,
            |_| Ok(()),
            || {
                std::fs::remove_dir(&redirected).unwrap();
                std::os::unix::fs::symlink(outside.path(), &redirected).unwrap();
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error, ProjectRegistryError::Storage);
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    }

    #[test]
    fn projects_first_directory_creation_syncs_each_existing_parent() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp
            .path()
            .join("missing-config")
            .join("projects")
            .join("registry.json");
        let mut synced = Vec::new();

        ensure_registry_directory_with_sync(&path, |parent| {
            synced.push(parent.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert_eq!(
            synced,
            vec![
                temp.path().to_path_buf(),
                temp.path().join("missing-config"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn projects_first_directory_creation_is_private_before_parent_sync() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config");
        let projects = config.join("projects");
        let path = projects.join("registry.json");
        let mut checked = Vec::new();

        ensure_registry_directory_with_sync(&path, |parent| {
            let child = if parent == temp.path() {
                config.as_path()
            } else {
                projects.as_path()
            };
            assert_eq!(
                std::fs::metadata(child).unwrap().permissions().mode() & 0o777,
                0o700
            );
            checked.push(child.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert_eq!(checked, vec![config, projects]);
    }

    #[test]
    fn projects_first_directory_creation_surfaces_unexpected_parent_sync_failure() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp
            .path()
            .join("config")
            .join("projects")
            .join("registry.json");

        assert_eq!(
            ensure_registry_directory_with_sync(&path, |_| Err(ProjectRegistryError::Storage)),
            Err(ProjectRegistryError::Storage)
        );
        assert!(!path.parent().unwrap().exists());
    }

    #[test]
    fn projects_unbound_and_unsupported_identity_policy_is_explicit() {
        let identity = RootIdentity {
            device: 7,
            inode: 11,
        };
        assert!(!binding_matches_current(RootBinding::Unbound, Some(None)));
        assert!(!binding_matches_current(
            RootBinding::Unbound,
            Some(Some(identity))
        ));
        assert!(binding_matches_current(
            RootBinding::Unsupported,
            Some(None)
        ));
        assert!(!binding_matches_current(
            RootBinding::Unsupported,
            Some(Some(identity))
        ));
    }

    #[test]
    fn projects_parent_directory_sync_failure_policy_is_explicit() {
        for kind in [
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::Unsupported,
            std::io::ErrorKind::InvalidInput,
        ] {
            assert!(ignorable_directory_sync_error(kind));
        }
        assert!(!ignorable_directory_sync_error(std::io::ErrorKind::Other));
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
        assert_eq!(migrated.status, ProjectStatus::Missing);
        assert!(!migrated.root_available);
        assert_eq!(
            runtime
                .get_active_private_entry(&project_id)
                .await
                .unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        assert_eq!(
            runtime
                .resolve_context(&paths_for_registry_path(&path), &project_id)
                .await
                .unwrap_err(),
            ProjectContextError::RootMissing
        );
        assert_eq!(
            runtime
                .mark_opened(&project_id, INITIAL_REVISION)
                .await
                .unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        assert_eq!(
            runtime.register(&root, Some("Rebind")).await.unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        let migrated_json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(migrated_json["version"], REGISTRY_VERSION);
        assert_eq!(
            migrated_json["projects"][0]["rootBinding"]["state"],
            "unbound"
        );

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
                        root_binding: readable_root_binding(&root).unwrap(),
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
    async fn projects_v2_migration_leaves_readable_root_unbound() {
        let temp = tempfile::tempdir().unwrap();
        let path = registry_path(&temp);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let project_id = new_project_id().unwrap();
        let created_at = timestamp_now();
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "revision": "7",
                "projects": [{
                    "projectId": project_id,
                    "displayName": "Readable",
                    "canonicalRoot": std::fs::canonicalize(&root).unwrap(),
                    "revision": "4",
                    "createdAt": created_at,
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
        assert!(!summary.root_available);
        assert_eq!(summary.revision, "4");
        assert_eq!(summary.created_at, created_at);
        assert_eq!(
            runtime.register(&root, Some("Rebind")).await.unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        let migrated: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(migrated["version"], REGISTRY_VERSION);
        assert_eq!(migrated["revision"], "7");
        assert_eq!(migrated["projects"][0]["rootBinding"]["state"], "unbound");
    }

    #[tokio::test]
    async fn projects_v3_null_identity_leaves_readable_root_unbound() {
        let temp = tempfile::tempdir().unwrap();
        let path = registry_path(&temp);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let project_id = new_project_id().unwrap();
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "version": 3,
                "revision": "9",
                "projects": [{
                    "projectId": project_id,
                    "displayName": "Ambiguous",
                    "canonicalRoot": std::fs::canonicalize(&root).unwrap(),
                    "revision": "6",
                    "createdAt": timestamp_now(),
                    "lastOpenedAt": null,
                    "archived": false,
                    "rootIdentity": null
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.load().await.unwrap();
        let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(summary.status, ProjectStatus::Missing);
        assert!(!summary.root_available);
        assert_eq!(
            runtime.register(&root, Some("Rebind")).await.unwrap_err(),
            ProjectRegistryError::RootUnavailable
        );
        let migrated: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(migrated["version"], REGISTRY_VERSION);
        assert_eq!(migrated["projects"][0]["rootBinding"]["state"], "unbound");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn projects_v3_concrete_identity_migrates_bound_and_available() {
        let temp = tempfile::tempdir().unwrap();
        let path = registry_path(&temp);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let identity = current_root_identity(&root).unwrap().unwrap();
        let project_id = new_project_id().unwrap();
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "version": 3,
                "revision": "9",
                "projects": [{
                    "projectId": project_id,
                    "displayName": "Bound",
                    "canonicalRoot": std::fs::canonicalize(&root).unwrap(),
                    "revision": "6",
                    "createdAt": timestamp_now(),
                    "lastOpenedAt": null,
                    "archived": false,
                    "rootIdentity": {
                        "device": identity.device,
                        "inode": identity.inode
                    }
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
        runtime.load().await.unwrap();
        let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(summary.status, ProjectStatus::Available);
        assert!(summary.root_available);
        assert!(runtime.get_active_private_entry(&project_id).await.is_ok());
        let migrated: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(migrated["projects"][0]["rootBinding"]["state"], "bound");
        assert_eq!(
            migrated["projects"][0]["rootBinding"]["device"],
            identity.device
        );
        assert_eq!(
            migrated["projects"][0]["rootBinding"]["inode"],
            identity.inode
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn projects_v1_and_v2_migration_do_not_bind_same_path_replacements() {
        for version in [1, 2] {
            let temp = tempfile::tempdir().unwrap();
            let path = registry_path(&temp);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let root = temp.path().join("root");
            let old_root = temp.path().join("old-root");
            std::fs::create_dir(&root).unwrap();
            let canonical_root = std::fs::canonicalize(&root).unwrap();
            let project_id = new_project_id().unwrap();
            let timestamp = timestamp_now();
            let registry = if version == 1 {
                serde_json::json!({
                    "version": 1,
                    "projects": [{
                        "projectId": project_id,
                        "displayName": "Legacy",
                        "canonicalRoot": canonical_root,
                        "createdAt": timestamp,
                        "lastOpenedAt": timestamp,
                        "archived": false
                    }]
                })
            } else {
                serde_json::json!({
                    "version": 2,
                    "revision": "8",
                    "projects": [{
                        "projectId": project_id,
                        "displayName": "Legacy",
                        "canonicalRoot": canonical_root,
                        "revision": "5",
                        "createdAt": timestamp,
                        "lastOpenedAt": null,
                        "archived": false
                    }]
                })
            };
            std::fs::write(&path, serde_json::to_vec(&registry).unwrap()).unwrap();
            std::fs::rename(&root, &old_root).unwrap();
            std::fs::create_dir(&root).unwrap();

            let runtime = ProjectRegistryRuntime::new(&paths_for_registry_path(&path));
            runtime.load().await.unwrap();
            let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
            assert_eq!(summary.status, ProjectStatus::Missing);
            assert!(!summary.root_available);
            assert_eq!(summary.project_id, project_id);
            assert_eq!(
                runtime
                    .register(&root, Some("Replacement"))
                    .await
                    .unwrap_err(),
                ProjectRegistryError::RootUnavailable
            );
            let migrated: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(migrated["projects"][0]["rootBinding"]["state"], "unbound");
        }
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

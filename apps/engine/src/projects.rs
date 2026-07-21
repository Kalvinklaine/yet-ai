use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use base64::Engine;
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

const REGISTRY_VERSION: u32 = 1;
const REGISTRY_MAX_BYTES: u64 = 2_000_000;
const REGISTRY_MAX_PROJECTS: usize = 10_000;
const DISPLAY_NAME_MAX_CHARS: usize = 120;
const PROJECT_ID_RANDOM_BYTES: usize = 16;
static TEMP_REGISTRY_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug)]
pub struct ProjectRegistryRuntime {
    registry_path: PathBuf,
    state: Arc<tokio::sync::Mutex<Option<ProjectRegistry>>>,
    #[cfg(test)]
    fail_writes: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project_id: String,
    pub display_name: String,
    pub status: ProjectStatus,
    pub created_at: String,
    pub last_opened_at: String,
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrivateProjectEntry {
    pub project_id: String,
    pub display_name: String,
    pub created_at: String,
    pub last_opened_at: String,
    pub archived: bool,
    canonical_root: PathBuf,
}

impl PrivateProjectEntry {
    pub fn canonical_root(&self) -> &Path {
        &self.canonical_root
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectRegistry {
    version: u32,
    projects: Vec<StoredProjectEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredProjectEntry {
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
    #[error("project registry limit reached")]
    LimitReached,
    #[error("project root is unavailable")]
    RootUnavailable,
    #[error("project registry storage unavailable")]
    Storage,
}

impl ProjectRegistryRuntime {
    pub fn new(registry_path: impl Into<PathBuf>) -> Self {
        Self {
            registry_path: registry_path.into(),
            state: Arc::new(tokio::sync::Mutex::new(None)),
            #[cfg(test)]
            fail_writes: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn registry_path(&self) -> &Path {
        &self.registry_path
    }

    pub async fn load(&self) -> Result<(), ProjectRegistryError> {
        let mut state = self.state.lock().await;
        *state = Some(load_registry(&self.registry_path).await?);
        Ok(())
    }

    pub async fn list_summaries(&self) -> Result<Vec<ProjectSummary>, ProjectRegistryError> {
        let mut state = self.state.lock().await;
        let registry = ensure_loaded(&self.registry_path, &mut state).await?;
        Ok(registry.projects.iter().map(project_summary).collect())
    }

    pub async fn get_private_entry(
        &self,
        project_id: &str,
    ) -> Result<PrivateProjectEntry, ProjectRegistryError> {
        validate_project_id(project_id)?;
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
        } else {
            Ok(entry)
        }
    }

    pub async fn register(
        &self,
        root: impl AsRef<Path>,
        display_name: Option<&str>,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        let canonical_root = canonical_directory(root.as_ref()).await?;
        let display_name = match display_name {
            Some(value) => validate_display_name(value)?.to_string(),
            None => default_display_name(&canonical_root),
        };
        let mut state = self.state.lock().await;
        let registry = ensure_loaded(&self.registry_path, &mut state).await?;
        let now = timestamp_now();
        let mut candidate = registry.clone();
        if let Some(entry) = candidate
            .projects
            .iter_mut()
            .find(|entry| entry.canonical_root == canonical_root)
        {
            entry.last_opened_at = now;
            let summary = project_summary(entry);
            self.persist(&candidate).await?;
            *registry = candidate;
            return Ok(summary);
        }
        if candidate.projects.len() >= REGISTRY_MAX_PROJECTS {
            return Err(ProjectRegistryError::LimitReached);
        }
        candidate.projects.push(StoredProjectEntry {
            project_id: unique_project_id(&candidate)?,
            display_name,
            canonical_root,
            created_at: now.clone(),
            last_opened_at: now,
            archived: false,
        });
        self.persist(&candidate).await?;
        let summary = project_summary(candidate.projects.last().expect("inserted project"));
        *registry = candidate;
        Ok(summary)
    }

    pub async fn update_display_name(
        &self,
        project_id: &str,
        display_name: &str,
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_project_id(project_id)?;
        let display_name = validate_display_name(display_name)?.to_string();
        self.mutate(project_id, move |entry| entry.display_name = display_name)
            .await
    }

    pub async fn archive(&self, project_id: &str) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_project_id(project_id)?;
        self.mutate(project_id, |entry| entry.archived = true).await
    }

    pub async fn restore(&self, project_id: &str) -> Result<ProjectSummary, ProjectRegistryError> {
        validate_project_id(project_id)?;
        self.mutate(project_id, |entry| entry.archived = false)
            .await
    }

    async fn mutate(
        &self,
        project_id: &str,
        change: impl FnOnce(&mut StoredProjectEntry),
    ) -> Result<ProjectSummary, ProjectRegistryError> {
        let mut state = self.state.lock().await;
        let registry = ensure_loaded(&self.registry_path, &mut state).await?;
        let mut candidate = registry.clone();
        let entry = candidate
            .projects
            .iter_mut()
            .find(|entry| entry.project_id == project_id)
            .ok_or(ProjectRegistryError::NotFound)?;
        change(entry);
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
        persist_registry(&self.registry_path, registry).await
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
        created_at: entry.created_at.clone(),
        last_opened_at: entry.last_opened_at.clone(),
        archived: entry.archived,
        canonical_root: entry.canonical_root.clone(),
    }
}

fn project_summary(entry: &StoredProjectEntry) -> ProjectSummary {
    let root_available = root_is_same(entry);
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
        created_at: entry.created_at.clone(),
        last_opened_at: entry.last_opened_at.clone(),
        root_available,
        cloud_required: false,
        provider_access: "direct".to_string(),
    }
}

fn root_is_same(entry: &StoredProjectEntry) -> bool {
    std::fs::canonicalize(&entry.canonical_root)
        .is_ok_and(|current| current == entry.canonical_root && current.is_dir())
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

fn validate_project_id(value: &str) -> Result<(), ProjectRegistryError> {
    if value.len() != 26 || !value.starts_with("prj_") {
        return Err(ProjectRegistryError::InvalidRequest);
    }
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&value[4..])
        .map_err(|_| ProjectRegistryError::InvalidRequest)?;
    if decoded.len() != PROJECT_ID_RANDOM_BYTES {
        return Err(ProjectRegistryError::InvalidRequest);
    }
    Ok(())
}

fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
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
    let registry: ProjectRegistry =
        serde_json::from_slice(&bytes).map_err(|_| ProjectRegistryError::Storage)?;
    validate_registry(&registry)?;
    Ok(registry)
}

fn validate_registry(registry: &ProjectRegistry) -> Result<(), ProjectRegistryError> {
    if registry.version != REGISTRY_VERSION || registry.projects.len() > REGISTRY_MAX_PROJECTS {
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
            || !valid_timestamp(&entry.created_at)
            || !valid_timestamp(&entry.last_opened_at)
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

    fn registry_path(temp: &tempfile::TempDir) -> PathBuf {
        temp.path()
            .join("config")
            .join("projects")
            .join("registry.json")
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
        let runtime = ProjectRegistryRuntime::new(registry_path(&temp));
        let created = runtime.register(&root, Some("Example")).await.unwrap();
        let json = serde_json::to_string(&created).unwrap();
        assert!(!json.contains("private-root-marker"));
        assert!(!json.contains("canonical"));

        let reloaded = ProjectRegistryRuntime::new(registry_path(&temp));
        reloaded.load().await.unwrap();
        let summaries = reloaded.list_summaries().await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].project_id, created.project_id);
        assert_eq!(
            reloaded
                .get_private_entry(&created.project_id)
                .await
                .unwrap()
                .canonical_root(),
            std::fs::canonicalize(root).unwrap()
        );
    }

    #[tokio::test]
    async fn projects_same_root_is_idempotent_distinct_roots_and_duplicate_labels_are_allowed() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        let runtime = ProjectRegistryRuntime::new(registry_path(&temp));
        let one = runtime
            .register(first.join("..").join("first"), Some("Same"))
            .await
            .unwrap();
        let again = runtime.register(&first, Some("Ignored")).await.unwrap();
        let two = runtime.register(&second, Some("Same")).await.unwrap();
        assert_eq!(one.project_id, again.project_id);
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
        let runtime = ProjectRegistryRuntime::new(registry_path(&temp));
        let linked = runtime.register(&link, Some("Linked")).await.unwrap();
        let direct = runtime.register(&target, Some("Direct")).await.unwrap();
        assert_eq!(linked.project_id, direct.project_id);
    }

    #[tokio::test]
    async fn projects_concurrent_same_root_registration_has_one_record() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let runtime = ProjectRegistryRuntime::new(registry_path(&temp));
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
        let runtime = ProjectRegistryRuntime::new(registry_path(&temp));
        let created = runtime.register(&root, Some("Lifecycle")).await.unwrap();
        assert_eq!(
            runtime.archive(&created.project_id).await.unwrap().status,
            ProjectStatus::Archived
        );
        assert_eq!(
            runtime
                .get_active_private_entry(&created.project_id)
                .await
                .unwrap_err(),
            ProjectRegistryError::Archived
        );
        assert_eq!(
            runtime.restore(&created.project_id).await.unwrap().status,
            ProjectStatus::Available
        );
        std::fs::remove_dir(&root).unwrap();
        let summary = runtime.list_summaries().await.unwrap().pop().unwrap();
        assert_eq!(summary.status, ProjectStatus::Missing);
        assert!(!summary.root_available);
    }

    #[tokio::test]
    async fn projects_corrupt_and_oversized_registry_fail_safely() {
        for content in [vec![b'{'], vec![b'x'; REGISTRY_MAX_BYTES as usize + 1]] {
            let temp = tempfile::tempdir().unwrap();
            let path = registry_path(&temp);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, content).unwrap();
            let runtime = ProjectRegistryRuntime::new(&path);
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
        let runtime = ProjectRegistryRuntime::new(&path);
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
        let escaped = ProjectRegistryRuntime::new(escaped_path);
        assert_eq!(
            escaped
                .register(&root, Some("No escape"))
                .await
                .unwrap_err(),
            ProjectRegistryError::Storage
        );
        assert!(std::fs::read_dir(outside).unwrap().next().is_none());
    }

    #[tokio::test]
    async fn projects_failed_write_leaves_memory_and_disk_unchanged() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        let path = registry_path(&temp);
        let runtime = ProjectRegistryRuntime::new(&path);
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
}

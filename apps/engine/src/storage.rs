use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::io::AsyncWriteExt;

use crate::identity::ProductIdentity;

static PRIVATE_WRITE_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AtomicPrivateWriteMode {
    Replace,
    CreateNew,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AtomicPrivateWriteOptions {
    pub max_bytes: usize,
    pub mode: AtomicPrivateWriteMode,
    pub parent_sync: AtomicPrivateParentSync,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AtomicPrivateParentSync {
    None,
    Strict,
    BestEffortUnsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AtomicPrivateWriteOutcome {
    Written,
    AlreadyExists,
}

pub(crate) async fn atomic_write_private_file(
    path: &Path,
    bytes: &[u8],
    options: AtomicPrivateWriteOptions,
) -> std::io::Result<AtomicPrivateWriteOutcome> {
    atomic_write_private_file_before_commit(path, bytes, options, || Ok(())).await
}

async fn atomic_write_private_file_before_commit(
    path: &Path,
    bytes: &[u8],
    options: AtomicPrivateWriteOptions,
    before_commit: impl FnOnce() -> std::io::Result<()>,
) -> std::io::Result<AtomicPrivateWriteOutcome> {
    if bytes.len() > options.max_bytes || path.parent().is_none() || path.file_name().is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid private file write",
        ));
    }
    let temp_path = unique_private_temp_path(path);
    let mut open_options = tokio::fs::OpenOptions::new();
    open_options.create_new(true).write(true);
    #[cfg(unix)]
    {
        tokio::fs::OpenOptions::mode(&mut open_options, 0o600);
    }
    let result = async {
        let mut file = open_options.open(&temp_path).await?;
        file.write_all(bytes).await?;
        file.sync_all().await?;
        set_private_file_permissions(file).await?;
        before_commit()?;
        reject_private_destination_symlink(path).await?;
        let outcome = match options.mode {
            AtomicPrivateWriteMode::Replace => {
                replace_file(&temp_path, path).await?;
                AtomicPrivateWriteOutcome::Written
            }
            AtomicPrivateWriteMode::CreateNew => match tokio::fs::hard_link(&temp_path, path).await
            {
                Ok(()) => AtomicPrivateWriteOutcome::Written,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    AtomicPrivateWriteOutcome::AlreadyExists
                }
                Err(error) => return Err(error),
            },
        };
        if outcome == AtomicPrivateWriteOutcome::Written {
            sync_private_parent_directory(path, options.parent_sync).await?;
        }
        Ok(outcome)
    }
    .await;
    let cleanup = cleanup_private_temp_file(&temp_path).await;
    match (result, cleanup) {
        (Ok(outcome), Ok(())) => Ok(outcome),
        (Err(error), Ok(())) => Err(error),
        (_, Err(error)) => Err(error),
    }
}

async fn reject_private_destination_symlink(path: &Path) -> std::io::Result<()> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "private file destination is a symlink",
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn unique_private_temp_path(path: &Path) -> PathBuf {
    let counter = PRIVATE_WRITE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("private.json");
    path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        counter
    ))
}

async fn cleanup_private_temp_file(path: &Path) -> std::io::Result<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(not(windows))]
async fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    tokio::fs::rename(source, destination).await
}

#[cfg(windows)]
async fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    tokio::task::spawn_blocking(move || {
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    })
    .await
    .map_err(std::io::Error::other)?
}

#[cfg(unix)]
async fn set_private_file_permissions(file: tokio::fs::File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let file = file.into_std().await;
    tokio::task::spawn_blocking(move || {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
    })
    .await
    .map_err(std::io::Error::other)?
}

#[cfg(not(unix))]
async fn set_private_file_permissions(file: tokio::fs::File) -> std::io::Result<()> {
    drop(file);
    Ok(())
}

#[cfg(unix)]
async fn sync_private_parent_directory(
    path: &Path,
    policy: AtomicPrivateParentSync,
) -> std::io::Result<()> {
    if policy == AtomicPrivateParentSync::None {
        return Ok(());
    }
    use std::os::unix::fs::OpenOptionsExt;

    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "private file has no parent",
        )
    })?;
    let parent = parent.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let directory = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(parent)?;
        match directory.sync_all() {
            Ok(()) => Ok(()),
            Err(error) if ignore_parent_sync_error(policy, &error) => Ok(()),
            Err(error) => Err(error),
        }
    })
    .await
    .map_err(std::io::Error::other)?
}

#[cfg(unix)]
fn unsupported_directory_sync_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::PermissionDenied
            | std::io::ErrorKind::Unsupported
            | std::io::ErrorKind::InvalidInput
    ) || error.raw_os_error() == Some(libc::EINVAL)
}

#[cfg(unix)]
fn ignore_parent_sync_error(policy: AtomicPrivateParentSync, error: &std::io::Error) -> bool {
    policy == AtomicPrivateParentSync::BestEffortUnsupported
        && unsupported_directory_sync_error(error)
}

#[cfg(not(unix))]
async fn sync_private_parent_directory(
    _path: &Path,
    _policy: AtomicPrivateParentSync,
) -> std::io::Result<()> {
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoragePaths {
    pub project_dir: PathBuf,
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectStoragePaths {
    pub config_root: PathBuf,
    pub cache_root: PathBuf,
    pub context_cache: PathBuf,
    pub turn_context: PathBuf,
    pub chat_history: PathBuf,
    pub project_memory: PathBuf,
    pub agent_progress: PathBuf,
    pub controlled_runs: PathBuf,
}

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
#[error("project storage unavailable")]
pub struct ProjectStorageError;

impl StoragePaths {
    pub fn project_registry_path(&self) -> PathBuf {
        self.config_dir.join("projects").join("registry.json")
    }

    pub fn project_config_root(&self, project_id: &str) -> Option<PathBuf> {
        valid_project_id(project_id).then(|| self.config_dir.join("projects").join(project_id))
    }

    pub fn project_cache_root(&self, project_id: &str) -> Option<PathBuf> {
        valid_project_id(project_id).then(|| self.cache_dir.join("projects").join(project_id))
    }

    pub fn project_storage_paths(
        &self,
        project_id: &str,
    ) -> Result<ProjectStoragePaths, ProjectStorageError> {
        if !valid_project_id(project_id) {
            return Err(ProjectStorageError);
        }
        let config_projects = self.config_dir.join("projects");
        let cache_projects = self.cache_dir.join("projects");
        let config_root = config_projects.join(project_id);
        let cache_root = cache_projects.join(project_id);
        validate_namespace(&self.config_dir, &config_projects, &config_root)?;
        validate_namespace(&self.cache_dir, &cache_projects, &cache_root)?;
        Ok(ProjectStoragePaths {
            context_cache: cache_root.join("context"),
            turn_context: config_root.join("turn-context"),
            chat_history: config_root.join("chat-history"),
            project_memory: config_root.join("project-memory"),
            agent_progress: cache_root.join("agent-progress"),
            controlled_runs: cache_root.join("controlled-runs"),
            config_root,
            cache_root,
        })
    }
}

fn valid_project_id(value: &str) -> bool {
    crate::projects::is_valid_project_id(value)
}

fn validate_namespace(
    trusted_root: &Path,
    parent: &Path,
    namespace: &Path,
) -> Result<(), ProjectStorageError> {
    if namespace.parent() != Some(parent) || !namespace.starts_with(parent) {
        return Err(ProjectStorageError);
    }
    validate_storage_chain(trusted_root)?;
    validate_storage_chain(namespace)
}

pub(crate) fn validate_storage_chain(path: &Path) -> Result<(), ProjectStorageError> {
    if !path.is_absolute() {
        return Err(ProjectStorageError);
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if matches!(component, std::path::Component::RootDir) {
            let canonical = std::fs::canonicalize(&current).map_err(|_| ProjectStorageError)?;
            if canonical != current {
                current = canonical;
            }
            continue;
        }
        match std::fs::symlink_metadata(&current) {
            Ok(metadata)
                if metadata.file_type().is_symlink() && !is_platform_root_alias(&current) =>
            {
                return Err(ProjectStorageError);
            }
            Ok(metadata) if metadata.file_type().is_symlink() => {}
            Ok(metadata) if !metadata.is_dir() => return Err(ProjectStorageError),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err(ProjectStorageError),
        }
    }
    Ok(())
}

pub(crate) async fn ensure_store_namespace(
    root: &Path,
    create: bool,
) -> Result<bool, ProjectStorageError> {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || ensure_store_namespace_sync(&root, create))
        .await
        .map_err(|_| ProjectStorageError)?
}

pub(crate) fn ensure_store_namespace_sync(
    root: &Path,
    create: bool,
) -> Result<bool, ProjectStorageError> {
    if !root.is_absolute() {
        return Err(ProjectStorageError);
    }
    let parent = root.parent().ok_or(ProjectStorageError)?;
    let trusted_root = if parent
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == "projects")
    {
        parent
            .parent()
            .and_then(Path::parent)
            .ok_or(ProjectStorageError)?
    } else {
        parent
    };
    if !root.starts_with(trusted_root) || root == trusted_root {
        return Err(ProjectStorageError);
    }
    validate_storage_chain(trusted_root)?;
    if create {
        create_missing_directory_chain(trusted_root)?;
    }
    let mut current = trusted_root.to_path_buf();
    let relative = root
        .strip_prefix(trusted_root)
        .map_err(|_| ProjectStorageError)?;
    if !ensure_directory_component(&current, create)? {
        return Ok(false);
    }
    for component in relative.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err(ProjectStorageError);
        }
        current.push(component.as_os_str());
        if !ensure_directory_component(&current, create)? {
            return Ok(false);
        }
    }
    validate_storage_chain(root)?;
    Ok(true)
}

fn create_missing_directory_chain(path: &Path) -> Result<(), ProjectStorageError> {
    let mut existing = path;
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(existing) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(ProjectStorageError);
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(existing.to_path_buf());
                existing = existing.parent().ok_or(ProjectStorageError)?;
            }
            Err(_) => return Err(ProjectStorageError),
        }
    }
    for directory in missing.into_iter().rev() {
        ensure_directory_component(&directory, true)?;
    }
    validate_storage_chain(path)
}

fn ensure_directory_component(path: &Path, create: bool) -> Result<bool, ProjectStorageError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(ProjectStorageError);
            }
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match std::fs::create_dir(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(ProjectStorageError),
            }
            let metadata = std::fs::symlink_metadata(path).map_err(|_| ProjectStorageError)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(ProjectStorageError);
            }
            set_private_store_directory(path)?;
            Ok(true)
        }
        Err(_) => Err(ProjectStorageError),
    }
}

#[cfg(unix)]
fn set_private_store_directory(path: &Path) -> Result<(), ProjectStorageError> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let directory = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| ProjectStorageError)?;
    directory
        .set_permissions(std::fs::Permissions::from_mode(0o700))
        .map_err(|_| ProjectStorageError)
}

#[cfg(not(unix))]
fn set_private_store_directory(_path: &Path) -> Result<(), ProjectStorageError> {
    Ok(())
}

pub(crate) fn canonical_storage_boundary(path: &Path) -> Result<PathBuf, ProjectStorageError> {
    validate_storage_chain(path)?;
    let mut existing = path;
    let mut missing = Vec::new();
    while !existing.exists() {
        missing.push(existing.file_name().ok_or(ProjectStorageError)?.to_owned());
        existing = existing.parent().ok_or(ProjectStorageError)?;
    }
    let metadata = std::fs::symlink_metadata(existing).map_err(|_| ProjectStorageError)?;
    if !metadata.is_dir()
        || (metadata.file_type().is_symlink() && !is_platform_root_alias(existing))
    {
        return Err(ProjectStorageError);
    }
    let mut canonical = std::fs::canonicalize(existing).map_err(|_| ProjectStorageError)?;
    for component in missing.iter().rev() {
        canonical.push(component);
    }
    Ok(canonical)
}

fn is_platform_root_alias(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        path == Path::new("/var")
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        false
    }
}

pub fn resolve_storage_paths(
    identity: &ProductIdentity,
    project_root: &Path,
    config_root: &Path,
    cache_root: &Path,
) -> StoragePaths {
    StoragePaths {
        project_dir: project_root.join(&identity.storage.project_dir),
        config_dir: config_root.join(&identity.storage.config_dir),
        cache_dir: cache_root.join(&identity.storage.cache_dir),
    }
}

pub fn resolve_default_storage_paths(
    identity: &ProductIdentity,
    project_root: &Path,
) -> StoragePaths {
    let config_root = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let cache_root = dirs::cache_dir().unwrap_or_else(|| PathBuf::from("."));
    resolve_storage_paths(identity, project_root, &config_root, &cache_root)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use crate::identity::ProductIdentity;

    use super::{
        atomic_write_private_file, atomic_write_private_file_before_commit, resolve_storage_paths,
        AtomicPrivateParentSync, AtomicPrivateWriteMode, AtomicPrivateWriteOptions,
        AtomicPrivateWriteOutcome,
    };

    fn write_options(mode: AtomicPrivateWriteMode) -> AtomicPrivateWriteOptions {
        AtomicPrivateWriteOptions {
            max_bytes: 16,
            mode,
            parent_sync: AtomicPrivateParentSync::BestEffortUnsupported,
        }
    }

    fn temp_files(parent: &Path) -> Vec<std::path::PathBuf> {
        std::fs::read_dir(parent)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .map(|entry| entry.path())
            .collect()
    }

    #[tokio::test]
    async fn atomic_private_writer_replaces_and_create_new_preserves_existing() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        assert_eq!(
            atomic_write_private_file(
                &path,
                br#"{"value":1}"#,
                write_options(AtomicPrivateWriteMode::Replace),
            )
            .await
            .unwrap(),
            AtomicPrivateWriteOutcome::Written
        );
        assert_eq!(
            atomic_write_private_file(
                &path,
                br#"{"value":2}"#,
                write_options(AtomicPrivateWriteMode::CreateNew),
            )
            .await
            .unwrap(),
            AtomicPrivateWriteOutcome::AlreadyExists
        );
        assert_eq!(std::fs::read(&path).unwrap(), br#"{"value":1}"#);
        assert!(temp_files(temp.path()).is_empty());
    }

    #[tokio::test]
    async fn atomic_private_writer_concurrent_create_new_has_one_winner() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        let first = atomic_write_private_file(
            &path,
            b"first",
            write_options(AtomicPrivateWriteMode::CreateNew),
        );
        let second = atomic_write_private_file(
            &path,
            b"second",
            write_options(AtomicPrivateWriteMode::CreateNew),
        );
        let (first, second) = tokio::join!(first, second);
        let outcomes = [first.unwrap(), second.unwrap()];
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| **outcome == AtomicPrivateWriteOutcome::Written)
                .count(),
            1
        );
        assert!(matches!(
            std::fs::read(&path).unwrap().as_slice(),
            b"first" | b"second"
        ));
        assert!(temp_files(temp.path()).is_empty());
    }

    #[tokio::test]
    async fn atomic_private_writer_concurrent_replace_leaves_complete_payload() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        let first = atomic_write_private_file(
            &path,
            b"first",
            write_options(AtomicPrivateWriteMode::Replace),
        );
        let second = atomic_write_private_file(
            &path,
            b"second",
            write_options(AtomicPrivateWriteMode::Replace),
        );
        let (first, second) = tokio::join!(first, second);
        assert_eq!(first.unwrap(), AtomicPrivateWriteOutcome::Written);
        assert_eq!(second.unwrap(), AtomicPrivateWriteOutcome::Written);
        assert!(matches!(
            std::fs::read(&path).unwrap().as_slice(),
            b"first" | b"second"
        ));
        assert!(temp_files(temp.path()).is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn atomic_private_writer_rejects_rename_time_destination_symlink_injection() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        let target = outside.path().join("outside.json");
        std::fs::write(&target, "outside").unwrap();
        let injected_path = path.clone();
        let injected_target = target.clone();
        assert!(atomic_write_private_file_before_commit(
            &path,
            b"private",
            write_options(AtomicPrivateWriteMode::Replace),
            move || std::os::unix::fs::symlink(injected_target, injected_path),
        )
        .await
        .is_err());

        assert_eq!(std::fs::read_to_string(target).unwrap(), "outside");
        assert!(std::fs::symlink_metadata(path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(temp_files(temp.path()).is_empty());
    }

    #[test]
    fn atomic_private_parent_sync_policies_are_distinct() {
        assert_ne!(
            AtomicPrivateParentSync::None,
            AtomicPrivateParentSync::Strict
        );
        assert_ne!(
            AtomicPrivateParentSync::Strict,
            AtomicPrivateParentSync::BestEffortUnsupported
        );
        let unsupported = std::io::Error::new(std::io::ErrorKind::Unsupported, "unsupported");
        let other = std::io::Error::new(std::io::ErrorKind::Other, "failed");
        assert!(super::ignore_parent_sync_error(
            AtomicPrivateParentSync::BestEffortUnsupported,
            &unsupported
        ));
        assert!(!super::ignore_parent_sync_error(
            AtomicPrivateParentSync::Strict,
            &unsupported
        ));
        assert!(!super::ignore_parent_sync_error(
            AtomicPrivateParentSync::None,
            &unsupported
        ));
        assert!(!super::ignore_parent_sync_error(
            AtomicPrivateParentSync::BestEffortUnsupported,
            &other
        ));
    }

    #[tokio::test]
    async fn atomic_private_writer_rejects_oversize_without_temp_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        let error = atomic_write_private_file(
            &path,
            b"seventeen-bytes!!!",
            write_options(AtomicPrivateWriteMode::Replace),
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert!(!path.exists());
        assert!(temp_files(temp.path()).is_empty());
    }

    #[tokio::test]
    async fn atomic_private_writer_cleans_temp_after_commit_failure() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("destination");
        std::fs::create_dir(&destination).unwrap();
        assert!(atomic_write_private_file(
            &destination,
            b"private",
            write_options(AtomicPrivateWriteMode::Replace),
        )
        .await
        .is_err());
        assert!(destination.is_dir());
        assert!(temp_files(temp.path()).is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn atomic_private_writer_sets_private_file_mode() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        atomic_write_private_file(
            &path,
            b"private",
            write_options(AtomicPrivateWriteMode::Replace),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::symlink_metadata(path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[test]
    fn resolver_uses_identity_storage_names() {
        let identity = ProductIdentity::load().unwrap();
        let paths = resolve_storage_paths(
            &identity,
            Path::new("/workspace"),
            Path::new("/config"),
            Path::new("/cache"),
        );
        assert_eq!(paths.project_dir, Path::new("/workspace/.yet-ai"));
        assert_eq!(paths.config_dir, Path::new("/config/yet-ai"));
        assert_eq!(paths.cache_dir, Path::new("/cache/yet-ai"));
        assert_eq!(
            paths.project_registry_path(),
            Path::new("/config/yet-ai/projects/registry.json")
        );
        assert_eq!(
            paths.project_config_root("prj_AAAAAAAAAAAAAAAAAAAAAA"),
            Some(Path::new("/config/yet-ai/projects/prj_AAAAAAAAAAAAAAAAAAAAAA").to_path_buf())
        );
        assert!(paths.project_cache_root("../unsafe").is_none());
    }

    #[test]
    fn storage_project_namespaces_are_confined_and_disjoint() {
        let temp = tempfile::tempdir().unwrap();
        let identity = ProductIdentity::load().unwrap();
        let paths = resolve_storage_paths(
            &identity,
            &temp.path().join("workspace"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        let first = paths
            .project_storage_paths("prj_AAAAAAAAAAAAAAAAAAAAAA")
            .unwrap();
        let second = paths
            .project_storage_paths("prj_AQAAAAAAAAAAAAAAAAAAAA")
            .unwrap();
        assert_ne!(first.config_root, second.config_root);
        assert_ne!(first.cache_root, second.cache_root);
        assert_eq!(first.chat_history, first.config_root.join("chat-history"));
        assert_eq!(first.context_cache, first.cache_root.join("context"));
        assert_eq!(first.turn_context, first.config_root.join("turn-context"));
        assert_eq!(
            first.project_memory,
            first.config_root.join("project-memory")
        );
        assert_eq!(
            first.agent_progress,
            first.cache_root.join("agent-progress")
        );
        assert_eq!(
            first.controlled_runs,
            first.cache_root.join("controlled-runs")
        );
        assert_eq!(
            first.config_root.parent(),
            Some(paths.config_dir.join("projects").as_path())
        );
        assert_eq!(
            first.cache_root.parent(),
            Some(paths.cache_dir.join("projects").as_path())
        );
        assert!(paths.project_storage_paths("../unsafe").is_err());
        assert!(paths
            .project_storage_paths("prj_abcdefghijklmnopqrstu/")
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn storage_project_namespace_symlinks_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let identity = ProductIdentity::load().unwrap();
        let paths = resolve_storage_paths(
            &identity,
            &temp.path().join("workspace"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        std::fs::create_dir_all(paths.config_dir.join("projects")).unwrap();
        std::os::unix::fs::symlink(
            outside.path(),
            paths.config_dir.join("projects/prj_AAAAAAAAAAAAAAAAAAAAAA"),
        )
        .unwrap();
        assert!(paths
            .project_storage_paths("prj_AAAAAAAAAAAAAAAAAAAAAA")
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn storage_config_cache_and_ancestor_symlinks_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let identity = ProductIdentity::load().unwrap();
        for target in ["config", "cache"] {
            let base = temp.path().join(target);
            std::os::unix::fs::symlink(outside.path(), &base).unwrap();
            let paths = resolve_storage_paths(
                &identity,
                &temp.path().join("workspace"),
                &temp.path().join("config"),
                &temp.path().join("cache"),
            );
            assert!(paths
                .project_storage_paths("prj_AAAAAAAAAAAAAAAAAAAAAA")
                .is_err());
            std::fs::remove_file(base).unwrap();
        }

        let redirected = temp.path().join("redirected");
        std::os::unix::fs::symlink(outside.path(), &redirected).unwrap();
        let paths = resolve_storage_paths(
            &identity,
            &temp.path().join("workspace"),
            &redirected.join("config"),
            &temp.path().join("cache"),
        );
        assert!(paths
            .project_storage_paths("prj_AAAAAAAAAAAAAAAAAAAAAA")
            .is_err());
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn storage_allows_only_the_macos_var_platform_alias() {
        assert!(super::validate_storage_chain(Path::new("/var/folders")).is_ok());
        assert!(super::validate_storage_chain(Path::new("/private/var/folders")).is_ok());
    }
}

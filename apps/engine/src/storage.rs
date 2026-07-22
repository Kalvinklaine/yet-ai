use std::path::{Path, PathBuf};

use crate::identity::ProductIdentity;

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

fn ensure_store_namespace_sync(root: &Path, create: bool) -> Result<bool, ProjectStorageError> {
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

    use super::resolve_storage_paths;

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

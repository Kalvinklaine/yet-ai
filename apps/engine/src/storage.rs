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
        validate_namespace(&config_projects, &config_root)?;
        validate_namespace(&cache_projects, &cache_root)?;
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

fn validate_namespace(parent: &Path, namespace: &Path) -> Result<(), ProjectStorageError> {
    if namespace.parent() != Some(parent) || !namespace.starts_with(parent) {
        return Err(ProjectStorageError);
    }
    reject_existing_ancestor_symlinks(namespace)
}

fn reject_existing_ancestor_symlinks(path: &Path) -> Result<(), ProjectStorageError> {
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
}

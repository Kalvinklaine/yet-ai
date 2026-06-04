use std::path::{Path, PathBuf};

use crate::identity::ProductIdentity;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoragePaths {
    pub project_dir: PathBuf,
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
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
    }
}

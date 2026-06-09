use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

static TEMP_DEMO_MODE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub const DEMO_PROVIDER_ID: &str = "yet-demo";
pub const DEMO_MODEL_ID: &str = "yet-demo-chat";
pub const DEMO_DISPLAY_NAME: &str = "Yet AI Demo Mode";
pub const DEMO_MODEL_DISPLAY_NAME: &str = "Yet AI Demo Chat";
pub const DEMO_MESSAGE: &str = "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality. Configure a BYOK provider for real answers.";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoModeState {
    pub enabled: bool,
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub cloud_required: bool,
    pub provider_access: String,
    pub message: String,
}

impl DemoModeState {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            provider_id: DEMO_PROVIDER_ID.to_string(),
            model_id: DEMO_MODEL_ID.to_string(),
            display_name: DEMO_DISPLAY_NAME.to_string(),
            cloud_required: false,
            provider_access: "direct".to_string(),
            message: DEMO_MESSAGE.to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoModeWriteRequest {
    pub enabled: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum DemoModeError {
    #[error("demo mode storage error")]
    Storage,
}

impl DemoModeError {
    pub fn status(&self) -> http::StatusCode {
        http::StatusCode::INTERNAL_SERVER_ERROR
    }
}

pub fn demo_mode_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("demo-mode.json")
}

pub async fn get(config_dir: &Path) -> Result<DemoModeState, DemoModeError> {
    let path = demo_mode_path(config_dir);
    if !ensure_existing_demo_mode_directory(&path).await? {
        return Ok(DemoModeState::new(false));
    }
    reject_demo_mode_file_symlink(&path).await?;
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => {
            let persisted: PersistedDemoModeState =
                serde_json::from_str(&content).map_err(|_| DemoModeError::Storage)?;
            Ok(DemoModeState::new(persisted.enabled))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DemoModeState::new(false)),
        Err(_) => Err(DemoModeError::Storage),
    }
}

pub async fn set(config_dir: &Path, enabled: bool) -> Result<DemoModeState, DemoModeError> {
    let path = demo_mode_path(config_dir);
    ensure_demo_mode_directory(&path).await?;
    reject_demo_mode_file_symlink(&path).await?;
    let content = serde_json::to_vec_pretty(&PersistedDemoModeState { enabled })
        .map_err(|_| DemoModeError::Storage)?;
    atomic_write_demo_mode(&path, &content).await?;
    Ok(DemoModeState::new(enabled))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDemoModeState {
    enabled: bool,
}

async fn ensure_existing_demo_mode_directory(path: &Path) -> Result<bool, DemoModeError> {
    let dir = path.parent().ok_or(DemoModeError::Storage)?;
    reject_existing_ancestor_symlinks(dir).await?;
    match tokio::fs::symlink_metadata(dir).await {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(DemoModeError::Storage);
            }
            set_private_directory_permissions(dir).await?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(DemoModeError::Storage),
    }
}

async fn ensure_demo_mode_directory(path: &Path) -> Result<(), DemoModeError> {
    let dir = path.parent().ok_or(DemoModeError::Storage)?;
    reject_existing_ancestor_symlinks(dir).await?;
    match tokio::fs::symlink_metadata(dir).await {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(DemoModeError::Storage);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(DemoModeError::Storage),
    }
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|_| DemoModeError::Storage)?;
    let metadata = tokio::fs::symlink_metadata(dir)
        .await
        .map_err(|_| DemoModeError::Storage)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(DemoModeError::Storage);
    }
    reject_existing_ancestor_symlinks(dir).await?;
    set_private_directory_permissions(dir).await
}

async fn reject_existing_ancestor_symlinks(path: &Path) -> Result<(), DemoModeError> {
    let mut current = PathBuf::new();
    let mut components = path.components().peekable();
    while let Some(component) = components.next() {
        current.push(component.as_os_str());
        if matches!(component, std::path::Component::RootDir) {
            let canonical_root =
                std::fs::canonicalize(&current).map_err(|_| DemoModeError::Storage)?;
            if canonical_root != current {
                current = canonical_root;
            }
            continue;
        }
        match tokio::fs::symlink_metadata(&current).await {
            Ok(metadata)
                if metadata.file_type().is_symlink() && !is_platform_root_alias(&current) =>
            {
                return Err(DemoModeError::Storage);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err(DemoModeError::Storage),
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

async fn reject_demo_mode_file_symlink(path: &Path) -> Result<(), DemoModeError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(DemoModeError::Storage),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(DemoModeError::Storage),
    }
}

async fn atomic_write_demo_mode(path: &Path, bytes: &[u8]) -> Result<(), DemoModeError> {
    let temp_path = temp_demo_mode_path(path);
    reject_demo_mode_file_symlink(&temp_path).await?;
    let mut options = tokio::fs::OpenOptions::new();
    options.create_new(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    let result = async {
        let mut file = options
            .open(&temp_path)
            .await
            .map_err(|_| DemoModeError::Storage)?;
        file.write_all(bytes)
            .await
            .map_err(|_| DemoModeError::Storage)?;
        file.sync_all().await.map_err(|_| DemoModeError::Storage)?;
        set_private_permissions_for_open_file(file).await?;
        reject_demo_mode_file_symlink(path).await?;
        tokio::fs::rename(&temp_path, path)
            .await
            .map_err(|_| DemoModeError::Storage)?;
        set_private_permissions(path).await?;
        sync_parent_directory(path).await
    }
    .await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => {
            cleanup_demo_mode_temp_file(&temp_path).await?;
            Err(error)
        }
    }
}

fn temp_demo_mode_path(path: &Path) -> PathBuf {
    let counter = TEMP_DEMO_MODE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("demo-mode.json");
    path.with_file_name(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        counter
    ))
}

async fn cleanup_demo_mode_temp_file(path: &Path) -> Result<(), DemoModeError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(DemoModeError::Storage),
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
async fn set_private_permissions_for_open_file(file: tokio::fs::File) -> Result<(), DemoModeError> {
    use std::os::unix::fs::PermissionsExt;

    let file = file.into_std().await;
    tokio::task::spawn_blocking(move || {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| DemoModeError::Storage)
    })
    .await
    .map_err(|_| DemoModeError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions_for_open_file(file: tokio::fs::File) -> Result<(), DemoModeError> {
    drop(file);
    Ok(())
}

#[cfg(unix)]
async fn set_private_permissions(path: &Path) -> Result<(), DemoModeError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = open_file_no_follow(&path).map_err(|_| DemoModeError::Storage)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| DemoModeError::Storage)
    })
    .await
    .map_err(|_| DemoModeError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_permissions(_path: &Path) -> Result<(), DemoModeError> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_directory_permissions(path: &Path) -> Result<(), DemoModeError> {
    use std::os::unix::fs::PermissionsExt;
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let directory = open_directory_no_follow(&path).map_err(|_| DemoModeError::Storage)?;
        directory
            .set_permissions(std::fs::Permissions::from_mode(0o700))
            .map_err(|_| DemoModeError::Storage)
    })
    .await
    .map_err(|_| DemoModeError::Storage)?
}

#[cfg(not(unix))]
async fn set_private_directory_permissions(_path: &Path) -> Result<(), DemoModeError> {
    Ok(())
}

#[cfg(unix)]
async fn sync_parent_directory(path: &Path) -> Result<(), DemoModeError> {
    let dir = path.parent().ok_or(DemoModeError::Storage)?.to_path_buf();
    tokio::task::spawn_blocking(move || {
        match open_directory_no_follow(&dir).and_then(|directory| directory.sync_all()) {
            Ok(()) => Ok(()),
            Err(error) if is_unsupported_directory_sync_error(&error) => Ok(()),
            Err(_) => Err(DemoModeError::Storage),
        }
    })
    .await
    .map_err(|_| DemoModeError::Storage)?
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
async fn sync_parent_directory(_path: &Path) -> Result<(), DemoModeError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    static TEST_DIR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "yet-ai-demo-mode-test-{}-{}",
            std::process::id(),
            TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn demo_mode_rejects_config_dir_symlink_escape() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, &dir).unwrap();

        assert!(matches!(
            super::set(&dir, true).await,
            Err(super::DemoModeError::Storage)
        ));
        assert!(!outside.join("demo-mode.json").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn demo_mode_rejects_symlinked_config_dir_ancestor_escape() {
        let root = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let config_dir = root.join("link").join("config");

        assert!(matches!(
            super::set(&config_dir, true).await,
            Err(super::DemoModeError::Storage)
        ));
        assert!(!outside.join("config").join("demo-mode.json").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn demo_mode_rejects_final_file_symlink_escape() {
        let dir = temp_dir();
        let outside = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("outside-demo-mode.json");
        std::fs::write(&target, "outside").unwrap();
        std::os::unix::fs::symlink(&target, super::demo_mode_path(&dir)).unwrap();

        assert!(matches!(
            super::set(&dir, true).await,
            Err(super::DemoModeError::Storage)
        ));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "outside");
    }
}

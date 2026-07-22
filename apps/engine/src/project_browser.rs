use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;

use crate::projects::{ProjectRegistryError, ProjectRegistryRuntime, ProjectSummary};

const SESSION_TTL: Duration = Duration::from_secs(300);
const MAX_SESSIONS: usize = 16;
const MAX_DEPTH: u8 = 8;
const MAX_ENTRIES: usize = 200;
const MAX_HANDLES: usize = 1_000;

#[derive(Clone)]
pub struct ProjectBrowserRuntime {
    home: Option<PathBuf>,
    sessions: Arc<tokio::sync::Mutex<HashMap<String, DiscoverySession>>>,
}

struct DiscoverySession {
    expires: Instant,
    expires_at: String,
    handles: HashMap<String, DirectoryTarget>,
}

#[derive(Clone)]
struct DirectoryTarget {
    path: PathBuf,
    depth: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub handle: String,
    pub display_name: String,
    pub selectable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverySessionResponse {
    pub session_id: String,
    pub expires_at: String,
    pub root: DirectoryEntry,
    pub cloud_required: bool,
    pub provider_access: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListResponse {
    pub session_id: String,
    pub directory_handle: String,
    pub expires_at: String,
    pub entries: Vec<DirectoryEntry>,
    pub cloud_required: bool,
    pub provider_access: &'static str,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProjectBrowserError {
    #[error("invalid discovery request")]
    InvalidRequest,
    #[error("directory discovery expired")]
    DiscoveryExpired,
    #[error("directory is outside the allowed root")]
    OutsideAllowedRoot,
    #[error("directory is unavailable")]
    UnsafeFilesystem,
    #[error("directory discovery limit reached")]
    LimitReached,
    #[error("project registration failed")]
    Registry(ProjectRegistryError),
}

impl ProjectBrowserRuntime {
    pub fn new() -> Self {
        Self::with_home(dirs::home_dir())
    }

    pub fn with_home(home: Option<PathBuf>) -> Self {
        let home = home.and_then(|path| canonical_readable_directory(&path).ok());
        Self {
            home,
            sessions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }

    pub async fn create_session(&self) -> Result<DiscoverySessionResponse, ProjectBrowserError> {
        let home = self
            .home
            .clone()
            .ok_or(ProjectBrowserError::UnsafeFilesystem)?;
        let mut sessions = self.sessions.lock().await;
        remove_expired(&mut sessions);
        if sessions.len() >= MAX_SESSIONS {
            return Err(ProjectBrowserError::LimitReached);
        }
        let session_id = unique_id("pds_", sessions.keys())?;
        let root_handle = random_id("dir_")?;
        let expires_at = (Utc::now() + chrono::Duration::from_std(SESSION_TTL).unwrap())
            .to_rfc3339_opts(SecondsFormat::Micros, true);
        let mut handles = HashMap::new();
        handles.insert(
            root_handle.clone(),
            DirectoryTarget {
                path: home.clone(),
                depth: 0,
            },
        );
        sessions.insert(
            session_id.clone(),
            DiscoverySession {
                expires: Instant::now() + SESSION_TTL,
                expires_at: expires_at.clone(),
                handles,
            },
        );
        Ok(DiscoverySessionResponse {
            session_id,
            expires_at,
            root: DirectoryEntry {
                handle: root_handle,
                display_name: safe_basename(&home),
                selectable: true,
            },
            cloud_required: false,
            provider_access: "direct",
        })
    }

    pub async fn list(
        &self,
        session_id: &str,
        directory_handle: &str,
    ) -> Result<DirectoryListResponse, ProjectBrowserError> {
        validate_id(session_id, "pds_")?;
        validate_id(directory_handle, "dir_")?;
        let home = self
            .home
            .as_deref()
            .ok_or(ProjectBrowserError::UnsafeFilesystem)?;
        let mut sessions = self.sessions.lock().await;
        remove_expired(&mut sessions);
        let session = sessions
            .get_mut(session_id)
            .ok_or(ProjectBrowserError::DiscoveryExpired)?;
        let target = session
            .handles
            .get(directory_handle)
            .cloned()
            .ok_or(ProjectBrowserError::DiscoveryExpired)?;
        let current = canonical_readable_directory(&target.path)?;
        ensure_confined(home, &current)?;
        if target.depth >= MAX_DEPTH {
            return Err(ProjectBrowserError::LimitReached);
        }
        let mut children = Vec::new();
        let entries =
            std::fs::read_dir(&current).map_err(|_| ProjectBrowserError::UnsafeFilesystem)?;
        for entry in entries {
            let entry = entry.map_err(|_| ProjectBrowserError::UnsafeFilesystem)?;
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if !safe_label(&name) || name.starts_with('.') {
                continue;
            }
            let Ok(path) = canonical_readable_directory(&entry.path()) else {
                continue;
            };
            if ensure_confined(home, &path).is_err() {
                continue;
            }
            children.push((name, path));
            if children.len() > MAX_ENTRIES {
                return Err(ProjectBrowserError::LimitReached);
            }
        }
        children.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));
        if session.handles.len() + children.len() > MAX_HANDLES {
            return Err(ProjectBrowserError::LimitReached);
        }
        let mut response_entries = Vec::with_capacity(children.len());
        for (display_name, path) in children {
            let handle = loop {
                let candidate = random_id("dir_")?;
                if !session.handles.contains_key(&candidate) {
                    break candidate;
                }
            };
            session.handles.insert(
                handle.clone(),
                DirectoryTarget {
                    path,
                    depth: target.depth + 1,
                },
            );
            response_entries.push(DirectoryEntry {
                handle,
                display_name,
                selectable: true,
            });
        }
        Ok(DirectoryListResponse {
            session_id: session_id.to_string(),
            directory_handle: directory_handle.to_string(),
            expires_at: session.expires_at.clone(),
            entries: response_entries,
            cloud_required: false,
            provider_access: "direct",
        })
    }

    pub async fn register(
        &self,
        registry: &ProjectRegistryRuntime,
        session_id: &str,
        directory_handle: &str,
        display_name: &str,
    ) -> Result<ProjectSummary, ProjectBrowserError> {
        validate_id(session_id, "pds_")?;
        validate_id(directory_handle, "dir_")?;
        let home = self
            .home
            .as_deref()
            .ok_or(ProjectBrowserError::UnsafeFilesystem)?;
        let mut sessions = self.sessions.lock().await;
        remove_expired(&mut sessions);
        let session = sessions
            .get_mut(session_id)
            .ok_or(ProjectBrowserError::DiscoveryExpired)?;
        let target = session
            .handles
            .get(directory_handle)
            .ok_or(ProjectBrowserError::DiscoveryExpired)?;
        let path = canonical_readable_directory(&target.path)?;
        ensure_confined(home, &path)?;
        let summary = registry
            .register(path, Some(display_name))
            .await
            .map_err(ProjectBrowserError::Registry)?;
        session.handles.remove(directory_handle);
        Ok(summary)
    }
}

impl Default for ProjectBrowserRuntime {
    fn default() -> Self {
        Self::new()
    }
}

fn canonical_readable_directory(path: &Path) -> Result<PathBuf, ProjectBrowserError> {
    let canonical =
        std::fs::canonicalize(path).map_err(|_| ProjectBrowserError::UnsafeFilesystem)?;
    if !canonical.is_dir() || std::fs::read_dir(&canonical).is_err() {
        return Err(ProjectBrowserError::UnsafeFilesystem);
    }
    Ok(canonical)
}

fn ensure_confined(home: &Path, path: &Path) -> Result<(), ProjectBrowserError> {
    if path == home || path.starts_with(home) {
        Ok(())
    } else {
        Err(ProjectBrowserError::OutsideAllowedRoot)
    }
}

fn safe_basename(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| safe_label(name))
        .unwrap_or("Home")
        .to_string()
}

fn safe_label(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 120
        && value.trim() == value
        && !value.chars().any(|character| {
            matches!(character as u32, 0x00..=0x1f | 0x7f..=0x9f) || matches!(character, '/' | '\\')
        })
}

fn validate_id(value: &str, prefix: &str) -> Result<(), ProjectBrowserError> {
    (value.len() == prefix.len() + 32
        && value.starts_with(prefix)
        && value[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()))
    .then_some(())
    .ok_or(ProjectBrowserError::DiscoveryExpired)
}

fn random_id(prefix: &str) -> Result<String, ProjectBrowserError> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| ProjectBrowserError::UnsafeFilesystem)?;
    let mut value = String::with_capacity(prefix.len() + 32);
    value.push_str(prefix);
    for byte in bytes {
        use std::fmt::Write;
        write!(value, "{byte:02x}").unwrap();
    }
    Ok(value)
}

fn unique_id<'a>(
    prefix: &str,
    existing: impl Iterator<Item = &'a String>,
) -> Result<String, ProjectBrowserError> {
    let existing = existing.collect::<Vec<_>>();
    for _ in 0..8 {
        let candidate = random_id(prefix)?;
        if !existing.iter().any(|value| value.as_str() == candidate) {
            return Ok(candidate);
        }
    }
    Err(ProjectBrowserError::LimitReached)
}

fn remove_expired(sessions: &mut HashMap<String, DiscoverySession>) {
    let now = Instant::now();
    sessions.retain(|_, session| session.expires > now);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn project_browser_lists_only_immediate_safe_directories_and_rejects_foreign_handles() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(temp.path().join("Visible").join("Nested")).unwrap();
        std::fs::create_dir(temp.path().join(".hidden")).unwrap();
        std::fs::write(temp.path().join("file-secret.txt"), "content-secret").unwrap();
        let runtime = ProjectBrowserRuntime::with_home(Some(temp.path().to_path_buf()));
        let first = runtime.create_session().await.unwrap();
        let second = runtime.create_session().await.unwrap();
        let listed = runtime
            .list(&first.session_id, &first.root.handle)
            .await
            .unwrap();
        assert_eq!(listed.entries.len(), 1);
        assert_eq!(listed.entries[0].display_name, "Visible");
        let json = serde_json::to_string(&listed).unwrap();
        assert!(!json.contains(temp.path().to_str().unwrap()));
        assert!(!json.contains("content-secret"));
        assert_eq!(
            runtime
                .list(&second.session_id, &first.root.handle)
                .await
                .unwrap_err(),
            ProjectBrowserError::DiscoveryExpired
        );
        assert_eq!(
            runtime.list("pds_../bad", "dir_../bad").await.unwrap_err(),
            ProjectBrowserError::DiscoveryExpired
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn project_browser_omits_symlink_escape_and_enforces_entry_bound() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), temp.path().join("Escape")).unwrap();
        let runtime = ProjectBrowserRuntime::with_home(Some(temp.path().to_path_buf()));
        let session = runtime.create_session().await.unwrap();
        assert!(runtime
            .list(&session.session_id, &session.root.handle)
            .await
            .unwrap()
            .entries
            .is_empty());
        for index in 0..=MAX_ENTRIES {
            std::fs::create_dir(temp.path().join(format!("entry-{index:03}"))).unwrap();
        }
        assert_eq!(
            runtime
                .list(&session.session_id, &session.root.handle)
                .await
                .unwrap_err(),
            ProjectBrowserError::LimitReached
        );
    }

    #[tokio::test]
    async fn project_browser_fabricated_handles_expire() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = ProjectBrowserRuntime::with_home(Some(temp.path().to_path_buf()));
        let session = runtime.create_session().await.unwrap();
        assert_eq!(
            runtime
                .list(&session.session_id, "dir_00000000000000000000000000000000")
                .await
                .unwrap_err(),
            ProjectBrowserError::DiscoveryExpired
        );
    }

    #[tokio::test]
    async fn project_browser_stale_session_and_depth_limit_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let mut current = temp.path().to_path_buf();
        for depth in 0..=MAX_DEPTH {
            current = current.join(format!("depth-{depth}"));
            std::fs::create_dir(&current).unwrap();
        }
        let runtime = ProjectBrowserRuntime::with_home(Some(temp.path().to_path_buf()));
        let stale = runtime.create_session().await.unwrap();
        runtime
            .sessions
            .lock()
            .await
            .get_mut(&stale.session_id)
            .unwrap()
            .expires = Instant::now();
        assert_eq!(
            runtime
                .list(&stale.session_id, &stale.root.handle)
                .await
                .unwrap_err(),
            ProjectBrowserError::DiscoveryExpired
        );

        let session = runtime.create_session().await.unwrap();
        let mut handle = session.root.handle;
        for _ in 0..MAX_DEPTH {
            handle = runtime
                .list(&session.session_id, &handle)
                .await
                .unwrap()
                .entries
                .remove(0)
                .handle;
        }
        assert_eq!(
            runtime
                .list(&session.session_id, &handle)
                .await
                .unwrap_err(),
            ProjectBrowserError::LimitReached
        );
    }
}

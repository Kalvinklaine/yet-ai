use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

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
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => {
            let persisted: PersistedDemoModeState = serde_json::from_str(&content)
                .map_err(|_| DemoModeError::Storage)?;
            Ok(DemoModeState::new(persisted.enabled))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DemoModeState::new(false)),
        Err(_) => Err(DemoModeError::Storage),
    }
}

pub async fn set(config_dir: &Path, enabled: bool) -> Result<DemoModeState, DemoModeError> {
    tokio::fs::create_dir_all(config_dir)
        .await
        .map_err(|_| DemoModeError::Storage)?;
    let path = demo_mode_path(config_dir);
    let temporary = path.with_extension("json.tmp");
    let content = serde_json::to_vec_pretty(&PersistedDemoModeState { enabled })
        .map_err(|_| DemoModeError::Storage)?;
    let mut file = tokio::fs::File::create(&temporary)
        .await
        .map_err(|_| DemoModeError::Storage)?;
    file.write_all(&content)
        .await
        .map_err(|_| DemoModeError::Storage)?;
    file.flush().await.map_err(|_| DemoModeError::Storage)?;
    drop(file);
    tokio::fs::rename(temporary, path)
        .await
        .map_err(|_| DemoModeError::Storage)?;
    Ok(DemoModeState::new(enabled))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDemoModeState {
    enabled: bool,
}

use serde::Serialize;

use crate::projects::ProjectContext;

use super::db::{self, ContextDatabaseError};
use super::schema::{PROTOCOL_VERSION, SCHEMA_VERSION};

const MAX_PUBLIC_COUNT: u64 = 10_000_000;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContextStatus {
    pub protocol_version: &'static str,
    pub schema_version: i64,
    pub project_id: String,
    pub state: ContextState,
    pub inventory_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub built_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counts: Option<ContextCounts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freshness: Option<ContextFreshness>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ContextStatusProblem>,
    pub cloud_required: bool,
    pub provider_access: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextState {
    NotBuilt,
    Building,
    Ready,
    Stale,
    Unavailable,
    MigrationRequired,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextCounts {
    pub eligible_files: u64,
    pub indexed_files: u64,
    pub omitted_files: u64,
    pub chunks: u64,
    pub symbols: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextFreshness {
    pub status: FreshnessState,
    pub pending_changes: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessState {
    Current,
    Stale,
    Unknown,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ContextStatusProblem {
    pub code: ContextStatusCode,
    pub message: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextStatusCode {
    Unavailable,
    MigrationRequired,
    CorruptCache,
    ResourceLimit,
}

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum ContextStatusError {
    #[error("context cache unavailable")]
    Unavailable,
    #[error("context cache migration required")]
    MigrationRequired,
    #[error("context cache is corrupt")]
    CorruptCache,
    #[error("context cache resource limit reached")]
    ResourceLimit,
}

pub async fn load_status(
    context: &ProjectContext,
) -> Result<ProjectContextStatus, ContextStatusError> {
    let database = db::open(context).await.map_err(ContextStatusError::from)?;
    let row = database.connection.query_row(
        "SELECT build_state, inventory_generation, profile_id, built_at, updated_at, eligible_files, indexed_files, omitted_files, chunks, symbols, pending_changes FROM context_metadata WHERE singleton = 1",
        [],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, u64>(1)?, row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, u64>(5)?,
            row.get::<_, u64>(6)?, row.get::<_, u64>(7)?, row.get::<_, u64>(8)?, row.get::<_, u64>(9)?, row.get::<_, u64>(10)?
        )),
    ).map_err(|_| ContextStatusError::CorruptCache)?;
    let state = parse_state(&row.0)?;
    let values = [row.1, row.5, row.6, row.7, row.8, row.9, row.10];
    if values.iter().any(|value| *value > MAX_PUBLIC_COUNT) {
        return Err(ContextStatusError::ResourceLimit);
    }
    let has_build_metadata = state != ContextState::NotBuilt;
    Ok(ProjectContextStatus {
        protocol_version: PROTOCOL_VERSION,
        schema_version: SCHEMA_VERSION,
        project_id: context.project_id().to_string(),
        state,
        inventory_generation: row.1,
        profile_id: row.2,
        built_at: row.3,
        updated_at: row.4,
        counts: has_build_metadata.then_some(ContextCounts {
            eligible_files: row.5,
            indexed_files: row.6,
            omitted_files: row.7,
            chunks: row.8,
            symbols: row.9,
        }),
        freshness: has_build_metadata.then_some(ContextFreshness {
            status: if state == ContextState::Stale {
                FreshnessState::Stale
            } else if state == ContextState::Ready {
                FreshnessState::Current
            } else {
                FreshnessState::Unknown
            },
            pending_changes: row.10,
        }),
        error: None,
        cloud_required: false,
        provider_access: "direct",
    })
}

pub fn error_status(context: &ProjectContext, error: ContextStatusError) -> ProjectContextStatus {
    let (state, code, message) = match error {
        ContextStatusError::Unavailable => (
            ContextState::Unavailable,
            ContextStatusCode::Unavailable,
            "Project context cache is unavailable.",
        ),
        ContextStatusError::MigrationRequired => (
            ContextState::MigrationRequired,
            ContextStatusCode::MigrationRequired,
            "Project context cache requires a newer engine.",
        ),
        ContextStatusError::CorruptCache => (
            ContextState::Unavailable,
            ContextStatusCode::CorruptCache,
            "Project context cache is unavailable.",
        ),
        ContextStatusError::ResourceLimit => (
            ContextState::Unavailable,
            ContextStatusCode::ResourceLimit,
            "Project context cache reached a resource limit.",
        ),
    };
    ProjectContextStatus {
        protocol_version: PROTOCOL_VERSION,
        schema_version: SCHEMA_VERSION,
        project_id: context.project_id().to_string(),
        state,
        inventory_generation: 0,
        profile_id: None,
        built_at: None,
        updated_at: None,
        counts: None,
        freshness: None,
        error: Some(ContextStatusProblem { code, message }),
        cloud_required: false,
        provider_access: "direct",
    }
}

fn parse_state(value: &str) -> Result<ContextState, ContextStatusError> {
    match value {
        "not_built" => Ok(ContextState::NotBuilt),
        "building" => Ok(ContextState::Building),
        "ready" => Ok(ContextState::Ready),
        "stale" => Ok(ContextState::Stale),
        "unavailable" => Ok(ContextState::Unavailable),
        "migration_required" => Ok(ContextState::MigrationRequired),
        _ => Err(ContextStatusError::CorruptCache),
    }
}

impl From<ContextDatabaseError> for ContextStatusError {
    fn from(error: ContextDatabaseError) -> Self {
        match error {
            ContextDatabaseError::Unavailable => Self::Unavailable,
            ContextDatabaseError::MigrationRequired => Self::MigrationRequired,
            ContextDatabaseError::Corrupt => Self::CorruptCache,
            ContextDatabaseError::ResourceLimit => Self::ResourceLimit,
        }
    }
}

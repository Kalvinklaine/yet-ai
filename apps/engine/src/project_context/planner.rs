use std::collections::BTreeSet;

use chrono::{Duration, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::projects::ProjectContext;

use super::db;
use super::fts;
use super::manifest::{
    ContextBudgetRequest, ContextManifest, ContextMode, EffectiveBudget, InclusionReason,
    ManifestEntry, ManifestOmission, OmissionReason, Provenance, TextRange,
    VerificationCommandId,
};
use super::profile::{self, ProfileError};
use super::schema::PROTOCOL_VERSION;

const PLAN_SCHEMA_VERSION: i64 = 1;
const MAX_QUERY_CHARS: usize = 1000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextPlanRequest {
    pub query: String,
    pub mode: ContextMode,
    pub budget: ContextBudgetRequest,
    pub explicit_refs: Vec<ExplicitContextRef>,
    pub expected_inventory_generation: u64,
    pub expected_project_revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ExplicitContextRef {
    FileChunk { source_ref: String },
    ActiveEditor {
        editor_snapshot_id: String,
        source_ref: String,
        range: TextRange,
        content_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
    },
    MemoryNote {
        memory_note_id: String,
        content_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
    },
    VerificationOutput {
        verification_result_id: String,
        command_id: VerificationCommandId,
        content_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
    },
    ContinuationPrefix {
        assistant_message_id: String,
        generation_id: String,
        content_prefix_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextPlanStatus {
    Ready,
    Truncated,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextPlan {
    pub protocol_version: &'static str,
    pub schema_version: i64,
    pub plan_id: String,
    pub project_id: String,
    pub mode: ContextMode,
    pub query_label: String,
    pub status: ContextPlanStatus,
    pub manifest: ContextManifest,
    pub created_at: String,
    pub expires_at: String,
    pub cloud_required: bool,
}

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum PlannerError {
    #[error("invalid context plan request")]
    InvalidRequest,
    #[error("project context plan conflict")]
    Conflict,
    #[error("project context profile is not built")]
    NotFound,
    #[error("project context planner unavailable")]
    Unavailable,
}

#[derive(Clone, Debug)]
struct Candidate {
    path: String,
    start_line: u64,
    end_line: u64,
    symbol: Option<String>,
    hash: String,
    bytes: u64,
    reason: InclusionReason,
    provenance: Provenance,
    priority: u8,
    score: f64,
}

pub async fn plan(
    context: &ProjectContext,
    request: ContextPlanRequest,
) -> Result<ContextPlan, PlannerError> {
    validate(context, &request)?;
    let needs_index = request.mode != ContextMode::ManualOnly
        || request.explicit_refs.iter().any(|value| matches!(value, ExplicitContextRef::FileChunk { .. }));
    let profile = match profile::load_profile(context).await {
        Ok(profile) => Some(profile),
        Err(ProfileError::NotFound) if !needs_index => None,
        Err(ProfileError::NotFound) => return Err(PlannerError::NotFound),
        Err(ProfileError::Stale) if !needs_index => None,
        Err(ProfileError::Stale) => return Err(PlannerError::Conflict),
        Err(ProfileError::Unavailable) => return Err(PlannerError::Unavailable),
    };
    let generation = profile.as_ref().map_or(0, |value| value.inventory_generation);
    if needs_index && generation != request.expected_inventory_generation {
        return Err(PlannerError::Conflict);
    }

    let breadth = match request.mode {
        ContextMode::ManualOnly => 0,
        ContextMode::Balanced => 12,
        ContextMode::Deep => 32,
    };
    let lexical = if breadth == 0 {
        Vec::new()
    } else {
        fts::query(
            context,
            generation,
            &request.query,
            breadth,
        )
        .await
        .map_err(|error| match error {
            super::inventory::InventoryError::Conflict => PlannerError::Conflict,
            _ => PlannerError::Unavailable,
        })?
    };
    let database = db::open(context)
        .await
        .map_err(|_| PlannerError::Unavailable)?;
    let mut candidates = Vec::new();
    let mut omissions = Vec::new();

    for explicit_ref in &request.explicit_refs {
        let ExplicitContextRef::FileChunk { source_ref: path } = explicit_ref else { continue };
        match chunks_for_path(
            &database.connection,
            context.project_id(),
            generation,
            path,
            InclusionReason::ExplicitUserSelection,
            Provenance::ExplicitUser,
            0,
            f64::INFINITY,
        )? {
            Some(chunks) => candidates.extend(chunks),
            None => omissions.push(inventory_omission(
                &database.connection,
                generation,
                path,
            )?),
        }
    }

    if request.mode != ContextMode::ManualOnly {
        let profile = profile.as_ref().ok_or(PlannerError::NotFound)?;
        let profile_paths = profile
            .facts
            .iter()
            .map(|fact| fact.source_ref.as_str())
            .collect::<BTreeSet<_>>();
        for path in profile_paths
            .into_iter()
            .take(if request.mode == ContextMode::Deep {
                12
            } else {
                6
            })
        {
            if let Some(chunks) = chunks_for_path(
                &database.connection,
                context.project_id(),
                profile.inventory_generation,
                path,
                InclusionReason::ProfileCandidate,
                Provenance::Profile,
                2,
                0.0,
            )? {
                candidates.extend(chunks.into_iter().take(1));
            }
        }
        for hit in lexical {
            let symbol_match = hit.symbol_name.as_ref().is_some_and(|names| {
                names.split_whitespace().any(|name| {
                    request
                        .query
                        .split(|c: char| !c.is_alphanumeric() && c != '_')
                        .any(|term| term.eq_ignore_ascii_case(name))
                })
            });
            candidates.push(Candidate {
                path: hit.relative_path,
                start_line: hit.start_line,
                end_line: hit.end_line,
                symbol: hit.symbol_name,
                hash: hit.chunk_hash,
                bytes: hit.content.len() as u64,
                reason: if symbol_match {
                    InclusionReason::SymbolMatch
                } else {
                    InclusionReason::LexicalMatch
                },
                provenance: if symbol_match {
                    Provenance::Symbol
                } else {
                    Provenance::Lexical
                },
                priority: 1,
                score: hit.score,
            });
        }
    }

    candidates.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| right.score.total_cmp(&left.score))
            .then(left.path.cmp(&right.path))
            .then(left.start_line.cmp(&right.start_line))
            .then(left.hash.cmp(&right.hash))
    });
    let mut unique = BTreeSet::new();
    candidates.retain(|candidate| unique.insert(candidate.hash.clone()));

    let mut budget = EffectiveBudget::from(&request.budget);
    let mut files = BTreeSet::new();
    let mut entries = Vec::new();
    for explicit_ref in request.explicit_refs.iter().filter(|value| !matches!(value, ExplicitContextRef::FileChunk { .. })) {
        let (bytes, tokens) = explicit_ref.cost();
        if budget.used_chunks >= budget.max_chunks
            || budget.used_bytes.saturating_add(bytes) > budget.max_bytes
            || budget.used_estimated_tokens.saturating_add(tokens) > budget.max_estimated_tokens
        {
            budget.truncated = true;
            continue;
        }
        budget.used_chunks += 1;
        budget.used_bytes += bytes;
        budget.used_estimated_tokens += tokens;
        entries.push(explicit_ref.entry(entries.len() as u64 + 1));
    }
    for candidate in candidates {
        let new_file = !files.contains(&candidate.path);
        let tokens = candidate.bytes.div_ceil(4);
        if (new_file && files.len() as u64 >= budget.max_files)
            || budget.used_chunks >= budget.max_chunks
            || budget.used_bytes.saturating_add(candidate.bytes) > budget.max_bytes
            || budget.used_estimated_tokens.saturating_add(tokens) > budget.max_estimated_tokens
        {
            budget.truncated = true;
            omissions.push(ManifestOmission {
                source_ref: Some(candidate.path),
                reason: OmissionReason::BudgetExhausted,
                provenance: candidate.provenance,
                detail: None,
            });
            continue;
        }
        if new_file {
            files.insert(candidate.path.clone());
        }
        budget.used_chunks += 1;
        budget.used_bytes += candidate.bytes;
        budget.used_estimated_tokens += tokens;
        entries.push(ManifestEntry::file_chunk(
            candidate.path,
            candidate.start_line,
            candidate.end_line,
            candidate.symbol,
            candidate.hash,
            candidate.reason,
            candidate.provenance,
            candidate.bytes,
            tokens,
            entries.len() as u64 + 1,
        ));
    }
    budget.used_files = files.len() as u64;
    omissions.sort_by(|left, right| {
        left.source_ref
            .cmp(&right.source_ref)
            .then(left.reason.cmp(&right.reason))
    });
    omissions.dedup();
    omissions.truncate(256);

    let query_hash = hash(request.query.as_bytes());
    let identity = serde_json::to_vec(&(
        context.project_id(),
        generation,
        &request.mode,
        &query_hash,
        &request.budget,
        &request.explicit_refs,
        &entries,
        &omissions,
    ))
    .map_err(|_| PlannerError::Unavailable)?;
    let identity_hash = hash(&identity);
    let suffix = &identity_hash[7..31];
    let plan_id = format!("plan-{suffix}");
    let manifest_id = format!("manifest-{suffix}");
    let created = Utc::now();
    let created_at = created.to_rfc3339_opts(SecondsFormat::Micros, true);
    let expires_at = (created + Duration::minutes(15)).to_rfc3339_opts(SecondsFormat::Micros, true);
    let mut manifest = ContextManifest::base(
        manifest_id,
        context.project_id().to_string(),
        profile.as_ref().map(|value| value.profile_id.clone()),
        plan_id.clone(),
        request.mode,
        generation,
        query_hash,
        budget,
        created_at.clone(),
    );
    manifest.entries = entries;
    manifest.omissions = omissions;
    manifest.redaction.metadata_only_count = manifest
        .entries
        .iter()
        .filter(|entry| serde_json::to_value(entry).ok().is_some_and(|value| value["redaction"] == "metadata_only"))
        .count() as u64;
    manifest.redaction.omitted_count = manifest.omissions.len() as u64;
    let status = if manifest.budget.truncated {
        ContextPlanStatus::Truncated
    } else {
        ContextPlanStatus::Ready
    };
    let result = ContextPlan {
        protocol_version: PROTOCOL_VERSION,
        schema_version: PLAN_SCHEMA_VERSION,
        plan_id,
        project_id: context.project_id().to_string(),
        mode: request.mode,
        query_label: safe_query_label(&request.query),
        status,
        manifest,
        created_at,
        expires_at,
        cloud_required: false,
    };
    let json = serde_json::to_string(&result).map_err(|_| PlannerError::Unavailable)?;
    if generation > 0 { database.connection.execute(
        "INSERT OR REPLACE INTO context_plans (plan_id, project_id, inventory_generation, plan_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![result.plan_id, context.project_id(), generation, json, result.created_at],
    ).map_err(|_| PlannerError::Unavailable)?; }
    Ok(result)
}

fn validate(context: &ProjectContext, request: &ContextPlanRequest) -> Result<(), PlannerError> {
    if request.query.is_empty()
        || request.query.chars().count() > MAX_QUERY_CHARS
        || request.query.chars().any(char::is_control)
        || request.expected_project_revision != context.revision()
        || !request.budget.valid()
        || request.explicit_refs.len() > 64
    {
        return Err(if request.expected_project_revision != context.revision() {
            PlannerError::Conflict
        } else {
            PlannerError::InvalidRequest
        });
    }
    if request.mode != ContextMode::ManualOnly && request.expected_inventory_generation == 0
        || request.explicit_refs.iter().any(|value| !value.valid())
        || request.explicit_refs.iter().map(|value| serde_json::to_string(value).unwrap_or_default()).collect::<BTreeSet<_>>().len() != request.explicit_refs.len()
    {
        return Err(PlannerError::InvalidRequest);
    }
    Ok(())
}

impl ExplicitContextRef {
    fn cost(&self) -> (u64, u64) {
        match self {
            Self::FileChunk { .. } => (0, 0),
            Self::ActiveEditor { byte_count, estimated_tokens, .. }
            | Self::MemoryNote { byte_count, estimated_tokens, .. }
            | Self::VerificationOutput { byte_count, estimated_tokens, .. }
            | Self::ContinuationPrefix { byte_count, estimated_tokens, .. } => (*byte_count, *estimated_tokens),
        }
    }

    fn valid(&self) -> bool {
        let valid_id = |value: &str| !value.is_empty() && value.len() <= 96 && value.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
        let valid_hash = |value: &str| value.len() == 71 && value.starts_with("sha256:") && value[7..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
        let valid_cost = |bytes: u64, tokens: u64| bytes <= 1_048_576 && tokens <= 200_000;
        match self {
            Self::FileChunk { source_ref } => valid_path(source_ref),
            Self::ActiveEditor { editor_snapshot_id, source_ref, range, content_hash, byte_count, estimated_tokens } => valid_id(editor_snapshot_id) && valid_path(source_ref) && (range.start.line < range.end.line || range.start.line == range.end.line && range.start.character <= range.end.character) && valid_hash(content_hash) && valid_cost(*byte_count, *estimated_tokens),
            Self::MemoryNote { memory_note_id, content_hash, byte_count, estimated_tokens } => valid_id(memory_note_id) && valid_hash(content_hash) && valid_cost(*byte_count, *estimated_tokens),
            Self::VerificationOutput { verification_result_id, content_hash, byte_count, estimated_tokens, .. } => valid_id(verification_result_id) && valid_hash(content_hash) && valid_cost(*byte_count, *estimated_tokens),
            Self::ContinuationPrefix { assistant_message_id, generation_id, content_prefix_hash, byte_count, estimated_tokens } => valid_id(assistant_message_id) && valid_id(generation_id) && valid_hash(content_prefix_hash) && valid_cost(*byte_count, *estimated_tokens),
        }
    }

    fn entry(&self, rank: u64) -> ManifestEntry {
        match self {
            Self::ActiveEditor { editor_snapshot_id, source_ref, range, content_hash, byte_count, estimated_tokens } => ManifestEntry::active_editor(editor_snapshot_id.clone(), source_ref.clone(), range.clone(), content_hash.clone(), *byte_count, *estimated_tokens, rank),
            Self::MemoryNote { memory_note_id, content_hash, byte_count, estimated_tokens } => ManifestEntry::memory_note(memory_note_id.clone(), content_hash.clone(), *byte_count, *estimated_tokens, rank),
            Self::VerificationOutput { verification_result_id, command_id, content_hash, byte_count, estimated_tokens } => ManifestEntry::verification_output(verification_result_id.clone(), *command_id, content_hash.clone(), *byte_count, *estimated_tokens, rank),
            Self::ContinuationPrefix { assistant_message_id, generation_id, content_prefix_hash, byte_count, estimated_tokens } => ManifestEntry::continuation_prefix(assistant_message_id.clone(), generation_id.clone(), content_prefix_hash.clone(), *byte_count, *estimated_tokens, rank),
            Self::FileChunk { .. } => unreachable!(),
        }
    }
}

fn safe_query_label(query: &str) -> String {
    let lower = query.to_ascii_lowercase();
    if lower.contains("://") || lower.contains('/') || lower.contains('\\')
        || ["password", "secret", "token", "api_key", "ignore previous", "system prompt"].iter().any(|term| lower.contains(term))
    {
        return "Context request".into();
    }
    query.chars().filter(|value| !value.is_control()).take(120).collect()
}

fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.starts_with(['/', '~'])
        && !path.contains(['\\', '\0'])
        && !path.contains("://")
        && !path.split('/').any(|part| part == "..")
        && !path.chars().any(char::is_control)
}

fn chunks_for_path(
    connection: &rusqlite::Connection,
    project_id: &str,
    generation: u64,
    path: &str,
    reason: InclusionReason,
    provenance: Provenance,
    priority: u8,
    score: f64,
) -> Result<Option<Vec<Candidate>>, PlannerError> {
    let mut statement = connection.prepare(
        "SELECT start_line, end_line, symbol_name, chunk_hash, length(CAST(content AS BLOB)) FROM context_chunks WHERE project_id = ?1 AND generation = ?2 AND relative_path = ?3 ORDER BY start_line, chunk_hash",
    ).map_err(|_| PlannerError::Unavailable)?;
    let chunks = statement
        .query_map(params![project_id, generation, path], |row| {
            Ok(Candidate {
                path: path.to_string(),
                start_line: row.get(0)?,
                end_line: row.get(1)?,
                symbol: row.get(2)?,
                hash: row.get(3)?,
                bytes: row.get(4)?,
                reason,
                provenance,
                priority,
                score,
            })
        })
        .map_err(|_| PlannerError::Unavailable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| PlannerError::Unavailable)?;
    Ok((!chunks.is_empty()).then_some(chunks))
}

fn inventory_omission(
    connection: &rusqlite::Connection,
    generation: u64,
    path: &str,
) -> Result<ManifestOmission, PlannerError> {
    let reason: Option<String> = connection.query_row(
        "SELECT reason FROM inventory_entries WHERE generation = ?1 AND relative_path = ?2 AND disposition = 'omitted'",
        params![generation, path],
        |row| row.get(0),
    ).optional().map_err(|_| PlannerError::Unavailable)?;
    let reason = match reason.as_deref() {
        Some("ignored") => OmissionReason::Ignored,
        Some("secret_like") => OmissionReason::SecretLike,
        Some("binary") => OmissionReason::Binary,
        Some("generated") => OmissionReason::Generated,
        Some("dependency") => OmissionReason::Dependency,
        Some("oversized") => OmissionReason::Oversized,
        Some("symlink") => OmissionReason::Symlink,
        Some("outside_root") => OmissionReason::OutsideRoot,
        Some("unsupported_type") => OmissionReason::UnsupportedType,
        _ => OmissionReason::PolicyDenied,
    };
    Ok(ManifestOmission {
        source_ref: Some(path.to_string()),
        reason,
        provenance: Provenance::Inventory,
        detail: None,
    })
}

fn hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::ProductIdentity;
    use crate::project_context::rebuild;
    use crate::projects::ProjectRegistryRuntime;
    use crate::storage::resolve_storage_paths;

    async fn fixture() -> (tempfile::TempDir, ProjectContext) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let paths = resolve_storage_paths(
            &ProductIdentity::load().unwrap(),
            &temp.path().join("project"),
            &temp.path().join("config"),
            &temp.path().join("cache"),
        );
        let registry = ProjectRegistryRuntime::new(&paths);
        let summary = registry.register(&root, Some("Planner")).await.unwrap();
        let context = registry
            .resolve_context(&paths, &summary.project_id)
            .await
            .unwrap();
        (temp, context)
    }

    fn write(context: &ProjectContext, path: &str, content: &str) {
        let target = context.canonical_root().join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, content).unwrap();
    }

    fn request(
        context: &ProjectContext,
        generation: u64,
        query: &str,
        mode: ContextMode,
    ) -> ContextPlanRequest {
        ContextPlanRequest {
            query: query.into(),
            mode,
            budget: ContextBudgetRequest {
                max_files: 8,
                max_chunks: 16,
                max_bytes: 32_000,
                max_estimated_tokens: 8_000,
            },
            explicit_refs: Vec::new(),
            expected_inventory_generation: generation,
            expected_project_revision: context.revision().into(),
        }
    }

    #[tokio::test]
    async fn project_context_planner_mode_ranking_explicit_dedup_diversity_and_queries() {
        let (_temp, context) = fixture().await;
        write(&context, "Cargo.toml", "[package]\nname='planner'\n");
        write(&context, "README.md", "project documentation overview\n");
        write(
            &context,
            "src/auth.rs",
            "pub fn authentication() { validate_authentication_session(); }\n",
        );
        write(
            &context,
            "src/other.rs",
            "authentication helper and session support\n",
        );
        let built = rebuild(&context, 0, context.revision()).await.unwrap();

        let overview = plan(
            &context,
            request(
                &context,
                built.generation,
                "what is this project",
                ContextMode::Balanced,
            ),
        )
        .await
        .unwrap();
        assert!(overview
            .manifest
            .entries
            .iter()
            .any(|entry| matches!(entry.source_ref(), "Cargo.toml" | "README.md")));
        let auth = plan(
            &context,
            request(
                &context,
                built.generation,
                "where is authentication",
                ContextMode::Deep,
            ),
        )
        .await
        .unwrap();
        assert_eq!(auth.manifest.entries[0].source_ref(), "src/auth.rs");
        assert!(serde_json::to_string(&auth.manifest)
            .unwrap()
            .contains("symbol_match"));

        let mut manual = request(
            &context,
            built.generation,
            "ignored retrieval",
            ContextMode::ManualOnly,
        );
        manual.explicit_refs = vec![
            ExplicitContextRef::FileChunk { source_ref: "src/other.rs".into() },
            ExplicitContextRef::FileChunk { source_ref: "src/auth.rs".into() },
        ];
        let manual = plan(&context, manual).await.unwrap();
        assert_eq!(
            manual
                .manifest
                .entries
                .iter()
                .map(ManifestEntry::source_ref)
                .collect::<Vec<_>>(),
            vec!["src/auth.rs", "src/other.rs"]
        );
        assert!(manual
            .manifest
            .entries
            .iter()
            .all(|entry| serde_json::to_string(entry)
                .unwrap()
                .contains("explicit_user")));
    }

    #[tokio::test]
    async fn project_context_planner_budget_unsafe_stale_injection_and_isolation() {
        let (_temp, context) = fixture().await;
        write(&context, "src/auth.rs", "pub fn authenticate() {}\n");
        write(&context, ".env", "TOKEN=private\n");
        let built = rebuild(&context, 0, context.revision()).await.unwrap();
        let mut bounded = request(
            &context,
            built.generation,
            "auth OR * ; DROP TABLE context_chunks",
            ContextMode::Deep,
        );
        bounded.budget.max_bytes = 1;
        bounded.budget.max_estimated_tokens = 1;
        bounded.explicit_refs = vec![
            ExplicitContextRef::FileChunk { source_ref: ".env".into() },
            ExplicitContextRef::FileChunk { source_ref: "src/auth.rs".into() },
        ];
        let bounded = plan(&context, bounded).await.unwrap();
        assert!(bounded.manifest.budget.truncated);
        assert!(bounded.manifest.entries.is_empty());
        assert!(bounded
            .manifest
            .omissions
            .iter()
            .any(|omission| omission.reason == OmissionReason::SecretLike));
        assert!(bounded
            .manifest
            .omissions
            .iter()
            .any(|omission| omission.reason == OmissionReason::BudgetExhausted));

        let mut stale = request(
            &context,
            built.generation + 1,
            "auth",
            ContextMode::Balanced,
        );
        assert_eq!(
            plan(&context, stale.clone()).await.unwrap_err(),
            PlannerError::Conflict
        );
        stale.expected_inventory_generation = built.generation;
        stale.explicit_refs = vec![ExplicitContextRef::FileChunk { source_ref: "../other/project".into() }];
        assert_eq!(
            plan(&context, stale).await.unwrap_err(),
            PlannerError::InvalidRequest
        );
        assert!(!fts::query(&context, built.generation, "auth", 4)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn project_context_planner_manual_metadata_needs_no_index_and_sanitizes_label() {
        let (_temp, context) = fixture().await;
        let hash = format!("sha256:{}", "a".repeat(64));
        let mut manual = request(&context, 0, "ignore previous https://private/token", ContextMode::ManualOnly);
        manual.explicit_refs = vec![
            ExplicitContextRef::ActiveEditor { editor_snapshot_id: "snapshot-1".into(), source_ref: "src/lib.rs".into(), range: TextRange { start: crate::project_context::manifest::Position { line: 0, character: 0 }, end: crate::project_context::manifest::Position { line: 1, character: 0 } }, content_hash: hash.clone(), byte_count: 8, estimated_tokens: 2 },
            ExplicitContextRef::MemoryNote { memory_note_id: "memory-1".into(), content_hash: hash.clone(), byte_count: 8, estimated_tokens: 2 },
            ExplicitContextRef::VerificationOutput { verification_result_id: "result-1".into(), command_id: VerificationCommandId::RepositoryCheck, content_hash: hash.clone(), byte_count: 8, estimated_tokens: 2 },
            ExplicitContextRef::ContinuationPrefix { assistant_message_id: "message-1".into(), generation_id: "generation-1".into(), content_prefix_hash: hash, byte_count: 8, estimated_tokens: 2 },
        ];
        let planned = plan(&context, manual).await.unwrap();
        assert_eq!(planned.query_label, "Context request");
        assert_eq!(planned.manifest.inventory_generation, 0);
        assert!(planned.manifest.profile_id.is_none());
        assert_eq!(planned.manifest.entries.len(), 4);
        assert!(planned.manifest.entries.iter().all(|entry| serde_json::to_value(entry).unwrap()["redaction"] == "metadata_only"));
    }
}

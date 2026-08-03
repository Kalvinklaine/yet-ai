use serde::{Deserialize, Serialize};

use super::schema::PROTOCOL_VERSION;

pub const MANIFEST_SCHEMA_VERSION: i64 = 1;
pub const MANIFEST_RANKING_VERSION: &str = "lexical-v1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextMode {
    ManualOnly,
    Balanced,
    Deep,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextBudgetRequest {
    pub max_files: u64,
    pub max_chunks: u64,
    pub max_bytes: u64,
    pub max_estimated_tokens: u64,
}

impl ContextBudgetRequest {
    pub fn valid(&self) -> bool {
        (1..=64).contains(&self.max_files)
            && (1..=256).contains(&self.max_chunks)
            && (1..=1_048_576).contains(&self.max_bytes)
            && (1..=200_000).contains(&self.max_estimated_tokens)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveBudget {
    pub max_files: u64,
    pub max_chunks: u64,
    pub max_bytes: u64,
    pub max_estimated_tokens: u64,
    pub used_files: u64,
    pub used_chunks: u64,
    pub used_bytes: u64,
    pub used_estimated_tokens: u64,
    pub truncated: bool,
}

impl From<&ContextBudgetRequest> for EffectiveBudget {
    fn from(value: &ContextBudgetRequest) -> Self {
        Self {
            max_files: value.max_files,
            max_chunks: value.max_chunks,
            max_bytes: value.max_bytes,
            max_estimated_tokens: value.max_estimated_tokens,
            used_files: 0,
            used_chunks: 0,
            used_bytes: 0,
            used_estimated_tokens: 0,
            truncated: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub line: u64,
    pub character: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextRange {
    pub start: Position,
    pub end: Position,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InclusionReason {
    ProfileCandidate,
    LexicalMatch,
    SymbolMatch,
    PathMatch,
    ExplicitUserSelection,
    ContinuityContext,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    Inventory,
    Profile,
    Lexical,
    Symbol,
    ExplicitUser,
    Continuation,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RedactionState {
    None,
    MetadataOnly,
    ContentRedacted,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ManifestEntry {
    FileChunk {
        #[serde(rename = "sourceRef")]
        source_ref: String,
        range: TextRange,
        #[serde(skip_serializing_if = "Option::is_none")]
        symbol: Option<String>,
        #[serde(rename = "contentHash")]
        content_hash: String,
        #[serde(rename = "inclusionReason")]
        inclusion_reason: InclusionReason,
        provenance: Provenance,
        redaction: RedactionState,
        #[serde(rename = "byteCount")]
        byte_count: u64,
        #[serde(rename = "estimatedTokens")]
        estimated_tokens: u64,
        rank: u64,
    },
}

impl ManifestEntry {
    pub(crate) fn file_chunk(
        source_ref: String,
        start_line: u64,
        end_line: u64,
        symbol: Option<String>,
        content_hash: String,
        inclusion_reason: InclusionReason,
        provenance: Provenance,
        byte_count: u64,
        estimated_tokens: u64,
        rank: u64,
    ) -> Self {
        Self::FileChunk {
            source_ref,
            range: TextRange {
                start: Position {
                    line: start_line.saturating_sub(1),
                    character: 0,
                },
                end: Position {
                    line: end_line,
                    character: 0,
                },
            },
            symbol,
            content_hash,
            inclusion_reason,
            provenance,
            redaction: RedactionState::None,
            byte_count,
            estimated_tokens,
            rank,
        }
    }

    #[cfg(test)]
    pub(crate) fn source_ref(&self) -> &str {
        match self {
            Self::FileChunk { source_ref, .. } => source_ref,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum OmissionReason {
    Ignored,
    SecretLike,
    Binary,
    Generated,
    Dependency,
    Oversized,
    Symlink,
    OutsideRoot,
    UnsupportedType,
    BudgetExhausted,
    StaleHash,
    PolicyDenied,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestOmission {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<String>,
    pub reason: OmissionReason,
    pub provenance: Provenance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedactionSummary {
    pub metadata_only_count: u64,
    pub content_redacted_count: u64,
    pub omitted_count: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifest {
    pub protocol_version: &'static str,
    pub schema_version: i64,
    pub manifest_id: String,
    pub project_id: String,
    pub profile_id: String,
    pub plan_id: String,
    pub mode: ContextMode,
    pub inventory_generation: u64,
    pub query_hash: String,
    pub ranking_version: &'static str,
    pub budget: EffectiveBudget,
    pub entries: Vec<ManifestEntry>,
    pub omissions: Vec<ManifestOmission>,
    pub redaction: RedactionSummary,
    pub created_at: String,
}

impl ContextManifest {
    pub(crate) fn base(
        manifest_id: String,
        project_id: String,
        profile_id: String,
        plan_id: String,
        mode: ContextMode,
        inventory_generation: u64,
        query_hash: String,
        budget: EffectiveBudget,
        created_at: String,
    ) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            schema_version: MANIFEST_SCHEMA_VERSION,
            manifest_id,
            project_id,
            profile_id,
            plan_id,
            mode,
            inventory_generation,
            query_hash,
            ranking_version: MANIFEST_RANKING_VERSION,
            budget,
            entries: Vec::new(),
            omissions: Vec::new(),
            redaction: RedactionSummary {
                metadata_only_count: 0,
                content_redacted_count: 0,
                omitted_count: 0,
            },
            created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_context_manifest_serializes_locked_shape() {
        let mut manifest = ContextManifest::base(
            "manifest-abc".into(),
            "prj_abcdefghijklmnopqrstuv".into(),
            "profile-abc".into(),
            "plan-abc".into(),
            ContextMode::Balanced,
            1,
            format!("sha256:{}", "a".repeat(64)),
            EffectiveBudget::from(&ContextBudgetRequest {
                max_files: 2,
                max_chunks: 3,
                max_bytes: 100,
                max_estimated_tokens: 25,
            }),
            "2026-08-03T00:00:00Z".into(),
        );
        manifest.entries.push(ManifestEntry::file_chunk(
            "src/lib.rs".into(),
            1,
            2,
            Some("authenticate".into()),
            format!("sha256:{}", "b".repeat(64)),
            InclusionReason::SymbolMatch,
            Provenance::Symbol,
            20,
            5,
            1,
        ));
        let value = serde_json::to_value(manifest).unwrap();
        assert_eq!(value["protocolVersion"], "2026-08-02");
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["rankingVersion"], "lexical-v1");
        assert_eq!(value["entries"][0]["kind"], "file_chunk");
        assert_eq!(value["entries"][0]["range"]["start"]["line"], 0);
        assert!(value["entries"][0].get("content").is_none());
    }
}

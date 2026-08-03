use serde::{Deserialize, Serialize};

use super::schema::{PROTOCOL_VERSION, RANKING_VERSION};

pub const MANIFEST_SCHEMA_VERSION: i64 = 1;

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
    ActiveEditor {
        #[serde(rename = "editorSnapshotId")]
        editor_snapshot_id: String,
        #[serde(rename = "sourceRef")]
        source_ref: String,
        range: TextRange,
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
    MemoryNote {
        #[serde(rename = "memoryNoteId")]
        memory_note_id: String,
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
    VerificationOutput {
        #[serde(rename = "verificationResultId")]
        verification_result_id: String,
        #[serde(rename = "commandId")]
        command_id: VerificationCommandId,
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
    ContinuationPrefix {
        #[serde(rename = "assistantMessageId")]
        assistant_message_id: String,
        #[serde(rename = "generationId")]
        generation_id: String,
        #[serde(rename = "contentPrefixHash")]
        content_prefix_hash: String,
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

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum VerificationCommandId {
    RepositoryCheck,
    GuiAppTests,
    EngineChatTests,
}

impl ManifestEntry {
    pub(crate) fn rank(&self) -> u64 {
        match self {
            Self::FileChunk { rank, .. } | Self::ActiveEditor { rank, .. } | Self::MemoryNote { rank, .. } | Self::VerificationOutput { rank, .. } | Self::ContinuationPrefix { rank, .. } => *rank,
        }
    }
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

    pub(crate) fn active_editor(
        editor_snapshot_id: String,
        source_ref: String,
        range: TextRange,
        content_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
        rank: u64,
    ) -> Self {
        Self::ActiveEditor {
            editor_snapshot_id,
            source_ref,
            range,
            content_hash,
            inclusion_reason: InclusionReason::ExplicitUserSelection,
            provenance: Provenance::ExplicitUser,
            redaction: RedactionState::MetadataOnly,
            byte_count,
            estimated_tokens,
            rank,
        }
    }

    pub(crate) fn memory_note(
        memory_note_id: String,
        content_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
        rank: u64,
    ) -> Self {
        Self::MemoryNote {
            memory_note_id,
            content_hash,
            inclusion_reason: InclusionReason::ExplicitUserSelection,
            provenance: Provenance::ExplicitUser,
            redaction: RedactionState::MetadataOnly,
            byte_count,
            estimated_tokens,
            rank,
        }
    }

    pub(crate) fn verification_output(
        verification_result_id: String,
        command_id: VerificationCommandId,
        content_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
        rank: u64,
    ) -> Self {
        Self::VerificationOutput {
            verification_result_id,
            command_id,
            content_hash,
            inclusion_reason: InclusionReason::ExplicitUserSelection,
            provenance: Provenance::ExplicitUser,
            redaction: RedactionState::MetadataOnly,
            byte_count,
            estimated_tokens,
            rank,
        }
    }

    pub(crate) fn continuation_prefix(
        assistant_message_id: String,
        generation_id: String,
        content_prefix_hash: String,
        byte_count: u64,
        estimated_tokens: u64,
        rank: u64,
    ) -> Self {
        Self::ContinuationPrefix {
            assistant_message_id,
            generation_id,
            content_prefix_hash,
            inclusion_reason: InclusionReason::ContinuityContext,
            provenance: Provenance::Continuation,
            redaction: RedactionState::MetadataOnly,
            byte_count,
            estimated_tokens,
            rank,
        }
    }

    #[cfg(test)]
    pub(crate) fn source_ref(&self) -> &str {
        match self {
            Self::FileChunk { source_ref, .. } => source_ref,
            Self::ActiveEditor { source_ref, .. } => source_ref,
            _ => "",
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
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
        profile_id: Option<String>,
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
            ranking_version: RANKING_VERSION,
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
            Some("profile-abc".into()),
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
        assert_eq!(value["rankingVersion"], RANKING_VERSION);
        assert_eq!(value["entries"][0]["kind"], "file_chunk");
        assert_eq!(value["entries"][0]["range"]["start"]["line"], 0);
        assert!(value["entries"][0].get("content").is_none());
    }

    #[test]
    fn project_context_manifest_serializes_all_source_kinds_without_bodies() {
        let hash = format!("sha256:{}", "a".repeat(64));
        let range = TextRange { start: Position { line: 0, character: 0 }, end: Position { line: 1, character: 0 } };
        let entries = vec![
            ManifestEntry::active_editor("snapshot-1".into(), "src/lib.rs".into(), range, hash.clone(), 4, 1, 1),
            ManifestEntry::memory_note("memory-1".into(), hash.clone(), 4, 1, 2),
            ManifestEntry::verification_output("result-1".into(), VerificationCommandId::RepositoryCheck, hash.clone(), 4, 1, 3),
            ManifestEntry::continuation_prefix("message-1".into(), "generation-1".into(), hash, 4, 1, 4),
        ];
        let value = serde_json::to_value(entries).unwrap();
        assert_eq!(value[0]["kind"], "active_editor");
        assert_eq!(value[1]["kind"], "memory_note");
        assert_eq!(value[2]["commandId"], "repository-check");
        assert_eq!(value[3]["kind"], "continuation_prefix");
        assert!(!value.to_string().contains("content\""));
    }
}

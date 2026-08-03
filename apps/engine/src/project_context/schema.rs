pub const PROTOCOL_VERSION: &str = "2026-08-02";
pub const SCHEMA_VERSION: i64 = 1;
pub const POLICY_VERSION: &str = "inventory-policy-1";
pub const RANKING_VERSION: &str = "lexical-ranking-1";

pub const CREATE_SCHEMA: &str = r#"
CREATE TABLE context_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL,
    policy_version TEXT NOT NULL,
    ranking_version TEXT NOT NULL,
    project_identity_hash TEXT NOT NULL,
    inventory_generation INTEGER NOT NULL CHECK (inventory_generation >= 0),
    build_state TEXT NOT NULL CHECK (build_state IN ('not_built', 'building', 'ready', 'stale', 'unavailable', 'migration_required')),
    profile_id TEXT,
    built_at TEXT,
    updated_at TEXT,
    eligible_files INTEGER NOT NULL DEFAULT 0 CHECK (eligible_files >= 0),
    indexed_files INTEGER NOT NULL DEFAULT 0 CHECK (indexed_files >= 0),
    omitted_files INTEGER NOT NULL DEFAULT 0 CHECK (omitted_files >= 0),
    chunks INTEGER NOT NULL DEFAULT 0 CHECK (chunks >= 0),
    symbols INTEGER NOT NULL DEFAULT 0 CHECK (symbols >= 0),
    pending_changes INTEGER NOT NULL DEFAULT 0 CHECK (pending_changes >= 0)
);
CREATE TABLE inventory_entries (
    generation INTEGER NOT NULL CHECK (generation > 0),
    relative_path TEXT NOT NULL,
    file_bytes INTEGER NOT NULL CHECK (file_bytes >= 0),
    modified_unix_ms INTEGER,
    language TEXT,
    content_hash TEXT,
    disposition TEXT NOT NULL CHECK (disposition IN ('included', 'omitted')),
    reason TEXT NOT NULL,
    PRIMARY KEY (generation, relative_path)
);
CREATE INDEX inventory_entries_generation ON inventory_entries(generation, disposition);
"#;

pub const CREATE_INVENTORY_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS inventory_entries (
    generation INTEGER NOT NULL CHECK (generation > 0),
    relative_path TEXT NOT NULL,
    file_bytes INTEGER NOT NULL CHECK (file_bytes >= 0),
    modified_unix_ms INTEGER,
    language TEXT,
    content_hash TEXT,
    disposition TEXT NOT NULL CHECK (disposition IN ('included', 'omitted')),
    reason TEXT NOT NULL,
    PRIMARY KEY (generation, relative_path)
);
CREATE INDEX IF NOT EXISTS inventory_entries_generation ON inventory_entries(generation, disposition);
"#;

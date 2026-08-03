# ADR 042: Local Project Context Platform

- Status: accepted
- Plan traceability: project-context-master-plan, Wave 0, T-45
- Scope: engine-owned project inventory, indexing, retrieval, manifests, continuity identifiers, and local cache contracts
- Current implementation status: `partial`
- Current provenance: `live_engine` for SQLite bootstrap, authenticated status, and explicit safe inventory rebuild

## Context

Registered projects already have opaque identities and isolated engine-owned storage, while project memory is an implemented shelf of explicit user-authored notes. The engine bootstraps one isolated rebuildable SQLite context cache per project, exposes authenticated project-scoped status, and supports explicit bounded safe inventory rebuild. Yet AI does not yet index file content, build a project profile, retrieve indexed context, expose context planning endpoints, or persist turn context manifests. Schemas and examples beyond status and rebuild remain `fixture_demo` evidence and do not make those endpoints reachable.

The context platform must explain what it read and selected without exposing canonical roots, crossing projects, silently indexing secrets, or requiring a hosted service. It must remain useful before embeddings or compiler-accurate analysis exist.

## Decision

### Ownership and isolation

The engine owns inventory policy, local reads, hashing, chunking, SQLite migrations, lexical retrieval, symbol extraction, planning, manifests, cache deletion, and turn-continuity identifiers. GUI and IDE hosts may request operations and render sanitized results; they do not scan roots, persist raw indexed content, or reinterpret policy.

Each registered `projectId` has one context-cache SQLite database in its engine cache namespace. The database is resolved from immutable request-scoped project context and is never selected by a client path. A connection opened for one project cannot query or attach another project's database. SQL `ATTACH` is forbidden in this subsystem. Tests must prove two-project isolation.

The cache namespace owns only rebuildable inventory facts, profiles, chunks, lexical/symbol indexes, ranking metadata, and ephemeral plans. Deleting context cache closes handles and removes that database, its SQLite sidecars, and context-owned temporary files. The next cache status is `not_built`; a later explicit rebuild recreates it.

Immutable effective manifests, turn-to-manifest links, generation lineage, continuation prefix hashes, and persisted partial assistant text are durable chat/turn evidence. They belong in the engine's per-project config storage, not the cache database, and survive context-cache deletion and rebuild. Their retention and deletion follow the owning chat/turn policy: deleting a chat removes its turn evidence; deleting one cache never does. Project hard deletion, if separately approved, must independently remove both the rebuildable cache namespace and all durable project config records. Archive removes neither. Cache deletion does not delete project registration, chats, turn evidence, project-memory notes, provider state, source files, or provider-side data.

### Safe inventory policy

Inventory starts from the engine-private canonical project root but every public source reference is normalized project-relative UTF-8 text using `/`. Empty, absolute, traversal, URL, home-relative, control-character, and backslash forms are rejected at public boundaries.

The inventory is deny-by-default:

- do not follow symlinks; record `symlink` omission without resolving or reading the target;
- exclude version-control ignored paths and product defaults for secrets, credentials, hidden metadata, dependencies, build output, generated output, binaries, sockets, devices, and context-cache material;
- reject non-regular files and files outside the canonical root after containment checks;
- classify binary-like content before indexing and never store it as text;
- cap traversal depth, files visited, individual file bytes, total read bytes, line length, chunk count, indexed bytes, elapsed time, and diagnostic counts;
- revalidate containment and file identity around reads to reduce time-of-check/time-of-use races;
- store an omission reason and bounded safe label or aggregate count, never omitted content;
- never override ignore or secret policy merely because retrieval mode is broader.

Initial inclusion reasons are `profile_candidate`, `lexical_match`, `symbol_match`, `path_match`, `explicit_user_selection`, and `continuity_context`. Omission reasons are `ignored`, `secret_like`, `binary`, `generated`, `dependency`, `oversized`, `symlink`, `outside_root`, `unsupported_type`, `budget_exhausted`, `stale_hash`, and `policy_denied`.

### Deterministic profile

A profile is rebuilt from safe inventory facts only. It summarizes bounded evidence from common readme, manifest, workspace, module, language, and entry-point candidates. Ordering is deterministic: policy priority, normalized path, then stable tie-breakers. Identical eligible files and bytes produce the same profile facts and hashes. Profile summaries cite relative source refs and content hashes; they do not contain raw roots, unbounded file bodies, model output, or inferred certainty beyond the evidence.

### Retrieval and modes

Version 1 retrieval is lexical-first: FTS5 chunk matches combined with deterministic path, profile, and lightweight symbol signals. Ranking inputs and weights are versioned. Equal scores use stable relative-path, range, and hash tie-breakers. Embeddings, remote retrieval, and full semantic/codegraph claims are absent.

Modes change retrieval breadth only:

| Mode | Breadth | Authority |
| --- | --- | --- |
| `manual_only` | Only explicit user-selected eligible sources and required continuity metadata | Same inventory, secret, root, redaction, and budget policy |
| `balanced` | Bounded profile plus lexical/path/symbol candidates | Same policy and no hidden authority expansion |
| `deep` | Larger candidate and byte budgets within hard engine caps | Same policy and no new file classes, tools, writes, provider calls, or ignore overrides |

No mode grants filesystem mutation, shell, git, tool, provider-tool, background autonomy, secret access, symlink traversal, ignored-file override, or cross-project access.

### ContextManifest

`ContextManifest` is the auditable input-selection record. It includes:

- protocol and schema versions, `manifestId`, opaque `projectId`, `profileId`, optional `planId`, mode, creation time, and inventory generation;
- query and ranking hashes rather than hidden raw planner state;
- explicit hard budget, used budget, and truncation state;
- ordered discriminated entries: `file_chunk` uses a project-relative source ref and range; `active_editor` uses an opaque editor snapshot ID plus project-relative source ref and range; `memory_note` uses only an opaque memory-note ID; `verification_output` uses an opaque result ID plus allowlisted command ID; and `continuation_prefix` uses opaque assistant-message/generation IDs plus the prefix hash. Every kind carries its required exact-content hash or prefix hash, inclusion reason, provenance, redaction state, byte/token estimates, and effective rank;
- ordered omissions with project-relative source ref when safe, omission reason, provenance, and bounded safe detail;
- aggregate redaction and omission counts.

Allowed provenance is `inventory`, `profile`, `lexical`, `symbol`, `explicit_user`, or `continuation`. Redaction is `none`, `metadata_only`, or `content_redacted`. A manifest never contains a canonical root, absolute path, raw secret, ignored content, unbounded file body, embedding vector, provider credential, provider response, or command material. Manifest entry hashes identify the exact eligible bytes used. If a current hash differs before dispatch, the entry is omitted as `stale_hash` or the plan is rebuilt; stale bytes are never silently sent.

### HTTP contracts

All routes are authenticated loopback, project-scoped routes under `/p/{projectId}/v1`; the path owns `projectId`, so request bodies do not carry a root or project selector. Status and explicit rebuild are currently live; every other route remains planned and unsupported.

| Route | Planned request | Planned response |
| --- | --- | --- |
| `GET /context/status` (live) | none | `ContextStatus`: state, schema/generation, bounded counts, freshness and safe error category |
| `GET /context/profile` | none | `ProjectContextProfile`; `not_found` until built |
| `POST /context/rebuild` (live) | strict `ProjectContextRebuildRequest`: mode plus expected inventory generation and project revision | `ProjectContextRebuildResponse`: accepted operation metadata; no raw path or file list |
| `DELETE /context/cache` | none | `ProjectContextCacheDeleteResponse`: deletion result, resulting `not_built` state, and explicit durable-turn-evidence retention |
| `POST /context/plan` | strict `ContextPlanRequest`: query, retrieval mode, hard budget, explicit relative refs, expected inventory generation, and project revision | `ContextPlan` plus complete preview `ContextManifest` |

Rebuild and delete require explicit user or trusted-host initiation in the first implementation. Watcher-triggered incremental refresh is a later wave and must preserve the same policy. Status errors use sanitized categories such as `unavailable`, `migration_required`, `corrupt_cache`, `policy_blocked`, or `resource_limit`; parser, SQL, OS, and path details remain private.

### Turn and continuation compatibility

IDs are opaque, bounded, path-safe strings minted by the engine:

- `contextPlanId` identifies one planned selection;
- `contextManifestId` identifies the immutable effective selection used by a turn;
- `turnId` identifies one user/assistant turn independent of transport retries;
- `assistantMessageId` identifies the assistant message that may hold partial text;
- `generationId` identifies one generation attempt;
- `continuationOfGenerationId` links a later continuation attempt to the interrupted attempt;
- `contentPrefixHash` binds continuation to the exact persisted partial assistant prefix.

A future chat-command extension may reference an engine-owned `contextPlanId`, but must not accept arbitrary manifest contents as authority. At dispatch the engine revalidates the plan, freezes an effective manifest, and persists `contextManifestId` with the turn. Partial assistant persistence and Continue are future waves. Continue must use the same chat, turn lineage, assistant message, and original effective manifest unless an explicit later contract records a visible manifest delta. It must not duplicate the persisted prefix, silently replace earlier output, or gather hidden context.

### Project memory remains distinct

Project memory is explicit user-authored notes with its existing CRUD/search/one-shot attachment contract. It is not inventory, profile evidence, an indexed source file, or automatic retrieval authority. A note enters a turn only through explicit selection and appears in the effective manifest with `explicit_user` provenance. Rebuilding or deleting context cache never changes project-memory notes.

### SQLite schema and migrations

The context database carries an integer `user_version` and a metadata row with schema version, policy version, ranking version, project identity hash, inventory generation, and build state. Migrations are ordered, transactional, idempotently detected, and scoped to one project database. A newer unsupported schema fails closed. A failed migration leaves the previous committed database usable or marks it for rebuild; it never partially advertises readiness. Derived index migrations may choose atomic rebuild into a sibling temporary database followed by rename. Temporary names are engine-generated and cleaned after failure.

Content hashes use a documented stable cryptographic digest encoding. Hash algorithm changes increment schema or hash-format version. FTS tokenization and ranking changes increment ranking version and force deterministic rebuild where results would otherwise drift.

## Capability waves and evidence gates

| Wave | Capability | Truth before implementation | Required gate when implemented |
| --- | --- | --- | --- |
| 0 | ADR, threat model, schemas, examples | `fixture_demo`; runtime `unsupported` | Tier 0 contracts, docs, hygiene, diff |
| 1 | SQLite bootstrap, deletion, status | `unsupported` | Tier 1 engine storage/migration tests; Tier 2 project-scoped HTTP isolation |
| 2 | Safe inventory | `unsupported` | Tier 1 policy, symlink, ignore, secret, budget, race tests |
| 3 | Deterministic profile | `unsupported` | Tier 1 determinism/golden tests; Tier 2 real-engine profile response |
| 4 | Profile/status GUI | `unsupported` | Tier 1 GUI client/render tests; Tier 2 routed real-engine smoke |
| 5 | FTS5 lexical retrieval | `unsupported` | Tier 1 ranking, bounds, isolation tests; Tier 2 query smoke |
| 6 | Lightweight symbols | `unsupported` | Tier 1 parser provenance/fallback tests |
| 7 | Planner and manifest | `unsupported` | Tier 1 budget/hash/omission tests; Tier 2 inspectable plan smoke |
| 8 | GUI inspector | `unsupported` | Tier 1 GUI tests; Tier 2 routed preview/adjust smoke |
| 9 | Chat integration | `unsupported` | Tier 1 command compatibility; Tier 2 manifest-to-provider smoke |
| 10 | Turn manifest persistence | `unsupported` | Tier 1 storage/migration tests; Tier 2 history reload smoke |
| 11 | Partial assistant persistence | `unsupported` | Tier 1 interruption/storage tests; Tier 2 streamed interruption smoke |
| 12 | Continue | `unsupported` | Tier 1 lineage/idempotency tests; Tier 2 interruption/continue smoke |
| 13 | Incremental invalidation and host parity | `unsupported` | Tier 1 watcher/hash tests; Tier 2 Browser/VS Code/JetBrains parity evidence |

Each wave updates ADR 041 only after an authoritative reachable path and focused evidence exist. Tier 3 real-provider or installed-host evidence requires a separately approved card.

## Non-goals

This decision does not implement endpoints, database code, indexing, watchers, GUI, chat integration, provider prompt assembly, partial persistence, or Continue. It does not introduce embeddings, vector services, hosted retrieval, semantic certainty, compiler-accurate symbols, full code graphs, multi-root identity, cloud sync, repository mutation, shell/git/tool execution, provider tool calling, automatic edits, secret indexing, ignored-file override, symlink traversal, browser filesystem authority, broad chat-history migration, or project-memory migration.

## Verification

Wave 0 is `tier_0` contract and documentation evidence only:

```sh
npm run validate:contracts
npm run validate:docs
npm run validate:hygiene
git diff --check
```

## Consequences

Context implementation has one engine-owned, project-isolated, inspectable path. Breadth can grow without growing authority. The schema fixtures are a map, not a tiny index wearing SQLite spectacles.

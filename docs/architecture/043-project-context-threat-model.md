# ADR 043: Project Context Threat Model

- Status: accepted
- Plan traceability: project-context-master-plan, Wave 0, T-45
- Scope: project-context inventory, cache, retrieval, manifest, prompt, and deletion boundaries
- Current implementation status: `implemented`
- Current provenance: `live_engine`

## Assets and trust boundaries

Protected assets are project source, ignored and secret-like files, canonical roots, provider credentials, context cache contents, manifest integrity, project identity, chat turns, project-memory notes, resource availability, and user understanding of what leaves the machine.

Trust boundaries are:

1. registered root and local filesystem into engine inventory;
2. engine-private canonical paths into project-relative public references;
3. source bytes into the rebuildable per-project SQLite cache under cache storage;
4. cached facts into retrieval and planning;
5. manifest preview into user-approved chat dispatch;
6. immutable effective manifests, turn links, generation lineage, continuation hashes, and partial text into durable per-project config storage;
7. effective manifest content into the configured provider or local runtime;
8. engine responses into GUI and IDE hosts.

The local filesystem and indexed text are untrusted input. GUI and IDE clients are not authorities for roots, policy, hashes, cache selection, or manifest contents. Configured providers are external recipients unless they are local runtimes.

## Security invariants

- Every operation is bound to exactly one engine-resolved opaque `projectId` and one private canonical root.
- Public contracts contain project-relative references only; roots and absolute paths never become fallback labels.
- Symlinks are not followed, ignored and secret-like files are not indexed, and policy is identical across retrieval modes.
- Context sent to a provider is a subset of an effective visible manifest and uses bytes matching its recorded hashes.
- Cache data is derived, bounded, locally deletable, and never grants authority to source files.
- Durable turn evidence is config-owned and cannot be erased by cache deletion or rebuild; chat deletion and separately approved project hard deletion own its removal.
- Project memory remains explicit notes and cannot silently enter automatic retrieval.
- Failure is closed and sanitized; it does not broaden scope or leak parser, SQL, OS, path, or content details.

## Threats and controls

| Threat | Attack or failure | Required controls | Required evidence before implementation is promoted |
| --- | --- | --- | --- |
| Prompt injection in source | Indexed instructions try to change policy, request secrets, tools, or hidden reads | Treat source as quoted untrusted evidence; delimit source and provenance; never parse source text into authority; engine policy and tool confirmation remain independent; manifest shows selected source | Unit adversarial fixtures; Tier 2 prompt-capture smoke proving source cannot add tool/context authority |
| Secret ingestion | Keys, tokens, credentials, private config, or high-entropy material enter cache or prompt | Layered path/name policy, ignore rules, content classification before persistence, metadata-only omission, no raw diagnostic echo, regression corpus with synthetic markers | Inventory and manifest negative tests; cache inspection showing markers absent |
| Symlink and containment escape | Link, junction-like entry, alias, or race escapes root | Canonical registered root; `lstat`-style classification; no symlink following; relative component walk; containment and identity checks around open/read; reject non-regular files | Symlink file/directory, replacement-race, and outside-root tests on supported platforms |
| Ignored-file bypass | Deep mode, explicit selection, unusual ignore syntax, or nested rules include denied content | Central policy evaluator; hard deny rules precede breadth and explicit selection; deterministic ignore precedence; omission reason recorded | Policy matrix and nested-ignore tests in every mode |
| Cross-project leakage | Shared connection, cache key collision, stale request, or GUI state returns another project | One DB per project; no `ATTACH`; request-scoped project context; project ID included in metadata integrity checks; cache/query keys include project identity; stale GUI responses keyed by project authority | Two-project engine tests and routed smoke with identical relative paths and different content |
| Unbounded consumption | Huge trees/files/lines/queries or pathological FTS input exhaust CPU, memory, disk, handles, or prompt budget | Hard traversal/read/index/chunk/query/result/time/disk/token limits; cancellation; bounded queues; safe partial state; query normalization; SQLite limits and transactions; no recursive client knobs | Boundary and cancellation tests; resource-limit status and recovery tests |
| Stale or confused hashes | File changes after inventory, plan, or partial response; wrong bytes are attributed to a hash | Stable digest with format version; hash eligible bytes; revalidate identity/hash before dispatch; omit `stale_hash` or rebuild; immutable effective manifest; continuation prefix hash | Mutation-between-plan-and-send tests; continuation mismatch tests |
| Cache tampering or corruption | Local process edits DB, migrations stop midway, or sidecars survive deletion | Private permissions where supported; strict schema/version/integrity checks; transactional migration; rebuild-on-derived-corruption policy; sanitized errors; remove DB, WAL, SHM, and temp files | Corruption/migration rollback and deletion tests |
| Malicious filenames and diagnostics | Names contain controls, private fragments, secret text, invalid Unicode, or huge values | Normalize/reject unsafe public refs; bound every label; avoid filename echo when unsafe; aggregate omissions; sanitized error taxonomy | Schema negatives and filesystem fixtures |
| Binary/generated content smuggling | Mislabelled binary, minified, generated, dependency, or compressed content bloats index or leaks artifacts | Content sniffing plus path policy; line/entropy/size limits; no archive expansion; no dependency/generated override | Binary/archive/generated/minified fixtures |
| SQL/FTS injection | Query or metadata alters SQL or creates pathological expressions | Prepared statements only; compile user text into bounded literal lexical terms; never concatenate identifiers or FTS syntax; reject empty/pathological query | Injection and pathological-query unit tests |
| Manifest spoofing | Client submits entries, hashes, roots, or inflated authority | Engine mints IDs and effective manifests; client submits only strict plan inputs or a plan ID; re-resolve project and revalidate plan at dispatch | HTTP schema negatives and stale/foreign plan tests |
| Hidden provider disclosure | Auto context is sent without clear preview or differs from preview | Complete preview manifest; explicit Send remains required; effective manifest persisted; visible delta if plan changes; configured provider is named elsewhere by existing chat readiness | Routed preview-to-captured-request smoke |
| Memory/index confusion | User notes are silently indexed or automatic retrieval is described as memory | Separate storage, schemas, provenance, deletion, and UI labels; notes enter only through explicit selection | Cross-store deletion and attachment tests |
| Deletion ambiguity | Cache delete is mistaken for source, durable turn evidence, note, chat, provider, backup, or provider-side deletion | Separate cache/config ownership, post-delete `not_built`, response confirms durable evidence retention, explicit exclusions, sidecar cleanup, no source mutation | Cross-store deletion tests and GUI copy review |

## Prompt-injection handling

Context text is data, never policy. Prompt assembly must place product/system instructions outside source delimiters and label every source with relative reference, range, hash, and provenance. Source requests to reveal secrets, inspect omitted files, call tools, change modes, ignore budgets, edit files, or contact a service have no effect. Retrieval ranking may match such text but cannot turn it into authority. A later tool system must independently authorize every action and cannot trust a manifest entry as confirmation.

## Secret and redaction policy

The first implementation must define a versioned deny policy containing product-private paths, common credential names, environment files, key material, auth/session stores, VCS internals, context cache, dependencies, generated output, and user ignore rules. Secret-like content detection occurs before text enters SQLite. Detection produces only category, count, and safe omission metadata. Samples, matching substrings, entropy windows, and raw values are not persisted or returned.

False positives are safer than false negatives for automatic context. A future explicit override requires a separate reviewed design; this ADR does not permit one. `manual_only` therefore does not bypass secret, ignore, symlink, binary, root, or size controls.

## Staleness and continuity

Inventory generation changes when eligible source facts change. Profiles, chunks, symbols, plans, and manifests record the generation and source hashes they derive from. A plan from another project, policy version, ranking version, or obsolete generation is rejected or visibly replanned. Dispatch freezes an immutable effective manifest.

Partial assistant text is durably replaced before its delta is exposed and abandoned streaming messages become visible interrupted messages on recovery. Explicit Continue is live for eligible interrupted planned-context turns: it validates chat, source turn, assistant message, project revision, manifest identity, effective provider/model, duplicate request/successor lineage, and a maximum depth of three. It reuses the persisted manifest and model, adds no user message, and sends only bounded prior conversation plus the bounded partial suffix with an anti-repetition instruction. ContextManifest schema version 2 owns `continuation_prefix`; durable readers reject older manifest records with the explicit `manifest_migration_required` outcome and never reinterpret them. A future content-prefix digest check at the continuation execution boundary remains unsupported; the current engine validates persisted identity and lineage rather than accepting a client-supplied prefix hash.

## Logging and diagnostics

Allowed diagnostics are opaque correlation IDs, project ID, operation, phase, counts, durations, versions, bounded status, and omission categories. Logs and GUI errors exclude canonical roots, absolute paths, source bodies, snippets, secret candidates, SQL text with user values, raw FTS queries, provider requests/responses, credentials, and raw OS errors. Debug modes do not relax this public boundary.

## Verification gates

- Tier 0: compile all schemas, validate safe examples and invalid fixtures when added, validate docs/hygiene, inspect diff.
- Tier 1: focused engine tests for policy, normalization, isolation, migrations, corruption, bounds, determinism, ranking, hashes, cancellation, deletion, and continuation lineage.
- Tier 2: authenticated real-engine smokes for two-project isolation, status/profile/plan, visible manifest-to-provider parity, stale-plan rejection, deletion, routed GUI isolation, and later host parity.
- Tier 3: separately approved sanitized real-provider or installed-host evidence only; it is never inferred from lower tiers.

Any secret marker in cache, cross-project result, root/path exposure, symlink escape, manifest/provider mismatch, policy bypass, unbounded operation, or stale-hash dispatch is a blocking Critical or High finding. Documentation or fixture success cannot waive it.

## Residual risks

Secret classification cannot prove that arbitrary source is non-sensitive. Ignore files can be incomplete. Local malware with the user's permissions can inspect process memory or local databases. Filesystems differ in race and link semantics. Lexical retrieval can rank malicious or irrelevant text. Provider retention is governed by the configured provider, not by local cache deletion. Product UX must communicate these limits and allow inspection and local cache deletion.

## Non-goals

This model does not promise perfect secret detection, encrypted local storage, protection from a fully compromised user account, provider-side deletion, enterprise retention, sandboxing of provider prompts, semantic correctness, or tool-execution safety. It grants no filesystem mutation, shell, git, provider-tool, network, or autonomous authority.

## Consequences

The implementation must prove privacy and isolation at the same time it proves retrieval quality. A clever index that wanders through symlinks is merely a very energetic privacy bug.

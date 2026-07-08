# 031 Controlled Agent Storage and Privacy Inventory

This S127-C1 inventory records the controlled-agent persistence and privacy surfaces before any cleanup, export hardening, or retention implementation work. It is documentation only. It does not add storage code, deletion controls, export code, runtime endpoints, bridge messages, host actions, telemetry, package behavior, provider calls, production readiness, release readiness, marketplace readiness, or broader agent authority.

The current controlled-agent status remains VS Code-first local dev-preview hardening. Evidence below distinguishes implemented behavior from future hardening requirements. Unknown or missing retention and deletion controls are marked partial or blocked rather than done. Core workflows must preserve the local-first BYOK contract: no hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, or cloud-synced workspace is required for the controlled-agent path.

## Status legend

| Status | Meaning |
| --- | --- |
| Implemented evidence | Code, docs, fixtures, or smokes already demonstrate a narrow bounded behavior. |
| Partial | Some evidence exists, but coverage is incomplete across hosts, lifecycle, retention, deletion, export, packaging, or real local dogfood. |
| Blocked | Do not claim this control exists until future implementation and verification land. |
| Not applicable | The surface is intentionally unsupported for the current controlled-agent scope. |

## Source evidence reviewed

- `docs/architecture/012-coding-session-trace.md` for GUI-local in-memory trace/report constraints.
- `docs/architecture/014-controlled-run-history.md` for the future sanitized history contract and raw-data prohibitions.
- `docs/architecture/017-controlled-agent-production-gap-audit.md` for the S107/S124 persistence/privacy gap category.
- `docs/architecture/022-controlled-agent-verification-bundles.md` for fixed command-id verification metadata and raw output exclusions.
- `docs/architecture/027-controlled-agent-task-level-beta-gate.md` and `docs/architecture/028-useful-multifile-controlled-agent-decision.md` for packaged beta/report evidence and hardening-next residual risks.
- `scripts/lib/forbidden-evidence-text.mjs` for sanitized forbidden-evidence labels covering private paths, secret/auth material, raw payload dumps, browser storage dumps, and raw command/output markers.
- `docs/dogfood/controlled-agent-real-provider-matrix.md`, `docs/dogfood/agent-run-one-step.md`, and controlled-agent dev-preview fixtures for sanitized manual dogfood/report boundaries.
- `apps/engine/src/storage.rs`, provider/auth/history/memory storage modules, GUI trace/report services, VS Code plugin README/package settings, and JetBrains runtime/settings sources for implemented storage and log surfaces.

## Inventory summary

| Surface | Current persistence | Implemented evidence | Retention/deletion status | Privacy status |
| --- | --- | --- | --- | --- |
| Browser storage | Controlled-agent trace/report/history panels are intended to remain in React memory; focused tests and smokes assert `localStorage` and `sessionStorage` cleanliness for several controlled-agent panels. | Partial: evidence exists for targeted GUI surfaces and smoke paths, not every future panel or browser API. | Blocked: no product-level retention/deletion control is needed for non-persistence, but no universal browser-storage audit gate exists for every future controlled-agent feature. | Raw prompts, file bodies, diffs, command material, provider payloads, tokens, private paths, and bridge dumps must not be written to browser storage. |
| GUI in-memory state | React state holds selected context, trace entries, proposals, run state, recovery guidance, report previews, follow-up drafts, and task preset metadata during the visible session. | Implemented evidence for many pure services and local/mock smokes: trace entries are bounded and sanitized; reports/exports are metadata-only; stale proposal lineage fails closed. | Partial: memory is cleared by page lifecycle or explicit state transitions, but there is no complete documented in-app clear-all control for every controlled-agent state family. | In-memory state may contain user-visible prompts or active excerpts while the user is using the session. Shareable reports must use sanitized metadata only. |
| GUI persisted state | No approved controlled-agent browser persistence for raw traces, reports, exports, history, prompt bodies, model responses, file bodies, diffs, replacement text, command output, provider payloads, or bridge dumps. | Partial: targeted tests assert no storage writes for controlled panels and services. | Blocked: future history/export persistence needs a reviewed owner, schema, migration, deletion, and redaction policy before implementation. | Any future GUI persistence must be sanitized metadata returned by trusted local services, not raw sensitive payloads. |
| Engine config/cache/project storage | Engine resolves `.yet-ai`, config, and cache directories from `product/identity.json`; provider configs, local secret-store fallback, chat history, demo mode, project memory, and provider auth state live under engine-owned local paths when enabled. | Implemented evidence exists for local storage path resolution and engine-owned provider/config flows. Provider setup responses are intended to return summaries, not raw secrets. | Partial: provider delete paths exist for provider configs/secrets, and some local records are bounded, but there is no complete controlled-agent retention/deletion policy for every engine record, log, cache, chat-history, project-memory, and auth artifact. | Engine is the authority for provider credentials and local runtime state. GUI and plugins must not persist raw provider secrets or return them through GUI-facing responses after save. |
| Runtime HTTP/SSE and in-memory replay | Runtime chat/SSE state includes in-memory event replay and snapshot-prunable terminal evidence; HTTP endpoints return runtime/provider/chat metadata over authenticated loopback APIs. | Partial: engine code bounds and prunes some replay state; docs preserve local loopback and authenticated boundaries. | Partial: replay pruning exists for some terminal evidence, but there is no complete controlled-agent retention/deletion story for all runtime events, SSE diagnostics, and chat history. | Runtime tokens, bearer headers, provider credentials, raw provider payloads, private paths, and unbounded logs must not appear in GUI-facing status or shareable evidence. |
| Engine logs and diagnostics | Engine and plugin-launched runtime output can be captured by host logs or output channels. VS Code and JetBrains have redaction helpers and tests for runtime status/log text. | Partial: host-side diagnostics redact session tokens, bearer headers, provider secrets, secret-looking JSON fields, cookies, private paths, and long text in focused tests. | Blocked: product-level log retention, user deletion, support-bundle collection, and cross-platform log location inventory are not complete. | Logs must remain local and redacted. Raw stdout/stderr dumps, stack traces with private paths, provider payloads, tokens, and environment dumps are forbidden in shareable reports. |
| VS Code plugin state | The extension stores runtime connection settings and uses SecretStorage for the preferred local runtime session token. A deprecated settings fallback exists for local dev-preview debug connections and must not be used for provider keys. Controlled workspace actions are host-owned and explicit. | Implemented evidence in README, package settings, and engine-connection checks shows token-source labeling and sanitized runtime status without token disclosure. | Partial: SecretStorage deletion can be command-driven for the runtime token, but a full controlled-agent state retention/deletion matrix for extension global/workspace state, output channels, webview state, packaged GUI files, and local runtime artifacts is not complete. | VS Code must not persist provider API keys, raw prompts, raw file bodies, diffs, replacements, command strings/output, provider payloads, private paths, or bridge dumps in extension settings or logs. |
| JetBrains plugin state | JetBrains persists app-level settings in `yet-ai.xml` for runtime URL, launch mode, engine path, LSP flag, and local runtime session token-like state; plugin runtime logs are redacted and bounded in focused tests. | Partial: README and tests cover thin-host boundaries, sanitized diagnostics, redacted logs, and fail-closed controlled action parsing. | Partial/blocked: settings deletion and log retention are IDE-owned unless future Yet AI controls document a clear path. Full controlled-agent parity, retention, deletion, and support-bundle policy remain missing. | JetBrains must not persist provider API keys or duplicate provider adapters. Controlled execution remains partial/fail-closed where not explicitly verified. |
| Controlled run history | `014` defines a future sanitized local history contract: ids, timestamps, host/readiness/phase/result labels, counters, artifact references/checksums, and safe summaries only. | Implemented evidence is documentation-only. No production history store is implemented by that contract. | Blocked: retention by count/age/size, delete behavior, orphan artifact cleanup, migration, and unsafe-entry quarantine are future requirements. | History must never persist raw prompts, file bodies, replacement text, diffs, command material, full stdout/stderr, provider payloads, private paths, browser storage dumps, or bridge payloads. |
| Verification bundles and command evidence | Verification bundle v1 is metadata for fixed command ids and bounded output-tail evidence. VS Code command-run executor evidence exists for allowlisted commands. | Partial: schema/fixture validation and focused VS Code tests exist; S117 itself is metadata-only. | Partial/blocked: bounded tails and hashes are defined, but product-wide retention/deletion for command evidence, failed runs, and support exports is not complete. | Free-form commands, args, cwd, env, shell, git/package/network/provider/tool fields, raw output dumps, private paths, and secrets are forbidden. |
| Reports, exports, and trace details | GUI report/export helpers produce sanitized metadata-only summaries over provided run state. Dogfood beta validators reject raw sensitive evidence in templates. | Partial: deterministic validators and service tests cover major controlled-agent report/export paths and reject common raw-data categories. | Blocked: there is no complete user-facing export retention/deletion policy, support-bundle format, or exhaustive raw-data exclusion gate for all future export surfaces. | Shareable reports/exports may include labels, counts, statuses, command ids, hashes, durations, and bounded redacted tails only. |
| Dogfood documents and fixtures | Tracked dogfood docs and fixtures are sanitized templates and deterministic local/mock evidence. Completed real local BYOK reports should stay in ignored local evidence unless a task explicitly approves a sanitized tracked example. | Implemented evidence: templates reject secrets, raw prompts/responses, file bodies, diffs, replacements, raw command material, private paths, provider payloads, bridge dumps, hosted-service requirements, and release claims. | Partial: tracked templates define what not to store, but retention/deletion of local completed reports remains a user/local evidence process, not a product feature. | Manual BYOK dogfood is local evidence only and must not become CI or public proof containing credentials or raw provider data. |
| Package artifacts and dev-preview evidence | VS Code and JetBrains packages may bundle GUI assets, product identity, and engine binaries or extracted engine resources. CI/artifact workflows produce dev-preview validation outputs. | Partial: package and wrapper checks prove identity/safety for selected paths; JetBrains engine resource diagnostics avoid exposing extracted cache paths. | Blocked: artifact retention, update/rollback cleanup, uninstall cleanup, cache pruning, signing/notarization evidence, and support collection policy are incomplete. | Package artifacts must not include local user credentials, raw reports, raw logs, private paths, or completed dogfood evidence. Dev-preview artifact evidence is not release approval. |
| Public docs, examples, and fixtures | Public tracked files include schemas, safe examples, invalid examples, docs, and sanitized fixtures. | Implemented evidence: docs and validators reject public overclaims and unsafe evidence in many controlled-agent lanes. | Partial: validation exists, but future new docs/examples must keep extending checks when new raw-data categories appear. | Public tracked files must stay free of raw secrets, private paths, raw provider payloads, external project identifiers, and production/release/marketplace overclaims. |

## Forbidden raw-data categories

Controlled-agent storage, logs, reports, exports, docs, dogfood evidence, fixtures, package artifacts, and GUI-facing responses must not persist or expose these raw categories:

- provider credentials, API keys, OAuth material, auth codes, bearer tokens, runtime session tokens, cookies, auth headers, account identifiers, or secret-store records;
- raw user prompts, composer text, hidden/system instructions, provider request payloads, model transcripts, raw provider responses, provider tool payloads, completion payloads, or raw model tool-call data;
- raw file bodies, selected excerpts beyond visible in-memory use, hidden workspace data, indexed workspace content, generated/dependency traversal content, binary content, or symlink targets;
- replacement text, raw diffs, patch bodies, before/after file bodies, rollback file bodies, edit hunks, or workspace mutation payload dumps;
- free-form command strings, args, cwd values, env values, shell scripts, git/package commands, process environment markers, full stdout, full stderr, terminal transcripts, or unbounded output tails;
- private absolute paths, including macOS, Linux home, Windows, network-share, POSIX temp/cache/mount-style roots, checkout roots, symlink targets, stack traces with private locations, or `file:` URL references;
- runtime URLs or file URLs containing userinfo, query secrets, fragment secrets, token-like parameters, authorization codes, API-key fields, cookie values, or verifier values;
- browser storage dumps, IndexedDB dumps, webview postMessage dumps, bridge payload dumps, runtime HTTP/SSE payload dumps, request-body dumps, support-bundle dumps, or CI logs containing the categories above;
- provider/bridge payload dumps labeled as raw responses, response dumps, provider output dumps, provider requests, provider payloads, bridge payloads, postMessage dumps, runtime HTTP dumps, SSE payload dumps, or raw requests;
- production, release, marketplace, signing, notarization, publication, real-provider CI, hosted-service, account, managed gateway, product-credit, or cloud-workspace claims for this dev-preview path.

If future code receives one of these categories while producing controlled-agent metadata, it must fail closed, omit the unsafe value, and record only a bounded safe label such as `blocked_unsafe_payload`, `redacted`, `omitted_private_path`, or `artifact_omitted_unsafe`. Do not hash-and-display raw sensitive text unless a later security review explicitly approves the derived field.

## Retention and deletion gaps

The following controls are not done and must remain future hardening requirements:

1. A product-level local retention policy for controlled-agent history, reports, exports, logs, support bundles, package artifacts, runtime cache, and dogfood evidence.
2. User-facing deletion controls for sanitized history, local exports, local dogfood evidence, runtime logs, extension output, JetBrains settings/logs, extracted engine caches, and package update artifacts.
3. Migration rules for any future persisted controlled-agent records, including unsafe unknown-field quarantine or deletion behavior.
4. Cross-host inventory of actual file locations for VS Code settings/SecretStorage/output channels, JetBrains app settings/logs/cache, engine config/cache/project directories, package caches, and local report locations.
5. End-to-end redaction tests for support-useful exports and logs across successful runs, failed verification, provider timeout/error, runtime disconnect, stale result, edit mismatch, stop, repair exhaustion, and unsupported hosts.
6. A deterministic check that every new controlled-agent report/export/history/log fixture rejects raw prompt, file, diff, replacement, command, output, provider, token, private-path, browser-storage, and bridge payload categories.
7. Clear separation between deterministic local/mock CI evidence and optional manual local BYOK reports, including explicit non-ingestion of real credentials or raw provider responses into CI.
8. Package artifact retention and cleanup policy for dev-preview bundles, extracted engines, copied GUI assets, generated IDE packages, and local install/update/reconnect evidence.

## Future evidence required before stronger claims

Before any production-like, release-like, marketplace-like, or broader autonomy decision, future cards need dated evidence for:

- browser-storage audits across all controlled-agent panels and export/report buttons;
- GUI state clear behavior and stale-state fail-closed behavior for proposals, search selections, context bundles, verification bundles, reports, trace entries, and follow-up drafts;
- engine storage map with file names, schemas, secret-store behavior, provider-auth state, chat history, project memory, demo mode, cache, and deletion behavior;
- VS Code SecretStorage/settings/output-channel/webview-state inventory and deletion guidance;
- JetBrains app settings, runtime/LSP logs, extracted engine cache, and deletion guidance;
- dogfood completed-report local storage rules and public-safe sanitization review;
- export/support-bundle schema, raw-data negative fixtures, and retention controls;
- package artifact/cache retention, update/rollback cleanup, and uninstall expectations;
- manual local BYOK report review across provider/runtime families without credentials, raw prompts, raw responses, private paths, or hosted Yet AI service requirements.

## Verification for this document

Run from the repository root:

```sh
npm run check
git diff --check
```

Passing those commands proves repository validation and whitespace hygiene for this documentation update only. It does not prove retention/deletion controls, support-bundle safety, package cleanup, real-provider behavior, production autonomy, release readiness, marketplace readiness, or cross-host parity.

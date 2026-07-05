# Yet AI Documentation

This directory stores durable documentation for Yet AI architecture, decisions, and future implementation. Documentation should help agents make incremental changes while keeping Yet AI a standalone local-first product.

## Layout

```text
docs/
  README.md             # documentation index
  architecture/         # architecture baselines, decisions, contracts, roadmaps
```

Additional local evidence templates live under `docs/dogfood/`, including the real-provider active-file chat report, the manual real coding task dogfood checklist, the historical one-step Agent Run dogfood checklist, the safe-share Agent Run one-step report template, and the S70 manual Agent Run RC checklist/report template. S65 coding task session backbone status is documented in `architecture/003-target-architecture.md`: it is a GUI-local metadata summarizer over explicit goal/context/memory/proposal/apply/verification/trace inputs only, not an endpoint, bridge message, model request, runner, autonomy layer, hidden read, provider call, or workspace mutation path. The focused local/transpiled service smoke is `npm run smoke:coding-task-session`; it uses no runtime, provider, browser, IDE, shell/git/tool, storage, or network authority and remains explicit rather than part of `npm run check`. S69 task memory suggestions are documented in `architecture/013-agent-readiness-milestone.md`: they are GUI-local display metadata over already-listed project memory note metadata, and a note is added to the one-shot bundle only after an explicit user Attach click through the existing project-memory path. The focused local/transpiled service smoke is `npm run smoke:task-memory-suggestions`; it covers suggested/stale/unsafe/already-attached/unrelated statuses, no auto-attach, sanitized session/trace labels, runtime-context label exclusion, browser-storage cleanliness, and no automatic send/search/save/provider/bridge/workspace mutation. S71 multi-step task timeline status is documented in `architecture/012-coding-session-trace.md` and `architecture/013-agent-readiness-milestone.md`: it is read-only sanitized metadata UX over already-known GUI state, not an execution engine, not autonomy, and not raw-data or browser-storage persistence. The exact focused smoke is `npm run smoke:multi-step-task-timeline`; T-315 delivered this replacement smoke after the failed T-312 attempt, so T-312 is not successful evidence. Focused implementation checks are `cd apps/gui && npm test -- multiStepTaskTimeline MultiStepTaskTimelinePanel App` and `npm run check`. S64 readiness status is canonical in `architecture/013-agent-readiness-milestone.md`: current Agent Run dogfood is manual local dev-preview evidence only, S61/S62 are manual-only adjuncts for inert plan preview and draft-only follow-up/fix prompts, and S64 classification does not enable autonomy. The deterministic mock-only built-GUI validation for the safe-share Agent Run path is `npm run smoke:agent-run-dogfood`; it uses loopback-only runtime/host mocks and sanitized evidence, not real-provider CI. The inert multi-step Agent Run plan preview smoke is `npm run smoke:agent-run-multistep-plan`; it covers valid and rejected preview metadata with no automatic apply or verification bridge messages and no browser-storage leakage. The bounded Agent Run second-step follow-up loop smoke is `npm run smoke:agent-run-followup-loop`; it covers failed-verification fix drafts and successful-verification follow-up drafts as composer/focus-only actions with no automatic send, apply, verification, repair, rollback, attachment, or browser-storage persistence. The S66 proposal history/comparison smoke is `npm run smoke:proposal-history`; it transpiles the pure GUI proposal history service locally and asserts original, follow-up, rejected, applied, and verified proposal lineage remains bounded, redacted, metadata-only, and display-only with no apply, verification, runner, storage, browser, IDE, runtime, provider, shell/git/tool, or autonomy authority. These focused gates are separate from the heavier safety regression bundle. Run `npm run smoke:agent-run-safety-bundle` only before merging broad Agent Run safety-boundary changes when you need the curated model proposal, checkpoint readiness, apply, verification, S61 plan preview, and S62 follow-up-loop gates in one fail-fast optional pass.

## Where to add documents

- `docs/architecture/` — add architecture decisions, subsystem boundaries, protocol contracts, storage rules, product-sensitive audits, release packaging decision records, roadmaps, implementation plans, and risks.
- `docs/dogfood/` — add sanitized manual local evidence templates and checklists for dogfood runs; keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized tracked example.
- Implementation notes — add them next to the future subsystem when it exists, or in `docs/architecture/` if the note affects multiple subsystems.
- Decisions — record them as separate numbered architecture documents when they affect layout, identity, public protocols, storage, packaging, licensing, or long-term maintenance.

## Current architecture documents

- `architecture/000-reference-architecture-baseline.md` — baseline subsystem boundaries for the standalone product.
- `architecture/001-product-identity.md` — explains `product/identity.json` and how to avoid scattered product-sensitive hardcodes.
- `architecture/002-product-differentiation-and-provenance.md` — identity, legal/provenance, publication safety, and differentiation audit.
- `architecture/003-target-architecture.md` — target Yet AI subsystem boundaries, HTTP/SSE/LSP/postMessage contracts, storage isolation, and roadmap.
- `architecture/004-implementation-strategy.md` — implementation strategy and staged local-first delivery guidance.
- `architecture/005-publication-hygiene.md` — rules for keeping public tracked files clean before publication.
- `architecture/006-login-based-gpt-first-message.md` — future mandatory login-based GPT first-message milestone, official/experimental path split, and required gates.
- `architecture/007-provider-auth-feasibility.md` — provider-auth feasibility decision for OpenAI account-login evaluation, blocking production/default login until an official provider-supported local-app flow is approved.
- `architecture/008-reference-divergence-guardrails.md` — public-safe guardrails for using reference implementations as architectural signal without copying identity, source, assets, or public wording.
- `architecture/009-runtime-lifecycle-roadmap.md` — runtime lifecycle ownership, metadata-only `host.runtimeStatus` diagnostics, IDE/browser parity matrix, and future daemon-lite decision criteria.
- `architecture/010-tool-authority-and-edit-pipeline-roadmap.md` — current safe-edit proposal baseline and future deny-by-default tool authority/edit-apply policy layers.
- `architecture/011-sandbox-agent-prerequisites.md` — conservative prerequisites for any future experimental sandbox-agent mode, including opt-in, checkpoints, rollback, limits, allowlisted verification, and no hidden reads or broad authority.
- `architecture/012-coding-session-trace.md` — GUI-local read-only coding-session trace model, event families, sanitization rules, in-memory scope, and non-authority boundaries.
  It also records the adjacent Sprint 41 experimental sandbox session metadata boundary: sanitized readiness/checkpoint/rollback status only, with no sandbox agent, bridge command, runtime endpoint, execution authority, or agent loop.
  It now also records the Sprint 42 bounded patch verification loop metadata boundary for one explicit user-confirmed apply plus one allowlisted verification command, with no autonomous loop or new execution surface.
  Sprint 43 deterministic local smoke coverage for the one-step Agent Run shell is available with `npm run smoke:agent-run-state`; it uses mock host events plus disposable checkpoint/patch helpers and must stay free of provider, IDE, network, shell, git, browser-storage, or hidden workspace-scan authority.
  Sprint 44 deterministic model-proposal coverage is available with `npm run smoke:model-proposal-agent-run`; it exercises the pure one-step prompt/proposal services with valid and rejected mock assistant responses, proves prompt explicit-context-only wording, strict safe-edit recognition, fail-closed malformed/unsafe proposal handling, sanitized repair guidance, no browser storage, and no auto apply or auto verification.
  Sprint 45 deterministic checkpoint-readiness coverage is available with `npm run smoke:agent-run-checkpoint-readiness`; it composes the model-proposal, real disposable checkpoint, readiness, bounded-loop, and Agent Run state services to prove verified checkpoint metadata can reach `ready_for_apply`, while missing or unverified checkpoint metadata remains prerequisites-blocked with no apply or verification.
  Sprint 46 deterministic explicit-apply coverage is available with `npm run smoke:agent-run-apply`; it exercises the pure Agent Run apply/state/report/trace services to prove verified readiness reaches `ready_for_apply`, no apply request is emitted before an explicit click, the click uses the existing `gui.applyWorkspaceEditRequest` bridge request, a mock host apply result reaches `ready_for_verification`, and rejected/failed apply results stop with rollback metadata and no automatic retry.
  Sprint 47 deterministic explicit-verification coverage is available with `npm run smoke:agent-run-verification`; it exercises the pure Agent Run verification/state/report/trace services to prove applied metadata reaches `ready_for_verification`, no verification request is emitted before an explicit click, the click uses the existing `gui.ideActionRequest` bridge request with `commandId` only, mock progress/result metadata reaches verified/completed report state, and failed verification stops without automatic repair while rollback remains user-review only when metadata exists.
  Sprint 48 built-GUI one-step Agent Run coverage is available with `npm run smoke:agent-run-e2e`; it builds and loads the GUI with mock runtime/provider/bridge/host data, drafts the one-step safe-edit prompt, sends only after manual Send, confirms no automatic apply or verification, then clicks explicit Apply and explicit allowlisted Verify before asserting a sanitized final report. It also covers failure paths for malformed proposal rejection with no apply, missing checkpoint prerequisites blocked with no apply, failed verification stopping without automatic repair, and stale assistant responses ignored after runtime/chat correlation changes.
  Sprint 63 added `npm run smoke:agent-run-safety-bundle` as an explicit fail-fast root script for curated Agent Run safety regressions. Keep this bundle explicit and failure-preserving: it is a local/mock safety regression gate for Agent Run boundaries, not part of `npm run check`, and it must not be described as real-provider, production autonomy, marketplace, or hosted-service evidence.
  Sprint 49 final architecture status records the implemented Agent Run as dev-preview, manual-only, checkpoint-gated, and limited to existing bridge surfaces: explicit Apply through `gui.applyWorkspaceEditRequest` and explicit command-id-only Verify through `gui.ideActionRequest`. It remains non-autonomous and adds no hidden reads, new execution surface, shell/git/tool/provider-tool authority, browser-storage persistence, or production autonomy claim.
  The S49-C5 final product safety audit closes the S45-S49 trail with no blocking findings: App, AgentRunPanel, bridge guards, Agent Run services, bounded patch/evaluation, edit proposals, smokes, and docs preserve manual Send/Apply/Verify, GUI-owned or host-owned correlation, command-id-only verification, sanitized in-memory trace/report output, and local-first BYOK boundaries.
- `architecture/013-agent-readiness-milestone.md` — S64 conservative Agent Run readiness taxonomy, current browser/VS Code/JetBrains/manual-flow status matrix, blocked/deferred capabilities, and future controlled-autonomy eligibility gates.
  It also records S71 multi-step task timeline status as read-only sanitized metadata UX only, with no execution engine, autonomy, raw-data persistence, or browser-storage persistence.

## Current login-first milestone status

The current milestone is local-first and conservative:

- API-key or project-key provider setup through the local runtime is the safe/default real-provider path.
- Demo Mode is a no-key local trial for chat UX with canned local responses only.
- The experimental Codex-like provider-auth path is high-risk, non-default, and mock-only in automation.
- Official production OpenAI/ChatGPT account login is not implemented, not approved, and not claimed as supported.
- Core chat, provider setup, IDE GUI workflows, and local storage must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.
- Native Ollama provider support is documented as direct local-engine access to the user's configured Ollama server at default `http://127.0.0.1:11434`, with auth type `none` and no Yet AI hosted service or provider secret requirement.
- Current IDE/plugin artifacts and smokes are dev-preview verification surfaces only; they do not imply marketplace publication, signing, notarization, installer readiness, or production release status.

## IDE surface capability matrix

This matrix summarizes current browser, VS Code, and JetBrains surfaces for local development and dev-preview evidence. It is intentionally conservative: supported means implemented for the bounded local-first flow described here, preview-only means visible or contract/smoke-covered but not production support, and deferred means not implemented as an active user feature. None of these surfaces require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production account login, marketplace publication, signing, or real provider credentials in automation.

| Capability | Browser / standalone GUI | VS Code | JetBrains |
| --- | --- | --- | --- |
| Active context | Preview-only mock/fallback rendering; no IDE workspace authority | Supported dev-preview via bounded `host.contextSnapshot`, opt-in, one-shot prompt context | Supported dev-preview via the same bounded `host.contextSnapshot`, opt-in, one-shot prompt context |
| Multi-file context | Preview-only explicit bundle UI; no hidden workspace reads | Supported dev-preview only through explicit user-selected active-file/snippet/memory/verification bundle items, capped and one-shot | Supported dev-preview only through the same explicit capped one-shot bundle path |
| Memory | Supported local GUI/runtime project-memory MVP; manual notes only, no browser storage persistence | Supported through GUI/runtime local memory flow; plugin does not store raw memory or secrets | Supported through GUI/runtime local memory flow; plugin does not store raw memory or secrets |
| Snippet search | Preview-only/non-executing in browser harnesses | Preview-only explicit literal `searchWorkspaceSnippets` contract/smoke path; no indexing, regex/glob/path input, or background scans | Preview-only explicit literal `searchWorkspaceSnippets` contract/smoke path with the same no-index/no-background-scan boundary |
| Safe edit apply | Preview-only review UI; browser never mutates files | Supported dev-preview confirmed apply path after GUI apply plus VS Code user confirmation; bounded text replacements in existing workspace-relative files only | Dev-preview confirmed apply path through existing apply/result bridge after GUI apply plus IDE/user confirmation; no production apply claim |
| Verification commands | Preview-only/non-executing; no shell authority | Historical/manual allowlisted `runVerificationCommand` rendering can remain sanitized, but S84 controlled-agent verification posting/execution is disabled until S85; no free-form shell/args/cwd/env/git/network | Historical/manual allowlisted verification rendering can remain sanitized, but S84 controlled-agent verification posting/execution is disabled until S85 |
| Controlled runner | Supported as a user-driven GUI smoke/flow only; no auto-send/apply/run | Supported dev-preview UI flow using explicit context and safe-edit controls; S84 verification control is disabled/S85-required; no autonomous execution | Supported dev-preview UI flow with the same S84 verification-disabled boundary; no autonomous execution |
| LSP | Not applicable; browser has no editor LSP host | Preview-only off-by-default read-only MVP/status proof over `yet-lsp --lsp-stdio`; no provider-backed completions or diagnostics | Deferred/foundation only; native IntelliJ LSP client/editor wiring is not implemented or claimed |

Known limitations: real-provider use still requires user-supplied local credentials; account-login feasibility remains blocked until an official provider-supported local-app flow is documented and approved; the Codex-like path must not use real accounts in CI or smoke automation.

## Icon asset convention

The source icon asset is `assets/identity/yet-ai-icon.svg`; PNG derivatives live next to it. VS Code and JetBrains dev-preview plugin icons are derived copies under their plugin folders. The root `npm run check` bundle validates that these icon files exist, that SVG files remain self-contained with no scripts or remote image references, and that plugin copies match the source assets.

## Versioning policy follow-up

Current package and plugin versions remain static dev-preview values (`0.0.1` for VS Code and `0.1.0` for JetBrains). Do not bump them for routine dev-preview docs/assets changes. Before release automation or any production publication claim, add a single version source and an artifact manifest consistency check across generated plugin artifacts.

## Dev-preview packaging boundary

Current IDE artifacts are install-from-file dev-preview evidence only. Local `dist/plugins/vscode/*.vsix`, local `dist/plugins/jetbrains/*.zip`, CI downloadable artifacts, checksums, and manifests are unsigned and unpublished validation outputs. They prove local package layout, packaged GUI freshness, identity metadata, safe archive paths, and loopback/mock startup checks; they do not prove marketplace publication, signing, notarization, a production installer, an update channel, or production release readiness.

`npm run artifact:manifest` writes the bounded dev-preview provenance manifest at `dist/plugins/manifest.json`. That manifest records the source commit, generation timestamp, runner platform, plugin artifact paths and SHA-256 checksums, bundled engine binary name/path/SHA-256, and explicit `signed: false`, `published: false`, and `notarized: false` status. `npm run smoke:github-ide-artifacts` validates the embedded manifest after local GitHub artifact staging. These checks are deterministic/local and do not sign, notarize, publish, upload marketplace packages, call providers, or include secrets/private paths.

The bundled `yet-lsp` in those artifacts is a local Cargo build staged from the checkout or CI runner for dev-preview testing. It is not a signed or notarized production engine. Future production packaging decisions still need durable records for marketplace publisher/vendor IDs, signing and notarization, installer or archive format, platform engine matrix, update and rollback policy, artifact retention, release provenance/SBOM expectations, and manual release approval gates. Until those records are implemented and verified, docs should keep production release wording explicitly framed as dev-preview, not implemented, planned, or future decision work.

## Verification

Run the root validation command after documentation or identity changes:

```sh
npm run check
```

### S63 Agent Run stability and verification guidance

S63 keeps the Agent Run verification story focused on the manual-only S61/S62 surfaces instead of turning browser smokes into default release gates. For documentation-only or identity-only changes, `npm run check` remains the required root validation command. For Agent Run behavior changes, use the focused gates documented below for the changed surface first, then add built-GUI smokes only when the rendered manual flow is affected.

For the S65 coding task session backbone, run:

```sh
npm run smoke:coding-task-session
```

The smoke transpiles and imports the pure GUI service locally, builds representative empty, goal/context, memory, proposal, apply, verification, and trace snapshots, and asserts `authority: "metadata_only"`, `cloudRequired: false`, `executionAllowed: false`, conservative no-auto policy flags, unsafe marker omission/redaction, and bounded output. It is deterministic local/mock evidence only: it does not launch a runtime, browser, or IDE; call providers or hosted Yet AI services; use credentials; read hidden workspace files; execute shell/git/tool endpoints; mutate workspaces; persist browser storage; or prove runner/autonomy readiness. Keep this focused smoke explicit and outside `npm run check` unless a future card intentionally changes the default validation bundle.

For the S66 proposal history and comparison metadata boundary, run:

```sh
npm run smoke:proposal-history
```

The smoke transpiles and imports the pure GUI proposal history service locally, builds representative original, follow-up, rejected, applied, and verified proposal states, and asserts `authority: "metadata_only"`, conservative no-authority policy flags, bounded entries/diagnostics/labels, sanitized touched-file labels, redacted unsafe metadata, and no raw prompt, diff, file-body, command, output, provider/tool payload, secret, or private-path leakage. S66 is display/history metadata only: it is not apply authority, verification authority, proposal persistence, a runtime endpoint, bridge message, browser-storage contract, model/provider call, runner instruction, guided-fix loop, controlled-autonomy feature, or production support claim. Keep this focused smoke explicit and outside `npm run check` unless a future approved card changes the default validation bundle.

For the S69 task memory suggestions boundary, run:

```sh
npm run smoke:task-memory-suggestions
```

The smoke transpiles and imports pure GUI services locally, builds mock project memory notes for suggested, stale, unsafe, already-attached, and unrelated states, and asserts `authority: "metadata_only"`, explicit attach-only policy flags, no auto-attach before click, stale/unsafe warning labels without raw unsafe text, explicit attach updating the one-shot bundle plus sanitized session/trace labels, display-only task/session/trace labels excluded from runtime chat context, clean browser-storage stand-ins, and no automatic send/search/save/provider/bridge/workspace mutation. S69 is display/suggestion metadata only: it is not memory indexing, hidden reads, runtime storage authority, provider calling, a bridge endpoint, automatic context attachment, runner behavior, controlled autonomy, or production support. Keep this focused smoke explicit and outside `npm run check` unless a future approved card changes the default validation bundle.

For the S71 multi-step task timeline boundary, run:

```sh
npm run smoke:multi-step-task-timeline
```

The smoke builds the GUI, serves built assets from loopback, and drives deterministic mock runtime/SSE/provider/bridge/host data through explicit Send, explicit Apply, explicit allowlisted Verification failure, and a manual fix-draft state. It then expands the collapsed-by-default `Manual timeline` panel and asserts read-only sanitized metadata coverage for goal/context, task memory, proposal, apply, verification, follow-up/final-result labels, no timeline action buttons, no pre-action apply or verification bridge requests, no hidden runtime/provider/tool calls, loopback-only network, clean browser storage, and no raw prompt/file/diff/command/private-data leakage. T-315 is the replacement smoke evidence after the failed T-312 attempt; do not cite T-312 as successful. S71 is display metadata only: it is not an execution engine, not multi-step execution, not autonomy, not a runtime endpoint, not a bridge authority, not a storage contract, and not production or marketplace evidence.

For the S72 manual checkpoint decision boundary, run:

```sh
npm run smoke:agent-run-checkpoint-decision
```

The smoke builds the GUI, serves built assets from loopback, and drives deterministic mock runtime/SSE/provider/bridge/host data through the already manual Send, Apply, Verification, rollback-review, fix-draft, and follow-up-draft paths. It asserts checkpoint decision metadata for continue, stop, rollback review, and separate manual run outcomes; rollback remains review-only; no separate run is created; no repair, retry, rollback, send, apply, verification, hidden read, search, indexing, memory attach, or provider/tool call starts automatically; apply and verification bridge messages appear only after the existing explicit user clicks; browser storage stays clean; and rendered/service evidence does not leak raw prompts, file bodies, diffs, command/output material, private paths, or secrets. S72 is experimental manual-only UX: it is sanitized display metadata and guidance over existing Agent Run state, not autonomy, not production readiness, not a new runtime/bridge/storage surface, and not real-provider CI evidence.

For the S73 controlled workspace readiness boundary, run:

```sh
npm run smoke:controlled-agent-workspace-readiness
```

The smoke builds the GUI, serves built assets from loopback, and drives deterministic mock `/v1/caps.controlledAgentWorkspaceReadiness` metadata through safe/inert default, explicit user opt-in display readiness, missing isolation, missing checkpoint, missing rollback, future-ready, and unsafe-redaction cases. It asserts the panel/evaluator remain metadata-only, future-gated, collapsed by default, and unable to start an agent; a future-ready fixture still has no Start Agent or Create Worktree control and all authority flags remain false. It also asserts no bridge apply/verify/read/search/rollback messages, no runtime tool/git/shell/provider endpoints, no non-loopback network, clean browser storage, and no private path, secret, raw prompt/file/diff/command/log leakage. S73 is not worktree creation, not checkpoint creation, not controlled runtime execution, not autonomy, not production readiness, not a new runtime/bridge/storage authority, and not real-provider CI evidence.

For the S74 bounded controlled file-read boundary, run:

```sh
npm run smoke:controlled-agent-file-read
```

The smoke creates its own disposable sentinel-marked workspace and exercises one explicit workspace-relative text file read with byte, line, body, and total-budget limits. It verifies success and truncation metadata plus fail-closed traversal, absolute/private, hidden, secret, dependency, generated/build, symlink, binary, oversized, glob/search, and budget-exhaustion cases. The smoke output is sanitized metadata only: no raw file bodies, private temp roots, command strings, provider/tool payloads, or secrets. S74 is narrow controlled workspace file-read evidence only; it is not hidden context gathering, broad project search, indexing, write/apply authority, verification/command authority, provider/tool authority, agent start, production autonomy, real-provider CI, or S75+ execution capability.

The full S74 final gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentFileRead ControlledAgentWorkspaceReadinessPanel controlledAgentWorkspaceReadiness codingSessionTrace App && npm run build && cd ../.. && npm run smoke:controlled-agent-file-read && npm run check && git diff --check && git status --short
```

For the S75 allowlisted command-runner foundation, run:

```sh
npm run smoke:controlled-agent-command-runner
```

The smoke uses an internal command-id allowlist mapped to deterministic local Node actions for `repository-check`, `gui-app-tests`, and `engine-chat-tests`. It proves allowed success/failure/timeout metadata, unknown command blocking, raw command/cwd/env rejection, bounded timeout and output limits, sanitized output-tail evidence, and no raw command material, private paths, provider/tool payloads, or secrets in the final report. S75 is an allowlisted command-id metadata foundation only: it is not free-form shell, arbitrary command execution, model-provided commands, git/package/network authority, provider tool calling, a production runner, broad agent runtime, automatic verification, repair/retry/rollback, or controlled autonomy.

For the S76 controlled run state skeleton boundary, run:

```sh
npm run smoke:controlled-agent-run-state
```

The smoke transpiles the pure GUI run-state reducer and builds the GUI against loopback-only runtime mocks. It verifies the skeleton remains disabled until explicit user opt-in in reducer state, creates only GUI-local/mock run metadata from `/v1/caps`, renders metadata-driven planning/read/verification phases, supports visible Stop as local React state only, blocks unsafe metadata, and emits no hidden read/search/write/apply/verify/command/rollback/provider bridge or runtime authority. It also checks loopback-only network, clean browser storage, no real agent start, no worktree mutation, and no raw prompt/file body/command/private-path/secret leakage. S76 is a preview-only state skeleton: it is not a runtime loop, not autonomous execution, not production readiness, not a provider/tool surface, and not real-provider CI evidence.

For the S87 bounded repair eligibility boundary, run:

```sh
npm run smoke:controlled-agent-repair-loop
```

The smoke transpiles and imports the pure GUI repair-loop evaluator locally, then checks failed/timed-out verification eligibility, one-attempt exhaustion, explicit user confirmation before repair metadata, non-failed verification ineligibility, unsafe metadata blocking, user Stop behavior, and all-false authority flags. S87 is explicit bounded repair eligibility/UX evidence only: it is not automatic repair orchestration, not multiple repair attempts, not a runtime/provider loop, not hidden reads/search/indexing, not free-form shell/git/package/network/tool authority, not raw persistence, and not production autonomy.

The full S76 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentRunState ControlledAgentRunPanel controlledAgentFileRead controlledAgentCommandRunner App && npm run build && cd ../.. && npm run smoke:controlled-agent-run-state && npm run check && git diff --check && git status --short
```

For the S79 controlled progress/final report boundary, run:

```sh
npm run smoke:controlled-agent-progress-report
```

The smoke transpiles the pure GUI progress-report service locally and asserts deterministic disabled, running, stopped, failed, repair-exhausted blocked, completed, and unsafe-redacted reports. It verifies progress and terminal final reports contain sanitized phase/current-step labels, counters, limits, diagnostics, and fail-closed all-false authority flags only. S79 is sanitized metadata UI only: it does not start a controlled agent, execute a loop, read/search/write files, apply edits, run verification, repair, retry, roll back, call providers/tools, add runtime/bridge authority, persist raw browser data, or claim autonomy.

The full S79 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm run typecheck && npm run build && cd ../.. && npm run smoke:controlled-agent-progress-report && npm run check && git diff --check && git status --short
```

For the S80 controlled local agent MVP dev-preview evidence boundary, run:

```sh
npm run smoke:controlled-local-agent-mvp
```

The smoke transpiles the pure GUI MVP aggregation service locally and verifies disabled, blocked no-workspace, ready preview, running metadata flow, completed/stopped final reports, repair exhaustion, unsafe raw-marker fail-closed behavior, and all-false metadata-only authority flags. S80 is deterministic local/mock dogfood evidence only: it composes explicit user opt-in, controlled workspace readiness, bounded read metadata, edit metadata, allowlisted verification metadata, repair metadata, and progress/final-report metadata into sanitized labels and checklist state. It is not production autonomy, a real provider CI gate, broad workspace mutation, a shell/free-form command path, hidden read/search/indexing, raw prompt/file/diff/command persistence, a runtime endpoint, bridge authority, provider/tool calling, or an agent starter.

For the S81 final execution-gap audit, run the two focused S81 smokes:

```sh
npm run smoke:controlled-agent-edit-executor
npm run smoke:controlled-agent-failure-modes
```

The edit executor smoke applies one bounded replacement inside its own disposable local/mock workspace and blocks unsafe edit-executor cases such as absolute or traversal paths, hidden files, symlinks, binary files, oversized patches, unsupported create/delete/rename operations, hash mismatch, raw diff/body fields, and private-path leakage. The failure-mode smoke transpiles pure GUI services and verifies deterministic stopped/failed/blocked states for unsafe metadata, duplicate terminal events, timeout/runtime-limit/stuck reasons, malformed edit metadata, edit hash mismatch, failed/killed/timed-out verification metadata, malformed provider metadata, and sanitized progress/final reports. S81 closes the S77/S78 execution-gap and failure-determinism audit trail before real autonomy: it is still deterministic local/mock evidence only, not a production autonomous loop, not a real one-step model loop, not provider/tool calling, not shell/git authority, not hidden workspace reads, not broad mutation authority, and not real-provider CI.

The full S81 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm run typecheck && npm run build && cd ../.. && npm run smoke:controlled-agent-edit-executor && npm run smoke:controlled-agent-failure-modes && npm run check && git diff --check && git status --short
```

For the S82 controlled runtime session metadata boundary, run:

```sh
npm run smoke:controlled-agent-runtime-session
```

S82 adds a controlled runtime session envelope as metadata only. The contract, fixtures, pure GUI evaluator, UI/trace/report integration, and smoke evidence describe disabled, unsupported-host, precondition-blocked, ready, start-requested, open, stop-requested, and stopped lifecycle metadata with sanitized labels and all authority flags false. S82 does not start a real agent, does not implement a real one-step model loop, and does not execute reads, edits, verification commands, provider calls, tools, shell, git, network, rollback, or workspace mutation. Browser remains unsupported for controlled runtime session and must fail visibly as metadata-only. VS Code and JetBrains are future-capable only when explicit opt-in, controlled workspace readiness, checkpoint, rollback, correlation, bounded limits, and host-owned metadata preconditions are present; even then the status is review/evidence only, not execution authority. S83 is the later bounded-read execution slice described below.

The full S82 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentRuntimeSession controlledAgentRunState controlledAgentProgressReport && npm run typecheck && npm run build && cd ../.. && npm run smoke:controlled-agent-runtime-session && npm run smoke:controlled-local-agent-mvp && npm run smoke:controlled-agent-failure-modes && npm run smoke:controlled-agent-edit-executor && npm run check && git diff --check && git status --short
```

For the S83 real bounded controlled workspace text-read execution boundary, run:

```sh
npm run smoke:controlled-agent-real-file-read
```

S83 adds the first real bounded controlled workspace text read execution path. The only active execution path is an explicit GUI `gui.controlledAgentFileReadRequest`, posted after a user click, correlated by request/run/workspace metadata, and handled by the VS Code host executor against one safe workspace-relative text file with byte and line budgets. JetBrains remains fail-closed/unsupported for actual reads in S83, and browser remains unsupported for controlled workspace reads because it has no trusted workspace host.

S83 does not add hidden or background reads, recursive search, glob or regex search, workspace indexing, provider/model calls, edit/write/apply authority, verification execution, shell/git/package/network/tool authority, rollback, task-board mutation, or controlled autonomy. Raw file bodies may be returned only inside the correlated host result needed for the explicit request; they must not be persisted in browser storage, trace, progress, final reports, docs, or smoke reports. S84 is still required for real bounded edit execution, and S86 remains the earliest honest point to claim any one-step controlled autonomy after separate bounded read, edit, verification, and loop gates land.

For the S84 real bounded controlled replacement edit execution boundary, run:

```sh
npm run smoke:controlled-agent-real-edit
```

S84 adds real bounded controlled replacement edit execution only for existing safe workspace-relative text files. A `gui.controlledAgentEditRequest` is posted only after explicit user click and is accepted only through request/run/runtime-session/workspace/readiness correlation with an expected `sha256:` content hash for the current UTF-8 file bytes. VS Code is the real S84 executor; browser remains unsupported, and JetBrains remains fail-closed with sanitized `edit_disabled` metadata. S84 does not allow create/delete/rename/move/chmod/directory/binary/symlink/generated/dependency edits, hidden/background edits, provider/model calls, verification execution, shell/git/package/network/tool authority, rollback, task-board mutation, raw file body/diff/replacement persistence, or controlled autonomy. Raw file bodies, diffs, and replacement text must not be persisted in browser storage, trace, progress, reports, docs, dogfood reports, or smoke output. S85 is still required for real allowlisted verification execution, and S86 remains the earliest honest one-step controlled-autonomy milestone.

In S84, the GUI controlled Agent Run path must not post `gui.ideActionRequest` for `{ action: "runVerificationCommand" }`. Older manual IDE verification evidence can still be rendered as sanitized historical/manual evidence, but real allowlisted controlled-agent verification execution is S85-required and must be shown as disabled/unsupported in S84 UI.

For the S85 real allowlisted controlled-agent verification execution boundary, run:

```sh
npm run smoke:controlled-agent-real-verification
```

S85 enables real allowlisted controlled Agent Run verification execution in VS Code only through `gui.controlledAgentCommandRunRequest` and `host.controlledAgentCommandRunResult`. The request is posted only after an explicit user click, is GUI-minted and correlated to controlled runtime/workspace/readiness/run metadata, and carries exactly one fixed allowlisted `commandId` (`repository-check`, `gui-app-tests`, or `engine-chat-tests`) with bounded timeout and output-tail limits. It carries no free-form command text, args, cwd, env, shell, package install, git, network, provider/tool, file read/write, hidden search/indexing, auto-run, auto-verify, or auto-fix authority. The VS Code host maps the command id to its internal allowlist and returns only sanitized tail-only result metadata: status, exit code where applicable, duration, bounded output tail, byte/line counts, hash, truncation, safe message, and all-false authority flags. Browser remains unsupported for execution, JetBrains remains fail-closed/unsupported for controlled verification execution, and older/manual VerificationCommandPanel evidence stays separate from this controlled Agent Run path.

S85 does not implement repair, retry, rollback, a provider/model loop, arbitrary shell execution, model-selected command text, task-board mutation, production autonomy, marketplace readiness, release readiness, or real-provider CI. S86 remains the earliest honest one-step controlled-autonomy milestone, and only after bounded read, edit, verification, loop, reporting, and safety gates are intentionally wired and verified.

For the S86 one-step experimental controlled loop smoke, run:

```sh
npm run smoke:controlled-agent-one-step-loop
```

S86 is the first intentionally named one-step controlled-autonomy dev-preview milestone, but only in the narrow experimental sense: one explicit Start can advance deterministic/mock metadata through one bounded read, one sanitized proposal step, one bounded replacement-edit metadata step, one allowlisted verification metadata step, and one sanitized terminal report. The smoke proves missing Start, blocked read, unsafe proposal metadata, explicit Stop, runtime disconnect, and repair attempts fail closed. It is not production autonomy, not multi-step execution, not real-provider CI, not marketplace or release readiness, and not a broad agent runtime. It grants no arbitrary shell, hidden reads/search/indexing, broad mutation, create/delete/rename/move edits, git/package/network/tool authority, provider tool calling, raw prompt/file/diff/command/output persistence, automatic repair, automatic retry, automatic rollback, task-board mutation, browser or JetBrains execution authority, or model-selected commands.

For the S89 controlled resilience smoke, run:

```sh
npm run smoke:controlled-agent-resilience
```

The smoke runs focused GUI and VS Code plugin checks for stale, duplicate, Stop, and runtime-disconnect resilience. It verifies controlled verification results are correlated before they can update Agent Run state, stale host results after chat changes, Stop, or runtime disconnect stay ignored, duplicate terminal results do not overwrite accepted state, the one-step loop stops on explicit Stop/runtime disconnect without repair, bounded repair stays user-confirmed and capped, and VS Code pre-ready or stale host-ready privileged messages fail closed with sanitized results. It is local/mock-only evidence: it does not add provider calls, a runtime loop, browser or JetBrains execution authority, hidden reads, free-form shell, git/package/network actions, auto-retry, auto-repair, rollback, task-board mutation, raw output persistence, production autonomy, marketplace readiness, release readiness, or real-provider CI.

For S88 useful-autonomy dogfood planning, use `docs/dogfood/s88-useful-autonomy-matrix.md`. The matrix defines deterministic useful small-task experimental fixtures for copy change, simple TypeScript fix, failing test fix, one-file code cleanup, and recovery copy. Each row stays within S86/S87 authority: one explicit Start, one bounded read, one sanitized proposal step, one bounded replacement edit, one allowlisted verification command id, and at most one bounded repair attempt when S87 repair metadata is available. The fixture files under `fixtures/s88/`, `npm run smoke:controlled-agent-dogfood`, and final useful-audit alias `npm run smoke:controlled-agent-dogfood-useful` are local validation evidence for sanitized fixture shape and matrix wiring only; they do not execute GUI orchestration, provider calls, workspace discovery, shell/git/package/network actions, or production autonomy.

The exact S85 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentCommandRunRequest App AgentRunPanel && npm run typecheck && npm run build && cd ../.. && cd apps/plugins/vscode && npm run compile && npm test -- controlledCommandRun webview && cd ../../.. && cd apps/plugins/jetbrains && gradle test --console=plain --tests ai.yet.plugin.bridge.ControlledEditTest --tests ai.yet.plugin.ui.ControlledEditBridgeTest && cd ../../.. && npm run smoke:controlled-agent-real-verification && npm run check && git diff --check && git status --short
```

The full S84 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentEditExecutor controlledAgentEditRequest controlledAgentRunState controlledAgentProgressReport App && npm run typecheck && npm run build && cd ../.. && cd apps/plugins/vscode && npm run compile && npm test -- controlledEdit && cd ../../.. && cd apps/plugins/jetbrains && gradle test --console=plain --tests "*ControlledEdit*" && cd ../../.. && npm run smoke:controlled-agent-real-edit && npm run smoke:controlled-agent-edit-executor && npm run smoke:controlled-agent-real-file-read && npm run smoke:controlled-agent-runtime-session && npm run smoke:controlled-local-agent-mvp && npm run check && git diff --check && git status --short
```

The full S83 final audit gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentFileRead controlledAgentFileReadRequest controlledAgentRunState controlledAgentProgressReport App && npm run typecheck && npm run build && cd ../.. && cd apps/plugins/vscode && npm run compile && cd ../../.. && npm run smoke:controlled-agent-real-file-read && npm run smoke:controlled-agent-file-read && npm run smoke:controlled-agent-runtime-session && npm run smoke:controlled-local-agent-mvp && npm run check && git diff --check && git status --short
```

For S80 documentation-only updates, use:

```sh
npm run check && git diff --check
```

The full S75 final gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- controlledAgentCommandRunner agentRunVerification codingSessionTrace App && npm run build && cd ../.. && npm run smoke:controlled-agent-command-runner && npm run check && git diff --check && git status --short
```

Focused S71 GUI checks are:

```sh
cd apps/gui && npm test -- multiStepTaskTimeline MultiStepTaskTimelinePanel App
npm run check
```

The focused Agent Run gates are:

- S61 inert plan preview: contracts, `agentRunPlanProposal`/`AgentRunPanel`/`App` GUI tests, GUI build, `smoke:agent-run-multistep-plan`, `npm run check`, and diff hygiene.
- S62 follow-up/fix drafting: contracts, `verificationFollowupPrompt`/`AgentRunPanel`/`App` GUI tests, GUI build, `smoke:agent-run-followup-loop`, `npm run check`, and diff hygiene.
- S63 stability docs or matrix updates: `npm run check`; run the S61/S62 focused gate only if the edited docs change an Agent Run contract, GUI behavior claim, or smoke boundary.
- S64 readiness status docs: `npm run check`; use `architecture/013-agent-readiness-milestone.md` as the canonical taxonomy and keep browser/VS Code/JetBrains status manual-only, local/mock where relevant, and non-autonomous.
- S71 multi-step task timeline docs: `npm run check`; run `npm run smoke:multi-step-task-timeline` and `cd apps/gui && npm test -- multiStepTaskTimeline MultiStepTaskTimelinePanel App` only when timeline behavior, rendered copy, or panel wiring changes.
- S72 checkpoint decision docs/smoke: `npm run smoke:agent-run-checkpoint-decision && npm run check && git diff --check`; S72 remains experimental manual-only display metadata, with rollback review-only and no auto-send/apply/verification/repair/retry/rollback, hidden reads/search/indexing/memory attach, new bridge/runtime/storage authority, production readiness, or real-provider CI claim.
- S73 controlled workspace readiness docs/smoke: `npm run smoke:controlled-agent-workspace-readiness && npm run check && git diff --check`; S73 remains future-gated readiness metadata only, with no agent start, no worktree/checkpoint creation, no apply/verify/read/search/rollback bridge authority, no runtime shell/git/tool/provider endpoint, no browser-storage raw persistence, no production readiness, and no autonomy claim.

The built-GUI smokes (`npm run smoke:agent-run-multistep-plan`, `npm run smoke:agent-run-followup-loop`, and the older one-step smokes) are local/mock-only Playwright checks. They build `apps/gui`, serve static assets from loopback, and use deterministic runtime/SSE/provider/bridge/host fixtures. They do not launch real IDEs, call real providers, use credentials, contact hosted Yet AI services, mutate workspaces, run shell/git/tool endpoints, or prove production autonomy.

The heavier Agent Run safety regression bundle remains optional and explicit. Use it when reviewing broad Agent Run safety changes or before a larger manual audit, not as a replacement for the narrower S61/S62 gates and not as part of `npm run check`. Keep its shell `&&` behavior failure-preserving so the first broken boundary stops the run.

Dependency prerequisites for the built-GUI smokes are local Node/npm dependencies at the repository root, `apps/gui` dependencies, and Playwright with a compatible Chromium browser installed for the current machine. If `apps/gui/node_modules` is absent or a broken local symlink, restore/install the local GUI dependencies before running the smoke. If Chromium is missing, install it through the local Playwright dependency workflow. These prerequisites are developer-machine setup only; they are not hosted-service, provider, account, marketplace, signing, or release requirements.

Vite may print chunk-size warnings during `apps/gui` builds. Those warnings are currently non-failing build warnings for local verification. Treat them as a prompt to review future bundle splitting if needed, not as a production-readiness claim and not as evidence that release packaging, marketplace publication, signing, notarization, installer work, or autonomous Agent Run behavior is complete.

For the Sprint 41 sandbox checkpoint/rollback substrate, run the focused disposable-workspace smoke:

```sh
npm run smoke:sandbox-checkpoint
```

The smoke creates only a temporary workspace with the `.yet-ai-disposable-workspace.json` sentinel, checkpoints explicit relative files, mutates and restores them, checks exact byte equality, and verifies fail-closed handling for unsafe paths, symlinks, large files, execution-like metadata, and background scan requests. It is local/disposable evidence only: it does not launch an IDE, call providers or hosted services, execute shell/git/tool commands, use network access, scan a real workspace, or print raw file bodies/private temp roots.

For the Sprint 42 bounded patch verification loop contract and documentation slice, run:

```sh
npm run validate:contracts && npm run check && git diff --check
```

This validates only strict schemas, positive fixtures, invalid fixtures, documentation, and diff hygiene. It does not apply patches, run verification commands, add bridge messages, launch runtimes, or start an autonomous loop.

For the Sprint 42 disposable bounded patch/checkpoint substrate and GUI-visible lifecycle smoke, run:

```sh
npm run smoke:bounded-patch-loop
```

The smoke creates only a sentinel-marked temporary workspace, checkpoints explicit existing relative files, builds a replacement-only bounded patch plan, and models the user-visible bounded loop with in-memory mock browser/bridge/host state. It proves proposal visibility, blocked readiness before checkpoint/policy metadata, explicit user apply through the existing `gui.applyWorkspaceEditRequest`, mock `host.applyWorkspaceEditResult`, explicit allowlisted verification through existing `gui.ideActionRequest` with `action: "runVerificationCommand"` and `commandId` only, mock host progress/result, sanitized bounded-loop trace families, clean browser storage, no non-loopback network requests, and no auto-send, auto-apply, auto-run verification, or auto-rollback. It also applies/restores locally after checkpoint/hash preflight and verifies fail-closed handling for unsafe paths, symlinks, binary/oversized files, patch limits, create/delete/rename/move intents, execution-like metadata, unknown verification ids, and background scan requests. It is deterministic local/mock evidence only: it does not launch a real IDE, spawn shell commands, call git/network/provider APIs, scan a real workspace, execute verification commands, or print raw file bodies/private temp roots.

For the Sprint 44 model-driven one-step proposal path, run:

```sh
npm run smoke:model-proposal-agent-run
```

The smoke transpiles and imports the pure GUI services locally, drafts a one-step safe-edit prompt from explicit attached context only, feeds mock assistant safe-edit responses into proposal correlation, and evaluates Agent Run readiness metadata. It covers both a valid strict safe-edit proposal and malformed/unsafe proposal rejection with sanitized repair guidance. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, auto-apply edits, or auto-run verification.

For the Sprint 45 model proposal plus real checkpoint readiness path, run:

```sh
npm run smoke:agent-run-checkpoint-readiness
```

The smoke transpiles and imports the pure GUI services locally, drafts a one-step safe-edit prompt from explicit attached context only, feeds a mock safe-edit proposal through proposal correlation, creates and verifies a disposable checkpoint for an explicit relative file, composes readiness metadata, and evaluates the Agent Run state. It covers the verified-checkpoint success path through `ready_for_apply` and the missing/unverified checkpoint failure path through `prerequisites_blocked`. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, auto-apply edits, or auto-run verification.

For the Sprint 46 explicit Agent Run apply path, run:

```sh
npm run smoke:agent-run-apply
```

The smoke transpiles and imports the pure GUI services locally, starts from mock proposal plus verified checkpoint readiness metadata, proves `ready_for_apply`, proves no apply request is emitted before the explicit user click, sends exactly one existing `gui.applyWorkspaceEditRequest` bridge message on click, correlates the mock host apply result into `ready_for_verification`, and covers rejected/failed apply results as stopped with rollback metadata and no automatic retry. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, add a bridge message, leak raw command/path/secret output, auto-apply edits, auto-run verification, auto-retry, or auto-rollback.

For the Sprint 47 explicit Agent Run verification path, run:

```sh
npm run smoke:agent-run-verification
```

The smoke transpiles and imports the pure GUI services locally, starts from mock proposal plus applied Agent Run metadata, proves `ready_for_verification`, proves no verification request is emitted before the explicit user click, sends exactly one existing `gui.ideActionRequest` bridge message on click with only `{ action: "runVerificationCommand", commandId: "repository-check" }`, correlates mock progress and result metadata into verified/completed report state, and covers failed verification as stopped with no automatic repair while rollback remains user-review only when metadata exists. It is deterministic local/mock evidence only: it does not launch an IDE, call providers, perform network requests, execute shell/git/tools, scan hidden workspace files, write browser storage, add a bridge message, leak raw command/path/secret output, auto-run verification, auto-repair, auto-retry, or auto-rollback.

For the Sprint 48 built-GUI one-step Agent Run E2E path, run:

```sh
npm run smoke:agent-run-e2e
```

The smoke builds the GUI, serves the built assets from loopback, and drives Playwright against deterministic mock runtime/SSE/provider/bridge/host data. It proves the manual one-step Agent Run journey at the rendered UI boundary: local goal entry, explicit context attachment, prompt draft, manual Send, no automatic apply or verification, explicit Apply through the existing reviewed edit bridge request, explicit allowlisted Verify through the existing `gui.ideActionRequest` with `commandId` only, sanitized final report rendering, malformed proposal rejection, missing checkpoint prerequisite blocking, failed verification stopping without repair, and stale assistant response rejection after correlation changes. It is mock/loopback-only evidence: it does not launch a real IDE, call providers or hosted Yet AI services, use real credentials, scan hidden workspace files, execute shell/git/tool endpoints, use non-loopback network, persist browser-storage secrets/context, auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, auto-rollback, or claim production autonomy.

Keep this smoke as an explicit verification gate rather than part of `npm run check` unless a future card approves browser/build smoke expansion for the default local validation bundle. It builds the GUI and launches Playwright, while `npm run check` remains the focused repository validation bundle for docs, identity, contracts, deterministic local validators, and safe self-tests that do not run browser or packaged IDE smoke gates.

For the S61 inert multi-step Agent Run plan preview path, the focused final gate is:

```sh
npm run validate:contracts && cd apps/gui && npm test -- agentRunPlanProposal AgentRunPanel App && npm run build && cd ../.. && npm run smoke:agent-run-multistep-plan && npm run check && git diff --check
```

The S61 smoke itself is still available as:

```sh
npm run smoke:agent-run-multistep-plan
```

Sprint 61 status: the multi-step Agent Run plan preview is implemented only as inert/manual review metadata. It is not multi-step execution, not an autonomous runner, not a production agent loop, and not a new bridge/runtime/tool surface. The contract requires `agent_run.multistep_plan`, `authority: "metadata_only"`, `cloudRequired: false`, `executionAllowed: false`, and manual-action policy flags that prohibit auto-send, auto-apply, auto-verification, auto-rollback, and hidden reads. The GUI parser maps accepted plans to `planPreview` display metadata only; it does not create safe-edit proposals, bounded-loop metadata, apply requests, verification requests, rollback requests, provider calls, hidden file reads, or scheduler instructions.

The smoke builds the GUI, serves the built assets from loopback, and drives Playwright with deterministic mock runtime/SSE/provider/bridge data. It covers a valid `agent_run.multistep_plan` preview and an unsafe rejected preview, asserts the preview remains review-only metadata, checks no automatic `gui.applyWorkspaceEditRequest` or `runVerificationCommand` bridge messages are emitted before explicit user clicks, and verifies browser storage does not persist raw prompts, diffs, file bodies, secrets, commands, or private paths. It is mock/loopback-only evidence: it does not call real providers, launch real IDEs, require hosted services, run shell/git/tool actions through the product, or grant execution authority.

For the S62 bounded Agent Run second-step follow-up loop, run:

```sh
npm run smoke:agent-run-followup-loop
```

The smoke builds the GUI, serves built assets from loopback, and drives Playwright with deterministic mock runtime/SSE/provider/bridge/host data. It covers both terminal verification outcomes after the explicit one-step Agent Run apply/verify path: failed verification drafts a sanitized fix prompt, and successful verification drafts a sanitized follow-up prompt. The draft action is intentionally bounded to writing the composer and focusing it; the smoke asserts no automatic chat send, apply request, verification request, repair, rollback, retry, context attachment, runtime execution-like endpoint, non-loopback network call, or browser-storage persistence of raw prompts, diffs, file bodies, secrets, command details, private paths, or follow-up drafts.

Sprint 62 final status: the second-step follow-up/fix loop is bounded prompt drafting only. It is not multi-step execution, automatic repair, automatic retry, automatic verification, automatic rollback, production autonomy, or a new bridge/runtime/tool authority surface. The GUI service and CTA path may use only sanitized verification metadata plus safe proposal/plan labels and user intent to place a draft in the composer; the user must review it and click Send manually for any model call. The local-first BYOK boundary remains unchanged: this path requires no hosted Yet AI backend, Yet AI account, managed gateway, product credit balance, cloud workspace, real-provider CI, publishing, signing, or release workflow.

For the S62 final safety/product audit gate, run:

```sh
npm run validate:contracts && cd apps/gui && npm test -- verificationFollowupPrompt AgentRunPanel App && npm run build && cd ../.. && npm run smoke:agent-run-followup-loop && npm run check && git diff --check
```

This focused gate validates contracts, prompt-building tests, Agent Run panel/App CTA behavior, GUI build, built-GUI follow-up loop smoke, repository docs/identity/hygiene checks, and diff hygiene. It is local/mock-only and should not be treated as real-provider, production autonomy, marketplace, hosted-service, or release evidence.

For the focused Agent Run safety regression bundle, run:

```sh
npm run smoke:agent-run-safety-bundle
```

Run this heavier explicit gate before merging changes that touch the manual-only Agent Run safety boundaries, especially model proposal parsing, checkpoint readiness, apply, verification, S61 multi-step plan preview, or S62 follow-up prompt drafting. It is not part of `npm run check`. The bundle is fail-fast, prints the failing step label, and preserves each independent smoke command's output. It is local/mock-only and failure-preserving: it does not hide failures, launch a real IDE, call providers or hosted Yet AI services, use credentials, scan hidden workspace files, execute shell/git/tool endpoints through the product, use non-loopback network, persist browser-storage secrets/context, auto-send, auto-apply, auto-run verification, auto-repair, auto-retry, or auto-rollback. If a dependency is missing, the bundle prints setup guidance for root Node dependencies, GUI dependencies, and Playwright Chromium.

`npm run check` runs the repository's local validation bundle: product identity, public hygiene, docs index coverage, IDE surface contract parity, docs validation, and focused self-tests/validators that are safe for the current checkout. It does not run the browser or packaged IDE smoke gates, call providers, require hosted Yet AI services, publish marketplace artifacts, or claim production release status.

### Sprint 10 verification matrix

| Area | Command | What it proves | Boundary |
| --- | --- | --- | --- |
| Repository docs, identity, hygiene, IDE surface validators | `npm run check` | Docs index validity, product identity, public hygiene, focused local validators | Local only; no provider calls, hosted Yet AI backend, publishing, signing, or release claim |
| Shared protocol contracts | `npm run validate:contracts` | Strict schemas and positive/invalid fixtures for engine, provider-auth, bridge, planner, and agent-progress boundaries | Contract validation only; no runtime provider login |
| Sandbox checkpoint smoke | `npm run smoke:sandbox-checkpoint` | Deterministic disposable-workspace checkpoint creation, exact-byte restore, fail-closed unsafe input cases, and sanitized metadata-only report boundaries | Local temp-dir only; no IDE launch, provider calls, hosted service, shell/git/tool execution, network, background scan, or raw file-body evidence |
| Rust provider-auth and chat regressions | `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat` | Engine-owned provider-auth state, sanitized responses, and chat behavior | Local tests; fake/mock credentials only |
| GUI app tests and build | `cd apps/gui && npm test -- App && npm run build` | Login-first/Demo/API-key fallback rendering and production web assets compile | GUI must not persist raw provider secrets or require hosted services |
| Login-first mock smoke | `npm run smoke:login-first-message` | API-key fallback precedence, mock provider-auth lifecycle, first canned message, sanitized evidence | Loopback/mock-only; no real OpenAI/ChatGPT account or provider call |
| Local provider first-message smoke | `npm run smoke:local-provider-first-message` | Native Ollama/local-provider setup becomes send-ready, sends one first message, streams a rendered assistant response, enforces runtime local auth, and checks sanitized evidence | Loopback/mock-only; no real Ollama, provider credentials, hosted Yet AI service, IDE launch, signing, publication, or non-loopback network |
| Demo Mode smoke | `npm run smoke:gui-demo-mode` | No-key local trial path and canned assistant response flow | Local canned responses only, not model quality or provider access |
| Project memory smoke | `npm run smoke:project-memory` | Manual local project memory create/list/search, explicit one-shot attach to chat, accepted-send clear, delete, browser-storage non-persistence, no hidden IDE workspace reads, and sanitized loopback/mock-provider boundaries | Local loopback runtime and one mock chat provider only; no workspace file reads, hosted Yet AI backend, cloud workspace, real provider call, or secret/private path evidence |
| Project memory v2 smoke | `npm run smoke:project-memory-v2` | Deterministic local project memory v2 curation/search/attach flow: create sanitized manual note, search, attach to the next message, send one prompt, assert memory context appears exactly once in the mock provider prompt, clear after accepted send, delete note, and check browser-storage cleanliness | Local loopback runtime and one mock chat provider only; no workspace indexing or hidden reads, no hosted Yet AI backend, cloud workspace, real provider call, non-loopback network, or secret/private path evidence |
| Task-linked memory contract | `npm run validate:contracts && npm run check && git diff --check` | Optional `taskLabel`, `sessionLabel`, and explicit `attachTraceLabel` metadata stays bounded, sanitized, and schema-owned for guided coding task display/linkage | Metadata only; no automatic memory attach, background indexing, hidden reads, raw prompts/provider responses, private paths, secrets, provider calls, or cloud workspace |
| Agent Run built-GUI fixture smoke | `npm run smoke:agent-run-built-gui-fixtures` | Reusable S48 fixture data for built-GUI one-step Agent Run smokes: mock runtime/provider readiness, explicit context, strict safe-edit assistant response, checkpoint metadata, bridge apply/progress/result, and sanitized evidence | Mock/loopback fixture data only; no non-loopback network, browser-storage persistence, shell/git/tool execution, hosted Yet AI backend, cloud workspace, real provider call, secrets, or private paths |
| Agent Run built-GUI E2E smoke | `npm run smoke:agent-run-e2e` | Deterministic built-GUI one-step Agent Run loop: local goal, one-step prompt draft, explicit context, manual Send, no auto apply/verify, explicit Apply, explicit allowlisted Verify, sanitized final report, malformed proposal rejection, missing checkpoint block, failed verification stop, and stale response ignore | Mock/loopback only; no auto-send/apply/run/repair, no browser-storage persistence, no non-loopback network, no shell/git/tool endpoints, no hosted Yet AI backend, no cloud workspace, no real provider call, and no secrets |
| Guided coding task smoke | `npm run smoke:guided-coding-task` | Deterministic built-GUI guided coding task loop with local goal draft, explicit mocked active context/snippet/memory attachments, one explicit mock send, safe edit proposal review, explicit apply result, explicit verification result attachment, and follow-up cue | Mock/loopback only; no auto-send/apply/run, browser-storage persistence, non-loopback network, shell/git/tool execution, hosted Yet AI backend, cloud workspace, real provider call, or secrets |
| Snippet search v2 smoke | `npm run smoke:snippet-search-v2` | Deterministic built-GUI explicit project-snippet flow: no auto-search while typing, one GUI-owned literal search request, bounded mock-host result selection, one-shot attach to Send, and post-send clear/no reuse | Mock/loopback only; no indexing, background reads, browser-storage persistence, non-loopback network, shell/git/tool endpoints, hosted Yet AI backend, cloud workspace, real provider call, or secrets |
| Verification loop v2 smoke | `npm run smoke:verification-loop` | Deterministic built-GUI edit→verify→follow-up loop with one explicit mock send, safe edit proposal review, explicit apply result, explicit allowlisted failed/succeeded verification progress/results, manual follow-up prompt draft, and explicit one-shot verification-output attachment | Mock/loopback only; no auto-send/apply/run/fix, no browser-storage persistence, no non-loopback network, no shell/git/tool endpoints, no hosted Yet AI backend, no cloud workspace, no real provider call, and no secrets |
| Controlled runner v2 smoke | `npm run smoke:controlled-runner-v2` | Deterministic built-GUI controlled runner manual lifecycle with local task goal, explicit active context/snippet/memory attachments, prompt draft, one explicit mock send, safe edit proposal review, explicit apply result, explicit verification result, manual follow-up draft, and explicit verification-output attachment | Mock/loopback only; no auto-send/apply/run, no browser-storage persistence, no non-loopback network, no shell/git/tool endpoints, no hosted Yet AI backend, no cloud workspace, no real provider call, and no secrets |
| Real coding task dogfood smoke | `npm run smoke:real-coding-task-dogfood` | Deterministic built-GUI dogfood UX loop with real-provider-like loopback readiness, local task goal, explicit mocked active context/snippet/memory attachments, drafted prompt, one manual mock send, one attached context bundle, and a mock coding answer | Mock/loopback only; no auto-send/apply/run, browser-storage memory/context/secret persistence, non-loopback network, shell/git/tool endpoint calls, hosted Yet AI backend, cloud workspace, real provider credentials, or real provider calls |
| Local runtime smoke | `npm run smoke:local` | Local chat/history/SSE loopback behavior and no-secret client-visible output | Loopback mocks only |
| IDE first-message smokes | `npm run smoke:vscode-first-message` and `npm run smoke:jetbrains-first-message` | Packaged GUI/IDE wrapper first-message behavior through local runtime paths | Dev-preview local smokes; no marketplace, signing, or production release claim |
| Engine LSP stdio smoke | `npm run smoke:lsp-stdio` | Spawned `yet-lsp --lsp-stdio` initializes, handles bounded editor-supplied `file://` document open/change/close, deterministic local completion/hover/document-symbol proofs, unsupported-method behavior, and shutdown | Local read-only engine smoke; no IDE launch, provider call, provider-backed completion, diagnostics, indexing, hosted service, or production support claim |
| VS Code read-only LSP proof | `cd apps/plugins/vscode && npm run compile && npm run check:engine-connection`; root `npm run smoke:lsp-stdio` | Off-by-default `yetai.lsp.enabled` client path, no-secret stdio process policy, bounded local `file` document sync, capability-gated completion/hover/document-symbol registration, and deterministic status proof | Opt-in dev MVP only; no AI completion, provider diagnostics, model calls on keystrokes, workspace mutation, or marketplace/release claim |
| JetBrains LSP feasibility/deferred outcome | `cd apps/plugins/jetbrains && gradle test --console=plain --tests "*JetBrainsLsp*"`; root `npm run smoke:lsp-stdio` | Default-disabled lifecycle/process/no-secret diagnostic guardrails plus documented T-15 blocked decision; native IntelliJ LSP client/editor wiring remains unimplemented until the platform dependency contract is proven | Feasibility and guardrails only; no JetBrains completion support, native client proof, provider-backed behavior, or production support claim |
| Release-candidate smoke | `npm run smoke:ide-release-candidate` | Aggregated engine LSP stdio smoke, installed-plugin/IDE visual, Demo coverage, and artifact gates without publishing | Verification surface only; does not publish, sign, notarize, upload marketplaces, launch real IDEs/JCEF automation, call providers, or create a release |
| Diff hygiene | `git diff --check` | No whitespace errors in tracked changes | Local git check |

For documentation-only login-first changes, run the focused acceptance gate:

```sh
npm run check && npm run validate:contracts && git diff --check
```

For the local IDE release-candidate smoke gate, run this root command:

```sh
npm run smoke:ide-release-candidate
```

The gate explicitly chains the local release-candidate subgates: repository contracts/checks, engine `yet-lsp --lsp-stdio` smoke coverage, GUI build plus packaged-GUI freshness, VS Code and JetBrains dev-preview preparation, plugin layout checks, VS Code and JetBrains installable artifact checks, VS Code and JetBrains first-message wrapper smokes, installed-plugin visual coverage, installed-plugin Demo Mode first-message coverage, login-first mock provider-auth first-message coverage, local runtime/chat/provider smoke, JetBrains bundled runtime startup, GitHub artifact staging/manifest validation, dogfood report safety checks, public artifact summary, and clean tracked git status. The LSP coverage in this gate is the spawned engine stdio smoke only: VS Code remains an off-by-default read-only MVP/status proof, and JetBrains remains a default-disabled lifecycle feasibility boundary with native IntelliJ LSP client/editor wiring deferred by the T-15 blocked decision. It is intentionally local/mock-only: it does not use real provider credentials, call OpenAI/ChatGPT or other providers, contact hosted Yet AI services, require a Yet AI account/cloud workspace/managed gateway/product credits, launch real IDEs/JCEF automation, sign, publish, upload marketplace packages, or create a production release. Failure and skip diagnostics should stay bounded and sanitized: no runtime/provider tokens, private paths beyond redacted diagnostics, request bodies, cookies, auth codes, raw provider responses, or raw document bodies.

For installed-plugin Demo Mode first-message coverage, run `npm run smoke:installed-plugin-demo-mode` from the root after preparing current packaged GUI assets. It orchestrates the VS Code and JetBrains wrapper-browser smokes with `--demo-mode-first-message` and is included in `npm run smoke:ide-release-candidate` after installed-plugin visual coverage. Demo Mode is runtime-owned no-key canned local response coverage for chat UX only, not model quality; it is local/mock-only, uses no provider credentials, makes no OpenAI/ChatGPT or other provider calls, contacts no hosted Yet AI services, performs no real IDE/JCEF automation, and does not sign, publish, or create a release.

For the login-based GPT first-message milestone foundation, run `cd apps/gui && npm run build` and then `npm run smoke:login-first-message` from the root. This is a bounded mock-only GUI/browser smoke against a loopback runtime stub: it exercises the experimental/non-default provider-auth lifecycle (`login_available` → `pending` → `connected`), preserves the API-key fallback copy, sends one first message through a canned local chat path, and writes sanitized visual evidence. It does not use real provider credentials, OpenAI/ChatGPT calls, hosted Yet AI services, real IDE/JCEF automation, signing, publishing, release flows, or production/default account-login enablement.

### Safe IDE dogfood reports

Use `npm run dogfood:ide-report -- --template` for local safe-share installed first-message reports, especially VS Code dogfood runs. The template/checker records artifact/checksum, launch mode, runtime status, provider path, first-message result, and second-message refresh result while excluding provider API keys, runtime tokens, auth headers/codes, secret URL query or fragment values, private absolute paths, raw provider responses, and bridge payload dumps. Keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized excerpt in tracked docs.

Use `npm run dogfood:real-provider-report -- --template` for manual real BYOK active-file coding chat evidence. Validate any completed local report with `npm run dogfood:real-provider-report -- --check path/to/local-report.md` before sharing. This helper is a sanitizer/template checker only: it does not call providers, launch runtimes, use real credentials, create CI evidence, or prove production release readiness. The checklist records commit/artifact, runtime launch mode, IDE/browser surface, non-secret provider/model ID, active-file excerpt attached/omitted status, first streaming answer result, no-secret checks, and known issues.

Use `docs/dogfood/real-coding-task.md` for manual guided coding task dogfood runs with a real local BYOK provider or local model runtime. The path requires a connected local runtime, locally configured/tested provider, drafted task goal, explicit context/snippet/memory attachments, reviewed prompt draft, manual Send click, and reviewed response. Its report template is sanitized: provider kind and non-secret model family/id only, no API keys or tokens, no production/default account login, no raw private paths, no raw prompts/provider responses, and no raw file bodies except bounded reviewed excerpts. This is manual local dogfood only; guided coding task CI remains mock/loopback-only and must not use real providers, hosted Yet AI services, cloud workspaces, production logins, publishing, signing, or release workflows.

Use `docs/dogfood/agent-run-one-step.md` for the current safe-share manual one-step Agent Run dogfood report with a real local BYOK provider or local model runtime. The template records commit or artifact, artifact checksums when applicable, host/browser surface, redacted provider kind, non-secret model label, explicit context attached or omitted, prompt reviewed before manual Send, model safe-edit proposal detection or rejection, checkpoint readiness, explicit Apply, explicit Verification, screenshot evidence paths, result summary, failure states, and follow-up issues. It forbids raw API keys, bearer tokens, cookies, auth codes, prompt dumps, raw file bodies, raw diffs or patch bodies, raw provider responses, private paths, command strings, cwd/env values, browser-storage dumps, bridge payload dumps, and full verification output. This is local-first safe-share evidence only; it must not require hosted Yet AI services, cloud workspaces, production logins, managed gateways, product credits, real-provider CI, publishing, signing, release workflows, or any production autonomy claim. The older `docs/dogfood/one-step-agent-run.md` remains available as the historical S49 checklist.

Use `docs/dogfood/manual-agent-run-rc.md` for manual local Agent Run RC dogfood evidence. Generate the template with `npm run report:agent-run-rc -- --template`, validate a local completed report with `npm run report:agent-run-rc -- --check path/to/local-report.md`, and run the built-in sanitizer self-test with `npm run report:agent-run-rc -- --self-test`. The checker is local-only and rejects provider secrets, bearer tokens, cookies, auth/OAuth/runtime tokens, private absolute paths, raw prompts, raw provider responses, raw file bodies, raw diffs/patch bodies, command strings, cwd/env values, browser-storage dumps, and raw bridge payload dumps. It is a safe-share evidence helper only, not production, marketplace, autonomy, real-provider CI, publishing, signing, notarization, hosted-service, or release-readiness proof.

For S70 Manual Agent Run RC evidence, keep the host matrix conservative: browser is limited to chat/provider/dev-preview review with no apply, verification, or IDE actions; VS Code is the primary manual local host for explicit Apply and allowlisted Verification; JetBrains is a dev-preview parity host. The exact required documentation gate is `npm run check`. The optional full curated local/mock RC bundle is `npm run smoke:agent-run-rc-bundle`; it is fail-fast evidence for existing manual boundaries only and must not be reported as production, autonomous, marketplace publication, release publication, hosted-backend, workspace-mutation, or real-provider CI evidence.

For S71 timeline dogfood observations, use the historical one-step checklist or the S70 RC checklist only to record sanitized display facts: the timeline is collapsed/read-only, metadata-only, has no action buttons, and does not persist raw data or timeline entries to browser storage. Do not paste raw prompts, provider responses, file bodies, diffs, command material, private paths, browser-storage dumps, or bridge payloads. Do not report S71 as multi-step execution, autonomy, production readiness, marketplace readiness, or real-provider CI evidence.

### Chat response refresh verification bundle

For local chat response refresh fixes, run this existing-command bundle from a clean checkout with Node, Rust, and GUI dependencies installed. The bundle stays local/mock-only and does not add a new build or smoke command:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cargo test -p yet-lsp
cd apps/gui && npm test -- chatViewState App && npm run build
cd ../..
npm run smoke:gui-demo-mode
npm run smoke:gui-runtime-e2e
npm run smoke:gui-conversation-history
npm run prepare:vscode-preview
npm run smoke:vscode-first-message
npm run prepare:jetbrains-preview
npm run smoke:jetbrains-first-message
npm run check
```

Use the focused GUI test filter above for the chat view reducer and `App` refresh behavior, then keep the browser/runtime, conversation history, and packaged first-message smokes in the same local pass before the final docs/identity check.

For GitHub issue #2's bounded visual GUI acceptance only, run `cd apps/gui && npm run build && cd ../.. && npm run smoke:gui-visual`. It reuses the local Demo Mode browser flow, sends two canned messages through loopback/mock runtime only, checks the immediate assistant responses, duplicate assistant bubble guard, and readable active conversation list text, then writes sanitized screenshot/DOM evidence under ignored `dist/visual-smoke/gui-demo-mode/`. This is not the default sprint checklist.

For the S25 guided coding task smoke, run `npm run smoke:guided-coding-task` from the repository root. It builds the GUI and uses deterministic Playwright mocks for the loopback runtime and IDE bridge to exercise the local coding task session panel, explicit context/memory/snippet attachment, one explicit mock send, safe edit proposal review, explicit apply result, and explicit verification result follow-up cue. It is mock-only and asserts no auto-send/apply/run, no browser-storage memory/secret persistence, no non-loopback network, and no shell/git/tool execution.

For the S26 mock real coding task dogfood smoke, run `npm run smoke:real-coding-task-dogfood` from the repository root. It builds the GUI and uses deterministic Playwright mocks for real-provider-like loopback readiness, local task-goal drafting, explicit active file/snippet/memory attachments, one manual Send click, one context bundle, and a mock coding answer. It is CI-safe and mock-only: no real provider credentials/calls, no auto-send/apply/run, no browser-storage memory/context/secret persistence, no non-loopback network, and no shell/git/tool endpoint calls.

For the S27 patch proposal quality smoke, run `npm run smoke:patch-proposal-quality` from the repository root. It builds the GUI and uses deterministic Playwright mocks for a loopback runtime/provider plus a mock VS Code bridge to exercise one fenced JSON safe edit proposal, exactly one extracted proposal, the quality summary/risk panel, browser preview-only behavior, explicit apply clicks, and applied/rejected host results. It is CI-safe and mock-only: no real provider credentials/calls, no auto-apply, no shell/git/tool or verification bridge actions, no non-loopback network, and no browser-storage proposal/secret persistence.

For the S28 verification loop v2 smoke, run `npm run smoke:verification-loop` from the repository root. It builds the GUI and uses deterministic Playwright mocks for a loopback runtime/provider plus a mock VS Code bridge to exercise one explicit mock send, safe edit proposal review, explicit apply, explicit allowlisted failed and succeeded verification progress/results, manual follow-up prompt drafting, and explicit verification-output attachment. It is CI-safe and mock-only: no real provider credentials/calls, no auto-send/apply/run/fix, no shell/git/tool endpoints, no non-loopback network, and no browser-storage proposal/output/secret persistence.

For the S30 controlled runner v2 smoke, run `npm run smoke:controlled-runner-v2` from the repository root. It builds the GUI and uses deterministic Playwright mocks for a loopback runtime/provider plus a mock VS Code bridge to exercise the manual controlled-runner lifecycle: local task goal, explicit active context/snippet/memory attachment, prompt draft, one manual Send click, safe edit proposal review, explicit apply, explicit verification, manual follow-up prompt drafting, and explicit verification-output attachment. It is CI-safe and mock-only: no real provider credentials/calls, no auto-send/apply/run, no shell/git/tool endpoints, no non-loopback network, and no browser-storage goal/context/memory/output/secret persistence.

This bundle is specific to chat response refresh, SSE, history, and packaged first-message regressions. It is not the default sprint checklist for unrelated roadmap work. Normal docs changes use `npm run check`; product/code changes should use focused subsystem gates and add smoke only for changed user journeys or recently fixed regressions.

## Documentation rules

- Write in Russian or bilingual style when useful; keep technical identifiers in English.
- Do not claim that implementation exists before code and verification exist.
- Mention assumptions and unknowns explicitly.
- Keep product identity references aligned with `product/identity.json`; temporary placeholders are allowed until final IDs, publishers, and domains are approved.
- Keep public tracked docs free of external project identifiers. Store private local reference notes only in ignored local files such as `AGENTS.local.md`, `.local/`, or `.agent-local/`.
- If future tasks approve third-party code or assets, document license and attribution requirements plus provenance before or alongside the copy.
- Update this index when a new documentation section or convention is introduced.

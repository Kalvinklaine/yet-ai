# 016 Controlled Host Capability Negotiation v2

This document defines the v2 design contract for controlled-agent host capability negotiation across Browser, VS Code, and JetBrains surfaces. It is a design record only. It does not add schemas, bridge messages, runtime endpoints, plugin handlers, GUI controls, workspace permissions, command execution, or production autonomy.

Capability negotiation v2 exists so the GUI can render honest host availability, unsupported states, and safety copy before any controlled-agent action is offered. Capability metadata is non-authority: a host may report that a capability is available, unavailable, degraded, or unsupported, but that report never grants permission to read files, apply edits, run verification, start an agent, call providers/tools, use shell/git/package/network actions, persist raw data, or bypass explicit user confirmation.

## Design goals

- Keep controlled-agent availability sanitized, host-owned, and fail-closed.
- Make Browser, VS Code, and JetBrains limitations visible before a user starts a dev-preview run.
- Preserve the S90/S91 partial decision: narrow experimental controlled local agent dev-preview evidence, VS Code-first, not production autonomy.
- Treat capabilities as diagnostics and prerequisites only, never as authority grants.
- Require request/result correlation for every implemented controlled path.
- Keep unsupported hosts visibly unsupported instead of silently hiding or widening authority.

## Non-goals

Capability negotiation v2 does not implement:

- production autonomy, production readiness, release evidence, marketplace evidence, or real-provider CI;
- browser trusted workspace execution;
- JetBrains controlled execution parity;
- hidden reads, background reads, workspace search, indexing, or file discovery;
- broad workspace mutation, create/delete/rename/move/chmod/patch authority, generated/dependency/binary/symlink edits, or raw diff/replacement persistence;
- arbitrary shell, free-form command text, args, cwd, env, git, package, network, provider-tool, local-tool, or model-selected command authority;
- automatic repair, automatic retry, automatic rollback, multi-step autonomous execution, or task-board mutation;
- raw prompt, provider response, file body, diff, replacement text, command, output, private path, secret, bridge payload, or browser-storage persistence.

## Capability metadata model

A v2 host capability snapshot is sanitized metadata produced by trusted host/runtime/GUI code. It may be shown in the GUI as readiness, limitation, or unsupported-state copy. It must not be treated as an executable command or permission object.

Recommended fields for a future contract are:

| Field | Meaning | Boundary |
| --- | --- | --- |
| `protocolVersion` | Capability contract version, such as `controlled_host_capabilities_v2`. | Version selection only; not authority. |
| `hostSurface` | One of `browser`, `vscode`, or `jetbrains`. | Display and policy routing only. |
| `capabilityStatus` | Per-capability status: `supported`, `preview_only`, `unsupported`, `disabled`, `degraded`, or `unknown`. | Must fail closed for anything except an explicitly supported implemented path. |
| `reasonCodes` | Sanitized fixed labels such as `browser_no_trusted_workspace_host`, `jetbrains_parity_not_verified`, or `missing_controlled_workspace`. | Safe diagnostics only; no raw paths or stack traces. |
| `correlationRequirements` | Required ids for request/result matching, such as request id, run id, runtime session id, controlled workspace id, readiness id, and host-ready id. | Preconditions for accepting evidence; not reusable authority. |
| `authorityFlags` | Conservative booleans for read/edit/verification/start/repair/shell/git/provider/tool authority. | Unsupported or absent flags are false. Unknown flags must be ignored or rejected. |
| `limits` | Bounded counts for bytes, lines, files, edits, verification timeout, output tail, and repair attempts. | Upper bounds only; not permission to use the full bound. |
| `safeLabels` | Host label, workspace label, command id labels, and limitation labels. | Sanitized display only; no private paths or raw command strings. |
| `lastVerifiedAt` | Optional local timestamp for when metadata was minted or checked. | Freshness hint only; stale metadata fails closed. |

Assistant output cannot mint or override this metadata. Browser storage cannot become the source of authority. If host metadata is missing, stale, malformed, mismatched, or authority-looking, controlled-agent actions must be disabled with a sanitized unsupported or blocked reason.

## Cross-host capability matrix

| Capability | Browser / standalone GUI | VS Code | JetBrains |
| --- | --- | --- | --- |
| Controlled host role | Preview-only surface for rendering sanitized metadata and local/mock dogfood labels. | Primary dev-preview trusted host for implemented explicit controlled paths. | Hosted GUI/manual parity surface with controlled execution limitations visible. |
| Controlled Start | May render disabled or preview-only labels, but must not start trusted workspace execution. | May be eligible only when explicit user Start, controlled runtime/workspace readiness, checkpoint/rollback metadata, limits, and correlation metadata are present. | Must fail closed unless a future verified parity card implements the same boundary. |
| Controlled read | Unsupported for trusted workspace execution; no controlled read bridge request may be posted. | Supported only for the implemented explicit bounded read path: one safe workspace-relative text file, user-controlled request, strict correlation, sanitized result, bounded limits. | Unsupported/fail-closed until future verified parity; must not read files through controlled-agent metadata. |
| Controlled edit | Unsupported; Browser never mutates files. | Supported only for implemented bounded replacement edit to an existing safe workspace-relative text file with expected `sha256:` pre-edit hash, explicit user-controlled flow, strict correlation, and sanitized result. | Unsupported/fail-closed for controlled execution parity unless a later verified implementation changes status. Existing manual hosted GUI surfaces do not imply controlled edit parity. |
| Controlled verification | Unsupported; Browser has no shell or IDE verification authority. | Supported only through implemented allowlisted command-id requests after explicit user click and controlled runtime/workspace/readiness correlation. No command string, args, cwd, env, shell, git, package, network, provider/tool, file read/write, hidden search/indexing, auto-run, or auto-fix authority. | Unsupported/fail-closed for controlled verification; must not post command-run bridge requests until a future verified parity card exists. |
| One-step controlled loop | Preview-only labels may describe the flow, but no trusted workspace execution starts. | Eligible dev-preview path only inside the S86/S91/S96 envelope: explicit Start, one bounded read, one bounded edit, one allowlisted verification, sanitized terminal report, and at most one user-confirmed repair attempt where available. | Fail-closed/unsupported for controlled execution parity until future verification proves support. |
| Repair eligibility | May render informational labels only. | At most one user-confirmed repair eligibility label inside existing bounded metadata; no automatic repair or repeated attempts. | Unsupported/fail-closed unless future verified parity is added. |
| Raw data handling | Must not persist raw prompts, file bodies, diffs, replacement text, commands, output dumps, bridge payloads, private paths, or secrets. | Must keep raw file/edit/verification material transient to the explicit host-owned path where unavoidable, then return sanitized metadata only. | Must keep unsupported results sanitized; no raw file, command, path, or bridge leakage. |
| Default state | Preview-only and unsupported for privileged actions. | Disabled until all required metadata, explicit user gesture, host readiness, and correlation preconditions are present. | Unsupported or disabled until verified parity exists. |

## Fail-closed defaults

Capability negotiation v2 defaults are conservative:

1. Missing capability snapshot means all controlled actions are disabled.
2. Unknown `hostSurface`, unknown capability names, unknown status values, or unknown authority flags fail closed.
3. Browser capabilities for controlled read, edit, verification, or run start are always preview-only or unsupported.
4. VS Code support exists only for already implemented controlled contracts and only after explicit user action.
5. JetBrains support remains honest and fail-closed for controlled execution gaps.
6. Stale metadata, mismatched ids, duplicate terminal results, changed chat/run/session/workspace ids, runtime disconnect, user Stop, or host-ready mismatch must block or ignore later evidence.
7. Capability metadata from assistant output, provider output, model text, browser storage, untrusted origin, or copied fixture data is invalid as authority.
8. Unsafe-looking raw fields such as command strings, cwd/env, absolute/private paths, raw file bodies, diffs, replacements, logs, stack traces, tokens, cookies, provider payloads, or bridge dumps must be rejected or redacted before display.

## Correlation requirements

Every executable controlled path that later uses capability metadata must mint and validate correlation in trusted code. Minimum correlation requirements are:

- GUI- or host-minted request id for the specific operation;
- controlled run id;
- runtime session id where a controlled runtime session exists;
- controlled workspace id;
- readiness or capability snapshot id/fingerprint;
- host surface and host-ready generation where the plugin provides one;
- operation kind and bounded capability name;
- explicit user gesture timestamp or equivalent trusted event marker.

Results are accepted only when the operation kind, request id, run id, runtime session id, controlled workspace id, readiness metadata, and host surface match the current active run. Stale or out-of-order evidence is sanitized and ignored. Correlation prevents accidental state advancement; it does not grant authority by itself. The sleepy goblin can hold the receipt, but it still cannot press the button.

## Host-owned authority boundaries

Controlled-host capabilities are host-owned and least-privilege:

- The GUI can render sanitized capability state and collect explicit user intent, but it cannot read files, write files, run verification, or bypass host policy.
- The engine can expose local runtime readiness and own provider/runtime policy, but capability metadata must not give it broad IDE workspace mutation or shell authority.
- The IDE host owns workspace file I/O and command execution for any implemented path, enforces its own platform policy, validates safe workspace-relative targets, and returns sanitized metadata.
- Assistant/model output is always proposal text or display metadata, never trusted capability metadata or request correlation.
- Provider capability metadata, model tool support, runtime readiness, and host availability labels are informational until a separate explicit controlled contract validates and executes an action.

## Unsupported-state copy

User-facing unsupported states should be short, fixed, and product-safe:

| State | Recommended copy |
| --- | --- |
| Browser controlled execution | `Browser preview can show controlled-agent metadata, but trusted workspace read, edit, and verification execution require an IDE host.` |
| VS Code missing readiness | `VS Code controlled dev-preview is disabled until controlled workspace, runtime session, checkpoint, limits, and correlation metadata are ready.` |
| VS Code supported path | `VS Code supports this bounded dev-preview path after explicit user action and host-owned validation.` |
| JetBrains controlled execution | `JetBrains controlled execution remains fail-closed until a future verified parity card adds support.` |
| Stale or mismatched metadata | `Capability metadata no longer matches the active run. Start or refresh the run manually before continuing.` |
| Unknown capability | `This host did not report a recognized controlled capability. The action stays disabled.` |

Do not phrase unsupported states as production restrictions, account restrictions, cloud upsell, release limitations, or hidden entitlements. The local-first BYOK contract remains unchanged: core workflows must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, real-provider CI, or production autonomy.

## Verification

For this design record, use the documentation and wording gate:

```sh
npm run audit:controlled-autonomy-wording && npm run check && git diff --check && git status --short
```

This gate validates wording hygiene, repository documentation checks, whitespace hygiene, and tracked status only. It does not call providers, require hosted services, execute controlled actions, publish artifacts, prove release readiness, complete cross-host parity, or approve production autonomy.

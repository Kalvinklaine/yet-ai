# 009 Runtime Lifecycle Roadmap

This note defines the current Yet AI runtime lifecycle boundary and the criteria for any future daemon-lite work. It is a roadmap and parity matrix only: it does not implement a daemon, background worker model, resumable background sessions, project picker, cross-IDE discovery service, or expanded bridge authority.

Yet AI remains local-first and BYOK. Core chat, provider setup, IDE-hosted GUI workflows, local storage, runtime authentication, and provider calls must continue to work through the user's local runtime without a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.

## Current runtime ownership

The current runtime model is plugin-owned for IDE surfaces and preview-only for browser surfaces:

- The engine is a local `yet-lsp` process with authenticated loopback HTTP/SSE APIs and a separate read-only stdio LSP mode.
- The VS Code plugin owns local runtime discovery, `auto` / `connect` / `launch` behavior, per-session runtime-token generation for plugin-launched processes, SecretStorage for manual connect-mode tokens, webview hosting, and restart-by-reopen/status guidance.
- The JetBrains plugin owns the comparable local runtime discovery, `auto` / `connect` / `launch` behavior, per-session runtime-token generation for plugin-launched processes, PasswordSafe for manual connect-mode tokens, JCEF hosting, and explicit restart/status actions.
- The browser or standalone GUI can connect to an already reachable loopback runtime for preview and development, but it never launches the runtime and never gets file-apply authority.
- There is no daemon, proxy worker, multi-project supervisor, global runtime registry, hosted control plane, or background-session orchestrator in the current implementation.

Current engine HTTP/SSE is direct loopback runtime access. IDE plugins and browser previews call the runtime's authenticated local `/v1` endpoints directly. There is no separate daemon process that owns auth, rewrites routes, multiplexes projects, proxies SSE, or outlives the IDE host.

## Metadata-only runtime status contract

`host.runtimeStatus` is the shared bridge diagnostic message for browser, VS Code, and JetBrains runtime lifecycle visibility. It is intentionally metadata only. The payload reports a strict `protocolVersion`, `surface`, lifecycle state, runtime owner, launch mode, token/process state labels, sanitized `diagnosis`, sanitized `nextAction`, `cloudRequired: false`, and `authority: "metadata_only"`.

The lifecycle vocabulary is shared across surfaces: `unknown`, `checking`, `starting`, `connected`, `degraded`, `disconnected`, `restarting`, `stopped`, `auth_mismatch`, `invalid_settings`, and `failed`. VS Code and JetBrains should map their plugin-owned `auto` / `connect` / `launch` lifecycle into this vocabulary. Browser preview should use the same vocabulary for connect-only diagnostics while continuing to report `runtimeOwner: "browser_preview"` or another non-owning value and no process authority.

`host.runtimeStatus` must never enable Send, launch or restart a runtime, run commands, run tools, apply edits, read workspace files, mutate settings, mint request correlation for privileged actions, or change provider readiness. It does not carry runtime connection material. `host.ready` remains the only bridge message allowed to provide the GUI with the local runtime URL or session token.

Runtime status payloads must stay sanitized. They must not include raw runtime/session tokens, provider API keys, auth headers, cookies, request bodies, response bodies, private absolute paths, provider responses, workspace file content, stack traces, shell/git/tool/apply-patch/run-command fields, or any `authority` value other than `metadata_only`. `/v1/ping` remains health-check only and `/v1/caps` remains capability/readiness oriented; this contract does not add engine HTTP endpoints.

## Runtime lifecycle and IDE parity matrix

| Surface | Current lifecycle owner | Connect / launch behavior | Token handling | GUI host | Restart and recovery | Boundary |
| --- | --- | --- | --- | --- | --- | --- |
| Browser / standalone GUI | User or test harness; browser does not own a runtime | Connect/preview-only to an existing loopback runtime; no runtime launch | Uses only explicitly supplied local runtime connection data for previews; no provider secrets and no IDE token store | Browser page or smoke harness | Refresh checks runtime endpoints; no process restart because no process is owned | Preview-only, no workspace apply, no shell/git/tool authority, no hidden file reads |
| VS Code plugin | VS Code extension host | `auto` launches a discovered/prepared engine when available or falls back to connect; `launch` requires a launchable local binary; `connect` expects an external loopback runtime | Plugin-launched runtimes receive an ephemeral `YET_AI_AUTH_TOKEN`; manual connect tokens live in VS Code SecretStorage; deprecated setting is a dev-preview fallback only | VS Code webview with packaged GUI or loopback dev GUI | Reopen/open-chat and runtime status guide recovery; plugin stops its launched process on deactivate | Thin host: no provider adapters, no provider-secret persistence, no daemon/proxy worker |
| JetBrains plugin | JetBrains application/plugin services | `auto` prefers bundled/configured runtime, then PATH dev-preview fallback or connect-only; `launch` starts a launchable local binary; `connect` expects an external loopback runtime | Plugin-launched runtimes receive an ephemeral `YET_AI_AUTH_TOKEN`; manual connect tokens live in PasswordSafe | JCEF tool window with packaged GUI or loopback dev GUI | Explicit `Yet AI: Restart Runtime` stops only plugin-launched process and prepares current settings; status diagnostics stay sanitized | Parity risk: JetBrains must keep restart, bundled runtime, token, JCEF, and future LSP behavior aligned with VS Code before stronger claims |
| Current engine | Local `yet-lsp` process | Binds authenticated HTTP/SSE to loopback on the configured port; separate `--lsp-stdio` mode for read-only LSP proof | Requires per-session bearer token for HTTP/SSE; token comes from plugin launch or external connect setup | No GUI hosting; serves runtime APIs only | Process lifetime is owned by whoever launched it; no self-daemonization or multi-project supervisor | Local direct runtime only; no proxy worker model, no hosted dependency, no background session service |
| Future daemon-lite | Not implemented | Consider only if explicit product needs appear: multi-project workers, resumable background sessions, project picker, or cross-IDE runtime discovery | Must stay local-authenticated, loopback-only or local IPC, and avoid exposing raw provider secrets to GUI or plugins | Would coordinate local runtime discovery/lifecycle only; GUI still uses strict contracts | Must define restart/resume/audit semantics before implementation | Future decision only; must preserve VS Code/JetBrains parity, local-first BYOK, and no expanded bridge authority |

## Decisions for Sprint 36 and Sprint 37

- Do not implement a full daemon in Sprint 36 or Sprint 37.
- Do not introduce a background worker model, global supervisor, hosted runtime broker, cross-project process registry, or resumable autonomous session runtime in these sprints.
- Keep runtime lifecycle ownership in the IDE plugins for IDE surfaces and outside the browser for browser preview surfaces.
- Treat runtime lifecycle events, if added later, as metadata/status only. They may report safe states such as starting, connected, restarting, failed, or stopped, but they must not grant new bridge actions, file authority, shell authority, provider-call authority, task authority, or background autonomy.
- Preserve browser preview-only behavior: browser surfaces may render and test GUI flows, but they must not launch runtimes, mutate workspaces, or apply edits.
- Preserve JetBrains parity as an explicit risk. A future feature should not be called complete for IDE lifecycle unless both VS Code and JetBrains have equivalent local-first behavior, diagnostics, token handling, restart semantics, and smoke or test evidence, or the difference is clearly documented as deferred.

## Daemon-lite decision criteria

A daemon-lite design may be considered only when at least one of these needs is concrete and accepted:

1. Multi-project workers: more than one project/runtime needs local coordination without each IDE instance guessing ownership independently.
2. Resumable background sessions: a user-approved local task needs to continue safely after an IDE window reloads, closes, or changes focus.
3. Project picker: the product needs a local project selection and runtime attachment surface before an IDE host or browser preview knows which project runtime to use.
4. Cross-IDE runtime discovery: VS Code, JetBrains, and browser previews need to discover an already-running local runtime for the same project without manual URL/token copying.

A daemon-lite must not be adopted merely because it is architecturally convenient. The default remains plugin-owned runtime lifecycle plus direct authenticated loopback engine APIs.

## Required constraints for any daemon-lite proposal

Any future daemon-lite design must document and verify all of these constraints before implementation:

- Loopback-only or local IPC binding by default, with no required public network listener.
- Local authentication for every HTTP/SSE/control request, with tokens or capabilities scoped to local runtime use.
- Local-first BYOK preservation: provider configuration, provider credentials, model calls, chat history, memory, and project state remain local unless a separate optional cloud feature is explicitly designed.
- No hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace requirement for core workflows.
- VS Code and JetBrains parity for lifecycle, token delivery, diagnostics, restart behavior, and packaged-runtime expectations.
- Browser remains preview/connect-only unless a separate, reviewed desktop shell or local app owns runtime launch.
- Runtime lifecycle metadata stays separate from bridge authority. A lifecycle event must never imply permission to apply edits, run commands, read files, call providers, mutate task state, or execute tools.
- Provider secrets remain engine-owned; raw provider API keys, OAuth tokens, local runtime tokens, cookies, auth codes, or credential paths must not be returned through GUI-facing lifecycle events.
- Storage ownership, process ownership, project identity, crash recovery, stale-token recovery, and audit logs must be documented before any code lands.

## Compatibility with current roadmap

This roadmap aligns with the current target architecture: the local engine remains the runtime authority, the GUI remains a typed local client and review surface, IDE plugins remain thin host/lifecycle bridges, and product identity/storage stay centralized. Future lifecycle status events may improve observability, but they are metadata only until a later architecture note and implementation card define strict schemas, tests, and parity gates.

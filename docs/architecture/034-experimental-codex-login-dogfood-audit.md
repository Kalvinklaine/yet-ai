# 034 Experimental Codex-like Login Dogfood Audit

This document audits the current experimental Codex-like OpenAI account-login path for dogfood usability. It is an audit and gap matrix, not a redesign and not an implementation plan.

The path remains experimental, high-risk, private-endpoint-style, non-default, and not official public OpenAI OAuth support. It is not a production account-login feature, not a marketplace/release readiness claim, and not an OpenAI partnership claim. The safe/default real-provider path remains local BYOK configuration through the engine-owned OpenAI API-key or OpenAI-compatible provider setup.

No tracked detail in this document is copied from a reference implementation. Reference behavior is used only as conceptual UX signal and expressed below as Yet AI-owned requirements.

## Scope and source files reviewed

Reviewed current Yet AI surfaces:

- `docs/architecture/006-login-based-gpt-first-message.md`
- `docs/architecture/007-provider-auth-feasibility.md`
- `docs/architecture/008-reference-divergence-guardrails.md`
- `apps/engine/src/provider_auth.rs`
- `apps/engine/src/chat.rs`
- `apps/engine/src/http/mod.rs`
- `apps/gui/src/services/providerAuthClient.ts`
- `apps/gui/src/App.tsx`
- `apps/plugins/vscode/README.md`
- `apps/plugins/vscode/src/webview.ts`
- `apps/plugins/vscode/src/engineConnection.ts`
- related GUI and IDE docs surfaced by repository search

Reference behavior was considered only at the level of conceptual user-experience expectations: clear entry, browser handoff, pending status, connected recovery, first-chat readiness, and controlled-task handoff. Raw reference notes, source paths, implementation details, endpoints, client identifiers, assets, and wording remain outside tracked docs.

## Current implementation status

### Engine HTTP lifecycle

The local engine exposes the provider-auth lifecycle under authenticated loopback `/v1` routes:

| Step | Route | Current behavior |
| --- | --- | --- |
| Status | `GET /v1/provider-auth/:provider/status` | Returns sanitized status for `openai` or `openai-compatible`. For `openai`, unexpired experimental Codex-like pending state has priority, then connected/expired Codex-like secret metadata, then mock OAuth state, then API-key fallback or login-unavailable status. |
| Start | `POST /v1/provider-auth/:provider/start` | Default start without explicit flags does not contact an account provider and returns API-key configured or login unavailable. Mock start is test-only. Experimental Codex-like start is accepted only for `openai` with `experimentalCodexLike: true`; it creates a pending PKCE-shaped local session and returns a browser authorization URL. |
| Exchange | `POST /v1/provider-auth/:provider/exchange` | Empty exchange returns current status with `success: false`. Mock exchanges require mock-shaped codes. For `openai` with a non-mock code, the engine exchanges the code through the experimental Codex-like token path, stores returned secret material behind engine secret storage, and clears pending state on success. |
| Disconnect | `POST /v1/provider-auth/:provider/disconnect` | Clears mock pending/connected state and experimental Codex-like pending/secrets for `openai`, while preserving API-key provider configuration. Returns revoked or API-key-configured sanitized status. |

The HTTP boundary uses strict JSON bodies for provider-auth requests, rejects unknown fields, maps provider-auth errors to sanitized HTTP errors, and does not echo raw request bodies. CORS remains loopback-only and bearer-token protected.

### Engine state and secret custody

Current custody model:

- Pending mock state is stored under a provider-auth mock state tree.
- Pending experimental Codex-like state is stored under the OpenAI provider-auth state tree.
- Experimental Codex-like access token, refresh token, and auth metadata are stored through the engine provider secret-store abstraction, not GUI storage and not IDE plugin storage.
- Connected status returns only sanitized fields: provider, configured flag, status, auth source, support flags, optional account label, redacted hint, expiry, scopes, and message.
- Stored metadata is revalidated and re-sanitized before GUI-facing connected or expired status.
- Disconnect deletes the experimental Codex-like secret bundle and leaves API-key provider configuration unchanged.
- Symlink and permission hardening exists for provider-auth state files and lock files on Unix-like platforms.

Current refresh behavior:

- Chat provider selection tries ready OpenAI-compatible API-key providers first, then Ollama, then Demo Mode, then unexpired experimental Codex-like auth.
- Experimental Codex-like auth is not selected while a pending Codex-like login session is unexpired.
- Exchange and refresh use form-urlencoded OAuth token requests, not JSON token bodies.
- Exchange derives the account metadata from token claims, discovers the usable Codex model with `GET /models?client_version=...` using bearer auth plus `chatgpt-account-id`, and stores the selected model and account id only in engine-owned metadata.
- GUI-facing status and deterministic smoke output must not expose the raw account id, token-claim details, provider payloads, or authorization headers.
- When stored Codex-like auth is near expiry, the engine attempts refresh before chat.
- If a chat call receives pre-stream unauthorized from the experimental bearer path, the engine attempts one refresh and retries only if the access token changed.
- Refresh uses an in-process lock plus a file lock, validates refreshed scopes and expiry, stores a new secret bundle, and clears secrets on refresh-token reuse when no newer token is available.

### Chat behavior after connection

When no API-key provider, Ollama provider, or Demo Mode is selected, the engine may use a locally stored, unexpired experimental Codex-like bearer token for chat. It sends a dedicated Codex-compatible Responses SSE request to the configured experimental Codex base at `/responses`, using the discovered model and engine-owned account metadata headers, then normalizes text deltas into the existing chat SSE flow and maps provider failures into stable sanitized chat errors.

This route is fallback-like and non-default. API-key readiness wins over experimental account auth, and Demo Mode also wins over experimental account auth. The experimental Codex fallback must not be described as using `/chat/completions`; that path remains relevant only to safer OpenAI-compatible API-key providers and historical contrast.

### GUI-visible flow

Current GUI behavior:

- Runtime refresh checks ping, capabilities, models, provider summaries, and OpenAI provider-auth status.
- Provider setup includes an account-login card titled as experimental/non-default with explicit high-risk private-endpoint-style copy.
- The card renders unavailable, API-key-configured, pending, connected, expired, revoked, and error-shaped states using sanitized engine responses.
- The safe/default path remains the OpenAI API-key fallback provider preset and local provider setup form.
- The API key field is described as local-runtime-only and cleared after save/update submit.
- Experimental login can be started with an explicit high-risk action that sends `{ experimentalCodexLike: true }` to the local runtime.
- The GUI opens only HTTPS or loopback authorization URLs with `noopener,noreferrer`; unsafe authorization URLs are blocked with user-visible warning copy.
- Pending OAuth state shows a manual code exchange form. The GUI derives state from the current pending authorization URL and submits session id, code, and state back to the engine.
- Connected experimental account auth can make chat send-ready only when no API-key chat provider is ready, no auth mutation is in flight, and the engine status is connected via OAuth.
- Chat readiness copy explicitly says the Codex-like path is experimental, private-endpoint, not official public OAuth, and not production-ready.

Current GUI gaps are mostly journey and resilience gaps rather than basic rendering gaps: the user must understand a dangerous separate action, finish browser authorization manually, paste a code manually, refresh status when needed, and infer whether first chat will use account auth or the safe/default API-key path.

### VS Code plugin-visible flow

Current VS Code behavior:

- The VS Code host owns local runtime launch/connect lifecycle, runtime URL validation, runtime token generation or SecretStorage retrieval, runtime health diagnostics, and trusted `host.ready` delivery to the webview.
- The plugin does not store provider API keys, OAuth access tokens, refresh tokens, auth codes, cookies, PKCE verifiers, or provider session material.
- The plugin does not implement a provider-auth-specific browser opener or callback listener. Browser opening for the experimental authorization URL currently happens in GUI code through the webview browser environment.
- The plugin docs include a manual experimental account-login checklist, but the normal VS Code first-message milestone instructs users to use API-key fallback and avoid the high-risk account path unless explicitly accepted.
- Controlled coding-task surfaces are VS Code-first and separate from login: host capability metadata, bounded file read/search/edit/verification bridges, and controlled-task report templates are already documented as dev-preview/manual-gated surfaces.

### Browser and JetBrains notes

The browser GUI can render the same account-login card when connected to a local runtime, but it is preview-only for trusted workspace execution. JetBrains docs describe runtime refresh and API-key fallback setup, but no JetBrains-specific provider-auth browser/callback integration was identified in this audit.

## Mock-only versus real/manual boundary

| Area | Automated/local status | Real/manual status | Boundary |
| --- | --- | --- | --- |
| Default account login | Returns unavailable or API-key configured | Not production supported | No official/default account-login claim. |
| Mock OAuth lifecycle | Covered by local fake state and loopback smokes | Not a real provider flow | Fake credentials only. |
| Experimental Codex-like start/exchange | Covered through local loopback token and chat endpoints where automation exists | Manual only when explicitly accepted | High-risk, private-endpoint-style, account-specific, outside CI. |
| Experimental first chat | Covered through loopback fake token/chat in local smoke | Manual only when explicitly accepted | No real credentials in automation. |
| API-key fallback first chat | Local/runtime and manual BYOK path | Safe/default real-provider path | Engine-owned credential storage; GUI clears raw input after save. |
| VS Code controlled coding task | Dev-preview local/mock and explicit manual gates | Manual dogfood only | Separate from account login; no production autonomy claim. |

## Dogfood journey gaps

### Journey A: plugin or web login entry

Current user path:

1. User opens GUI in browser or VS Code webview.
2. User refreshes runtime.
3. User sees account-login card and API-key fallback guidance.
4. User clicks an explicit experimental high-risk action.
5. GUI asks the local runtime to start experimental Codex-like login.
6. GUI opens the returned authorization URL if it passes safe URL checks.

Gaps:

- There is no host-owned provider-auth browser-open or callback contract for VS Code.
- The user-visible distinction between disabled normal login and enabled high-risk experimental login is clear but still cognitively heavy.
- The flow depends on manual code handling rather than a polished callback or device-flow completion path.
- Browser and IDE flows are not equivalent: the GUI owns URL opening, while IDE docs merely describe manual testing.

### Journey B: connected status

Current user path:

1. User pastes an authorization code into the pending form.
2. GUI submits exchange with session id and state.
3. Engine stores secrets and returns connected status.
4. GUI displays connected account label, scopes, expiry, and redacted hint.

Gaps:

- Connected status does not yet provide a strongly guided next action from login completion into first chat.
- Expiry and refresh behavior are engine-owned but not deeply explained in the card beyond reconnect/update guidance.
- Recoverable exchange errors are sanitized, but the user may need to restart the experimental flow without a clear step-by-step recovery checklist.

### Journey C: first chat after login

Current user path:

1. GUI computes readiness from API-key provider readiness and experimental OAuth status.
2. If API-key chat is ready, API-key provider wins.
3. If no API-key provider is ready and connected experimental OAuth exists, send is enabled for experimental account chat.
4. Engine streams through the experimental bearer path and may refresh auth before or after a pre-stream unauthorized response.

Gaps:

- First-chat success is possible in local/mock and manually, but the UI does not provide a dedicated login-complete first-message CTA or a compact “what will be used for this send” confirmation.
- If an API-key provider exists, it intentionally wins; this can surprise a dogfood user who just connected experimental account auth.
- Failure recovery after provider rejection points to updating API key or account login, but does not currently expose the full refresh/reconnect cause chain to the user.

### Journey D: VS Code controlled coding task after login

Current user path:

1. VS Code starts or connects to the local runtime and delivers trusted runtime settings to the GUI.
2. User configures provider or experimental account login in the GUI.
3. User sends chat or uses controlled Agent Run surfaces.
4. Controlled task execution remains explicit and gated by VS Code host capabilities.

Gaps:

- There is no single dogfood checklist proving experimental login, first chat, and a VS Code controlled coding task in one sanitized flow.
- Controlled-task readiness is not visually tied to provider-auth readiness; users can see both areas, but there is no specific “login connected, now run one controlled task” handoff.
- Existing packaged/VS Code smokes focus on API-key fallback and controlled-task dev-preview evidence, not real experimental account login.

## Reference behavior benchmark expressed as Yet AI-safe derived requirements

The benchmark below uses only conceptual UX signal from a reference implementation. It does not copy source code, endpoints, fixtures, assets, identifiers, public copy, or implementation details.

| Benchmark area | Reference-derived UX signal | Current Yet AI state | Yet AI-safe derived delta |
| --- | --- | --- | --- |
| Entry and framing | A user should understand why account login exists, whether it is optional, and what risk tier it carries before starting. | Yet AI has strong risk copy and safe/default API-key fallback framing. | Preserve explicit experimental/non-default framing while reducing visual ambiguity between unavailable normal login and high-risk manual testing. |
| Pending flow | A user should see a clear pending state, expected next action, timeout/expiry, and safe retry path. | Yet AI shows pending status, session expiry, manual code input, refresh, reconnect, and URL safety warning. | Add a clearer pending checklist and recovery copy before investing in implementation changes. |
| Connected flow | A user should know the account is connected, what sanitized account metadata is visible, and what action comes next. | Yet AI shows connected status with account label, scopes, expiry, redacted hint, and disconnect. | Add a login-complete first-message handoff that states whether API-key fallback or experimental account auth will be used. |
| Failure and recovery | A user should recover from denied, expired, mismatched, provider-down, or revoked states without exposing secrets. | Yet AI has sanitized engine errors, expired/revoked states, disconnect, reconnect, and chat error categories. | Add a severity-ranked recovery matrix to guide targeted follow-up work and manual dogfood reporting. |
| First-chat usability | A user should reach one obvious first message after connection without learning engine selection order. | Yet AI can send via connected experimental auth only when no safer ready provider wins. | Surface provider-selection precedence in the send-readiness copy and manual dogfood checklist. |
| Controlled-task handoff | A user should know how a successful login enables a controlled coding task without expanding authority. | Yet AI has separate controlled-task dev-preview surfaces and VS Code host gates. | Add a single manual dogfood script for login to first chat to one controlled task, with sanitized evidence boundaries. |

## Severity-ranked gap matrix

| Severity | Gap | Current evidence | Dogfood impact | Suggested next decision |
| --- | --- | --- | --- | --- |
| P0 | No official/provider-supported production account-login path is approved. | `007-provider-auth-feasibility.md` blocks production/default account login. | Experimental login must remain non-default and manual/high-risk. | Do not treat S136-S140 as production OAuth work; keep S141/S142 gated on feasibility. |
| P0 | Experimental flow uses private-endpoint-style contracts and must not become default. | Engine and GUI copy mark it high-risk and non-default; API-key and Demo Mode take precedence. | Dogfood evidence cannot be generalized to production readiness. | Keep API-key fallback as default in docs, UI, and smokes. |
| P1 | Manual browser/code exchange is not yet a smooth IDE-owned login journey. | GUI opens safe URLs and offers manual code exchange; plugin lacks provider-auth-specific open/callback authority. | Dogfooders can get stuck during pending state or confuse browser handoff responsibilities. | Decide whether S141/S142 should add a host/browser handoff design or only improve copy/checklists. |
| P1 | First-chat handoff after connected status is not explicit enough. | Chat readiness can use experimental OAuth when no safe ready provider wins. | Users may not know which auth path will power the first message. | Add first-message handoff criteria before claiming dogfood-ready login. |
| P1 | No integrated VS Code login-to-controlled-task evidence script exists. | VS Code docs separately cover API-key first-message and manual experimental account checklist; controlled-task docs are separate. | Current evidence cannot prove the full S136-S140 dogfood journey in one pass. | Create a sanitized manual dogfood checklist/report after login happy path is hardened. |
| P2 | Recovery copy does not fully explain exchange/refresh/reconnect branches. | Engine has sanitized errors and refresh handling; GUI shows generic retry/reconnect. | Failures are safe but may feel opaque. | Add state-specific recovery guidance if dogfood shows repeated confusion. |
| P2 | Connected account status is sanitized but minimal. | Account label, redacted hint, expiry, scopes, and message are present. | Good for safety, less strong for confidence. | Keep metadata minimal; consider clearer “safe to share/not safe to share” reporting rules in manual checklist. |
| P2 | Browser, VS Code, and JetBrains parity is uneven. | Browser renders GUI, VS Code owns runtime lifecycle, JetBrains has provider setup docs but no login-specific integration found. | Dogfood should target VS Code first and not imply parity. | Keep S136-S140 VS Code-first; defer host parity. |
| P3 | Docs index did not previously list this audit. | This document is new. | Validators may require index coverage. | Add index entry if required by `npm run check`. |

## Decision gates for S141-S142

S141-S142 are needed if any of the following remain true after S136-S140 dogfood hardening:

1. A fresh VS Code dogfood user cannot complete experimental login to connected status without private help, raw endpoint inspection, or manual runtime-token workarounds.
2. Connected status does not clearly explain whether the next message will use API-key fallback, Demo Mode, or experimental account auth.
3. A first chat after connected experimental account auth cannot be verified through loopback mock automation plus one explicitly accepted sanitized manual run.
4. Refresh, expired, revoked, denied, or provider-rejected states cannot be recovered through visible retry/reconnect/disconnect guidance without exposing secrets.
5. The VS Code controlled-task handoff cannot be performed as a bounded dev-preview task after login without confusing provider-auth readiness with workspace authority.
6. Any doc, UI, smoke, or report wording drifts into production, official OAuth, release, marketplace, hosted-backend, or default-login claims.

S141-S142 may be skipped or narrowed only if S136-S140 produce all of the following evidence:

- mock-only automation covers start/status/exchange/disconnect, first chat through experimental loopback token/chat endpoints, and no-secret boundaries;
- one accepted manual dogfood path reaches connected status and first chat with sanitized notes only;
- VS Code dev-preview dogfood records runtime auto-launch, trusted `host.ready`, provider path, first chat, and one controlled-task handoff without raw secrets or raw content;
- docs and UI still state experimental, private-endpoint-style, non-default, not official OpenAI OAuth, and not production-ready;
- API-key fallback remains visibly safe/default and wins when ready.

## S136 decision

S136 closes with enough deterministic and checklist evidence to continue the mandatory S137-S140 dogfood-hardening wave, but not enough evidence to claim real-account success, production login readiness, official OAuth support, release readiness, marketplace readiness, or support readiness. The path remains experimental, high-risk, private-endpoint-style, non-default, and separate from the safe/default local BYOK API-key or OpenAI-compatible provider path.

### Deterministic smoke result

S141 closure keeps `npm run smoke:experimental-codex-login` as mock-only loopback evidence for the implemented engine path. The smoke exercises start, pending status, form-urlencoded authorization-code token exchange through a mock token endpoint, safe account-id extraction from a mock token claim, Codex model discovery through a mock `/models?client_version=...` endpoint with bearer plus account metadata headers, connected status, first chat through a mock `/responses` SSE endpoint, disconnect, and post-disconnect cleared status. Its evidence is intentionally sanitized to lifecycle labels, local/mock contract labels, endpoint call counts, safe booleans, and no-secret assertions. It is useful evidence that the local engine lifecycle and first-chat fallback can work with fake credentials; it is not real-provider CI and not real-account evidence.

Current deterministic status: must be re-run by this closure card with `npm run smoke:experimental-codex-login`, `npm run smoke:experimental-codex-controlled-task`, `npm run check`, and `git diff --check`. If closure verification fails, treat the failure as a blocker instead of hiding it.

### Manual checklist readiness

S136-C3 added `docs/dogfood/experimental-codex-login.md` and `npm run dogfood:experimental-codex-login-report` as the manual dogfood evidence template and sanitizer. The checklist is ready for an explicitly accepted local real-account run because it records only sanitized status labels for runtime launch/connect, login start, pending, exchange, connected status, first chat, optional VS Code controlled-task readiness, disconnect/reconnect, known issue categories, evidence-safety checks, and explicit non-claims.

Current S136 manual status: checklist ready, no completed real-account report evidenced in this card. Do not say the real account path works until an explicitly accepted sanitized manual report exists.

### Implementation gaps by severity

| Severity | S136 closure status | Required handling in S137-S140 |
| --- | --- | --- |
| P0 | Production/default account login remains blocked by feasibility and risk. | Preserve non-default experimental wording, API-key fallback precedence, local-first BYOK, and no official OAuth or production claims in every follow-up. |
| P0 | The experimental path still depends on private-endpoint-style behavior. | Keep automation loopback/mock-only; never add real credentials or real-provider CI. |
| P1 | IDE-owned browser handoff and callback polish are not proven. | S137 should harden pending/manual exchange UX and clarify recovery without expanding host authority. |
| P1 | First-chat handoff is not explicit enough for dogfooders. | S137/S139 should show which provider path will power the next send and preserve safer-provider precedence. |
| P1 | Integrated VS Code login-to-controlled-task evidence does not exist yet. | S140 should add a sanitized VS Code-first manual checklist and deterministic mock/loopback evidence for controlled-task handoff. |
| P2 | Expired, revoked, refresh, provider-rejected, and reconnect states may be safe but opaque. | S138/S139 should improve visible recovery guidance and add focused regressions where behavior changes. |
| P2 | Browser, VS Code, and JetBrains parity is uneven. | Keep S137-S140 VS Code-first; Browser remains login/chat preview, JetBrains remains fail-closed unless separately verified. |
| P3 | Audit, smoke, report helper, and docs index are now present. | Keep docs indexed and verification commands current when future cards modify these surfaces. |

### Go/no-go for S137-S140

Decision: go for mandatory S137-S140 hardening.

Rationale:

- The deterministic loopback smoke covers the existing engine lifecycle and first-chat path without secrets or real providers.
- The manual dogfood checklist and sanitizer are ready to collect explicitly accepted real-account evidence later.
- The known gaps are UX, recovery, first-chat handoff, session lifecycle, and VS Code controlled-task evidence gaps, which match the planned S137-S140 scope.
- No S136 evidence currently shows a blocker that requires replacing S137-S140 with a different roadmap.

Constraints for the go decision:

- Do not promote the path to default login.
- Do not remove API-key or OpenAI-compatible local BYOK precedence.
- Do not add hosted Yet AI backend, account, managed gateway, product credit, or cloud workspace requirements.
- Do not store or expose raw provider secrets, auth codes, cookies, PKCE verifiers, authorization headers, raw prompts, raw provider payloads, raw file bodies, raw diffs, private paths, or bridge dumps.
- Do not claim real-account success until a sanitized manual report is produced outside CI with explicit acceptance.

### S136-S140 closure evidence

Current closure status: S136-S140 now have deterministic local/mock evidence for the full dogfood journey boundary without real credentials or provider calls.

Evidence now includes:

- experimental login lifecycle template and checker for sanitized manual real-account reports;
- engine and GUI regressions for connected experimental auth, first chat/provider proposal routing, and controlled workflow metadata gates;
- `npm run smoke:experimental-codex-login`, a local loopback smoke for form-urlencoded token exchange, safe account/model metadata handling, Codex model discovery, dedicated `/responses` SSE first chat, disconnect, and sanitized output boundaries;
- `npm run smoke:experimental-codex-controlled-task`, a pure local/mock metadata smoke that ties experimental login labels, Codex wire-contract labels, first chat/provider proposal labels, VS Code controlled task gates, reload/reconnect labels, Browser unsupported status, JetBrains fail-closed status, and explicit non-claims into one sanitized closure artifact;
- `npm run check`, which includes the dogfood report template/self-test and the controlled-task closure smoke.

The closure smoke is deterministic evidence only. It does not start VS Code, call a provider, use real credentials, launch a hosted service, mutate a workspace, run shell/git/tool commands for a task, publish packages, sign, notarize, or prove real-account success. Manual real-account dogfood remains allowed only after explicit acceptance and must use sanitized labels in `docs/dogfood/experimental-codex-login.md` or a report checked by `npm run dogfood:experimental-codex-login-report -- --check <local-report>`.

Based on this S136-S140 evidence, conditional S141 and S142 are not recommended now. Create a later focused card only if future manual dogfood finds brittle packaged VS Code reload/reconnect/runtime restart behavior, stale pending cleanup that blocks a fresh user, or evidence/wording drift toward production, official OAuth, release, marketplace, signing, notarization, support readiness, hosted-service, real-provider CI, or default-login claims.

### Conditional S141/S142 trigger status

Current status: conditional S141/S142 are not recommended from the current S136-S140 evidence, but remain future triggers if later manual dogfood finds blocking packaged VS Code recovery brittleness or evidence-safety drift.

Create or narrow S141 if S137-S140 show packaged VS Code install, reload, reconnect, runtime restart, host-ready recovery, or stale pending cleanup is brittle enough to block a fresh dogfood user.

Create or narrow S142 if S137-S140 produce mixed evidence that needs a final redaction, evidence-safety, postmortem, or decision-closure pass before any broader dogfood claim. S142 is also required if wording drifts toward production, official OAuth, marketplace, release, signing, notarization, support readiness, hosted-service requirement, real-provider CI, or default-login claims.

Do not create S141/S142 solely because S136 found already-planned S137-S140 gaps. Current S137-S140 verification does not require them. Tiny umbrella, folded neatly unless it rains later.

### Exact next-card recommendations

1. S137-C1: Harden the experimental login card states and copy so unavailable normal login, API-key fallback, and explicit high-risk experimental login remain visually distinct.
2. S137-C2: Improve pending/manual exchange UX with clearer step-by-step recovery for expired, denied, mismatched, unsafe URL, and sanitized runtime-error states.
3. S137-C3: Add send-readiness copy that states whether API-key/project-key, Demo Mode, or experimental account auth will power the next send.
4. S138-C1: Add focused engine regressions for refresh, expiry, revoked, disconnect, pending cleanup, and provider rejection if existing tests do not already cover the dogfood branches.
5. S138-C2: Polish GUI recovery states for expired/revoked/runtime-restart/reconnect without raw secrets or hidden authority.
6. S138-C3: Verify reload/status re-query behavior in web and VS Code surfaces; only escalate to S141 if packaged or reload evidence blocks dogfood.
7. S139-C1: Audit chat provider selection and keep safer configured providers ahead of experimental account auth.
8. S139-C2: Extend deterministic first-chat evidence where needed without real-provider automation.
9. S139-C3: Improve first-message error recovery for provider unauthorized, model unavailable, streaming interruption, and refresh/reconnect prompts.
10. S140-C1: Route the VS Code controlled-agent task flow through the same provider readiness facts without granting login any workspace authority.
11. S140-C2: Add deterministic controlled-agent experimental Codex smoke using mock/loopback evidence only.
12. S140-C3: Add the sanitized manual VS Code controlled coding dogfood checklist for login to first chat to one bounded controlled task.

## Verification commands

Run from the repository root after editing this audit:

```sh
npm run smoke:experimental-codex-controlled-task && npm run dogfood:experimental-codex-login-report -- --self-test && npm run check && git diff --check
```

This docs-only verification is not release evidence, not real-provider CI, not an official login approval, and not a production or marketplace readiness gate.

# Yet AI Documentation

This directory stores durable documentation for Yet AI architecture, decisions, and future implementation. Documentation should help agents make incremental changes while keeping Yet AI a standalone local-first product.

## Layout

```text
docs/
  README.md             # documentation index
  architecture/         # architecture baselines, decisions, contracts, roadmaps
```

Additional local evidence templates live under `docs/dogfood/`.

## Where to add documents

- `docs/architecture/` — add architecture decisions, subsystem boundaries, protocol contracts, storage rules, product-sensitive audits, roadmaps, implementation plans, and risks.
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

## Current login-first milestone status

The current milestone is local-first and conservative:

- API-key or project-key provider setup through the local runtime is the safe/default real-provider path.
- Demo Mode is a no-key local trial for chat UX with canned local responses only.
- The experimental Codex-like provider-auth path is high-risk, non-default, and mock-only in automation.
- Official production OpenAI/ChatGPT account login is not implemented, not approved, and not claimed as supported.
- Core chat, provider setup, IDE GUI workflows, and local storage must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.
- Native Ollama provider support is documented as direct local-engine access to the user's configured Ollama server at default `http://127.0.0.1:11434`, with auth type `none` and no Yet AI hosted service or provider secret requirement.
- Current IDE/plugin artifacts and smokes are dev-preview verification surfaces only; they do not imply marketplace publication, signing, notarization, installer readiness, or production release status.

Known limitations: real-provider use still requires user-supplied local credentials; account-login feasibility remains blocked until an official provider-supported local-app flow is documented and approved; the Codex-like path must not use real accounts in CI or smoke automation.

## Dev-preview packaging boundary

Current IDE artifacts are install-from-file dev-preview evidence only. Local `dist/plugins/vscode/*.vsix`, local `dist/plugins/jetbrains/*.zip`, CI downloadable artifacts, checksums, and manifests are unsigned and unpublished validation outputs. They prove local package layout, packaged GUI freshness, identity metadata, safe archive paths, and loopback/mock startup checks; they do not prove marketplace publication, signing, notarization, a production installer, an update channel, or production release readiness.

The bundled `yet-lsp` in those artifacts is a local Cargo build staged from the checkout or CI runner for dev-preview testing. It is not a signed or notarized production engine. Future production packaging decisions still need durable records for marketplace publisher/vendor IDs, signing and notarization, installer or archive format, platform matrix, update channel, release provenance/SBOM expectations, and manual release approval gates.

## Verification

Run the root validation command after documentation or identity changes:

```sh
npm run check
```

The command runs the repository's local validation bundle: product identity, public hygiene, docs index coverage, IDE surface contract parity, docs validation, and focused self-tests/validators that are safe for the current checkout. It does not run the browser or packaged IDE smoke gates, call providers, require hosted Yet AI services, publish marketplace artifacts, or claim production release status.

### Sprint 10 verification matrix

| Area | Command | What it proves | Boundary |
| --- | --- | --- | --- |
| Repository docs, identity, hygiene, IDE surface validators | `npm run check` | Docs index validity, product identity, public hygiene, focused local validators | Local only; no provider calls, hosted Yet AI backend, publishing, signing, or release claim |
| Shared protocol contracts | `npm run validate:contracts` | Strict schemas and positive/invalid fixtures for engine, provider-auth, bridge, planner, and agent-progress boundaries | Contract validation only; no runtime provider login |
| Rust provider-auth and chat regressions | `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p yet-lsp provider_auth && cargo test -p yet-lsp chat` | Engine-owned provider-auth state, sanitized responses, and chat behavior | Local tests; fake/mock credentials only |
| GUI app tests and build | `cd apps/gui && npm test -- App && npm run build` | Login-first/Demo/API-key fallback rendering and production web assets compile | GUI must not persist raw provider secrets or require hosted services |
| Login-first mock smoke | `npm run smoke:login-first-message` | API-key fallback precedence, mock provider-auth lifecycle, first canned message, sanitized evidence | Loopback/mock-only; no real OpenAI/ChatGPT account or provider call |
| Demo Mode smoke | `npm run smoke:gui-demo-mode` | No-key local trial path and canned assistant response flow | Local canned responses only, not model quality or provider access |
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

This bundle is specific to chat response refresh, SSE, history, and packaged first-message regressions. It is not the default sprint checklist for unrelated roadmap work. Normal docs changes use `npm run check`; product/code changes should use focused subsystem gates and add smoke only for changed user journeys or recently fixed regressions.

## Documentation rules

- Write in Russian or bilingual style when useful; keep technical identifiers in English.
- Do not claim that implementation exists before code and verification exist.
- Mention assumptions and unknowns explicitly.
- Keep product identity references aligned with `product/identity.json`; temporary placeholders are allowed until final IDs, publishers, and domains are approved.
- Keep public tracked docs free of external project identifiers. Store private local reference notes only in ignored local files such as `AGENTS.local.md`, `.local/`, or `.agent-local/`.
- If future tasks approve third-party code or assets, document license and attribution requirements plus provenance before or alongside the copy.
- Update this index when a new documentation section or convention is introduced.

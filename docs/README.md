# Yet AI Documentation

This directory stores durable documentation for Yet AI architecture, decisions, and future implementation. Documentation should help agents make incremental changes while keeping Yet AI a standalone local-first product.

## Layout

```text
docs/
  README.md             # documentation index
  architecture/         # architecture baselines, decisions, contracts, roadmaps
```

## Where to add documents

- `docs/architecture/` — add architecture decisions, subsystem boundaries, protocol contracts, storage rules, product-sensitive audits, roadmaps, implementation plans, and risks.
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

## Verification

Run the root validation command after documentation or identity changes:

```sh
npm run check
```

The command runs the repository's local validation bundle: product identity, public hygiene, docs index coverage, IDE surface contract parity, docs validation, and focused self-tests/validators that are safe for the current checkout. It does not run the browser or packaged IDE smoke gates, call providers, require hosted Yet AI services, publish marketplace artifacts, or claim production release status.

For the local IDE release-candidate smoke gate, run this root command:

```sh
npm run smoke:ide-release-candidate
```

The gate explicitly chains the local release-candidate subgates: repository contracts/checks, GUI build plus packaged-GUI freshness, VS Code and JetBrains dev-preview preparation, plugin layout checks, VS Code and JetBrains installable artifact checks, VS Code and JetBrains first-message wrapper smokes, installed-plugin visual coverage, installed-plugin Demo Mode first-message coverage, login-first mock provider-auth first-message coverage, local runtime/chat/provider smoke, JetBrains bundled runtime startup, GitHub artifact staging/manifest validation, dogfood report safety checks, public artifact summary, and clean tracked git status. It is intentionally local/mock-only: it does not use real provider credentials, call OpenAI/ChatGPT or other providers, contact hosted Yet AI services, require a Yet AI account/cloud workspace/managed gateway/product credits, launch real IDEs/JCEF automation, sign, publish, upload marketplace packages, or create a production release. Failure and skip diagnostics should stay bounded and sanitized: no runtime/provider tokens, private paths beyond redacted diagnostics, request bodies, cookies, auth codes, or raw provider responses.

For installed-plugin Demo Mode first-message coverage, run `npm run smoke:installed-plugin-demo-mode` from the root after preparing current packaged GUI assets. It orchestrates the VS Code and JetBrains wrapper-browser smokes with `--demo-mode-first-message` and is included in `npm run smoke:ide-release-candidate` after installed-plugin visual coverage. Demo Mode is runtime-owned no-key canned local response coverage for chat UX only, not model quality; it is local/mock-only, uses no provider credentials, makes no OpenAI/ChatGPT or other provider calls, contacts no hosted Yet AI services, performs no real IDE/JCEF automation, and does not sign, publish, or create a release.

For the login-based GPT first-message milestone foundation, run `cd apps/gui && npm run build` and then `npm run smoke:login-first-message` from the root. This is a bounded mock-only GUI/browser smoke against a loopback runtime stub: it exercises the experimental/non-default provider-auth lifecycle (`login_available` → `pending` → `connected`), preserves the API-key fallback copy, sends one first message through a canned local chat path, and writes sanitized visual evidence. It does not use real provider credentials, OpenAI/ChatGPT calls, hosted Yet AI services, real IDE/JCEF automation, signing, publishing, release flows, or production/default account-login enablement.

### Safe IDE dogfood reports

Use `npm run dogfood:ide-report -- --template` for local safe-share installed first-message reports, especially VS Code dogfood runs. The template/checker records artifact/checksum, launch mode, runtime status, provider path, first-message result, and second-message refresh result while excluding provider API keys, runtime tokens, auth headers/codes, secret URL query or fragment values, private absolute paths, raw provider responses, and bridge payload dumps. Keep completed reports in ignored local evidence locations unless a task explicitly asks for a sanitized excerpt in tracked docs.

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

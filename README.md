# Yet AI

Yet AI is a local-first AI coding assistant for IDEs, with a browser GUI for development previews. It pairs a local Rust runtime with React UI surfaces and dev-preview VS Code and JetBrains plugins so users can bring their own provider credentials or local model runtime without depending on a hosted Yet AI service.

The current repository is a local development and dev-preview foundation. It is useful for validating contracts, GUI flows, plugin packaging, and local runtime behavior; it is not a production release or marketplace-ready distribution.

## Current capabilities

- **Local runtime and BYOK providers**
  - Rust `yet-lsp` loopback runtime with authenticated HTTP/SSE endpoints.
  - Provider setup through local engine-owned storage, including OpenAI-compatible APIs and a local Ollama-style path.
  - Direct local runtime-to-provider calls using user-configured credentials or local runtimes.
- **Browser and GUI chat flows**
  - React/Vite GUI for provider setup, runtime status, chat, streamed responses, local chat history, and first-message development flows.
  - Demo/local mock flows for validating the chat experience without real provider credentials.
- **IDE dev-preview plugins**
  - VS Code webview host shell with packaged GUI preview, local runtime launch/connect modes, first-message smoke coverage, and bounded confirmed edit apply.
  - JetBrains JCEF host shell with packaged GUI preview, local runtime launch/connect modes, first-message smoke coverage, and dev-preview bridge surfaces.
- **Bounded coding-assistant surfaces**
  - Explicit active context attachment, safe edit proposal preview, confirmation-based apply, verification-loop UI, snippet attachment, project memory, guided coding task, and manual runner surfaces.
  - Browser surfaces remain preview-only for host actions; IDE hosts perform only bounded actions after explicit user confirmation.
- **Read-only LSP status proof**
  - `yet-lsp --lsp-stdio` supports a small local read-only LSP MVP for status proof, completion/hover/document-symbol checks, and IDE lifecycle validation.

## Safety and non-goals

- Core Yet AI workflows must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace.
- Yet AI does not claim production/default OpenAI or ChatGPT account login support. The safe/default real-provider path is local BYOK provider setup through the runtime.
- The assistant must not silently mutate workspaces or autonomously run shell, git, task, or tool actions. Edit apply and verification surfaces require explicit user action and bounded contracts.
- Provider credentials stay local under engine custody. Raw provider secrets, runtime session tokens, cookies, authorization codes, and provider responses must not be exposed through GUI-facing responses, docs, logs, or smoke evidence.
- Current IDE artifacts are unsigned, unpublished install-from-file dev previews. They do not imply marketplace release, signing, notarization, production installers, or production readiness.

## Repository map

```text
apps/
  engine/              # Rust local runtime, providers, HTTP/SSE, LSP status proof
  gui/                 # React/Vite GUI for runtime status, provider setup, chat, previews
  plugins/
    vscode/            # VS Code dev-preview webview host and local runtime launcher
    jetbrains/         # JetBrains dev-preview JCEF host and local runtime launcher
packages/
  contracts/           # Shared schemas, examples, and boundary contracts
product/
  identity.json        # Product identity, package names, storage dirs, URLs, metadata
docs/
  README.md            # Documentation index and verification guidance
  architecture/        # Architecture, identity, safety, publication, and roadmap docs
scripts/               # Validation, smoke, packaging, and local helper scripts
```

## Quick start and verification

Install root dependencies:

```sh
npm ci
```

Run the default repository validation bundle after documentation, identity, or contract-facing changes:

```sh
npm run check
```

Run the local runtime/chat smoke without real provider credentials or hosted services:

```sh
npm run smoke:local
```

Prepare local install-from-file IDE dev-preview artifacts when validating packaged plugin flows:

```sh
npm run prepare:vscode-preview
npm run prepare:jetbrains-preview
```

Generated IDE artifacts, packaged GUI assets, copied engine binaries, checksums, Gradle outputs, `apps/gui/dist`, and root `dist/` outputs are local ignored build products and must not be committed.

## More documentation

- `docs/README.md` — documentation layout, capability matrix, verification matrix, and current dev-preview boundaries.
- `docs/architecture/003-target-architecture.md` — target subsystem boundaries, contracts, storage rules, and roadmap.
- `apps/plugins/vscode/README.md` — VS Code dev-preview setup, runtime modes, and manual smoke guidance.
- `apps/plugins/jetbrains/README.md` — JetBrains dev-preview setup, runtime modes, and install-from-disk guidance.
- `packages/contracts/README.md` — shared schema and contract validation notes.
- `AGENTS.md` — repository rules for future agents and contributors.

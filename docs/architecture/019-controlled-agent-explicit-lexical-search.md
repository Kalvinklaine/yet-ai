# 019 Controlled Agent Explicit Lexical Search

This document defines the S110 explicit lexical search contract for controlled-agent runs and records the S111 VS Code-only executor evidence. S110 was contract and fixture work only. S111 adds a real VS Code host executor for the same bounded bridge request/result contract, but it does not add GUI selection UI, Browser or JetBrains execution, provider search tools, workspace indexing, runtime endpoints, background search, or host capability expansion beyond the explicit VS Code bridge path.

The strict engine schema is `packages/contracts/schemas/engine/controlled-agent-lexical-search.schema.json`. Safe and unsafe engine fixtures live under `packages/contracts/examples/engine/controlled-agent-lexical-search-*.json` and `packages/contracts/examples-invalid/engine/controlled-agent-lexical-search-*.json`. Bridge request/result fixtures for the future controlled lexical search path live under the bridge examples directories and are validated by the existing bridge message schemas. S110-C3 adds `npm run smoke:controlled-agent-lexical-search` as deterministic local/mock evidence over those fixtures and the pure GUI request/result service; it still does not execute VS Code search.


## Contract status

- **Status**: dev-preview contract plus VS Code-only host executor evidence.
- **Authority**: `explicit_literal_lexical_search_metadata`.
- **Execution host**: VS Code is the only host with an implemented executor for this contract. Browser is unsupported for trusted workspace search. JetBrains remains fail-closed until a future verified parity card narrows and proves the path.
- **User gesture**: every request is GUI/user minted, carries a request id, has `explicitUserGesture: true`, and records a user gesture id. Assistant-minted ids or assistant-owned search requests are invalid.
- **Local-first BYOK**: search must not require hosted Yet AI services, accounts, managed gateways, product credits, cloud workspaces, provider tools, or model-side workspace authority.

## Query contract

Queries are literal bounded text only:

- no regex syntax or regex mode;
- no glob syntax or glob mode;
- no path query mode;
- no traversal, private path, drive path, home path, or secret-looking values;
- no shell, git, provider, tool, model, cwd, env, request-id, assistant, token, or credential markers.

This intentionally reuses lessons from `searchWorkspaceSnippets` while giving controlled-agent work its own vocabulary and stricter user-gesture/correlation fields. The older snippet-search bridge action remains backward compatible; this document does not remove it or turn it into controlled-agent authority.

## S111 VS Code executor evidence

The S111 VS Code executor lives in `apps/plugins/vscode/src/controlledLexicalSearch.ts` and handles only `gui.controlledAgentLexicalSearchRequest` messages with host `vscode`, literal text query mode, GUI/user-minted request ids, explicit user gesture metadata, safe workspace-relative include path labels, and deny-by-default policy flags. It returns `host.controlledAgentLexicalSearchResult` metadata with sanitized bounded snippets, hashes, ranges, language ids, counts, truncation flags, and safe summary text.

The deterministic local smoke is `npm run smoke:controlled-agent-real-lexical-search`. It compiles/imports the package-local VS Code executor and runs it against a disposable sentinel workspace without launching VS Code UI, browser automation, providers, runtime services, network, git, package installation, or shell commands beyond local Node and TypeScript test helpers. The smoke verifies a safe literal search, bounded/truncated snippets, hidden/dependency/generated/secret-like/binary/symlink/private-path content rejection, unsafe query/path/raw-marker/private-path cases, malformed authority fields, no private absolute paths, no secrets, no raw broad dumps, and no command/provider/tool output fields in the sanitized report.

This S111 smoke is executor evidence, not S110 contract-only evidence. S110 remains covered by contract schema, fixture validation, and `npm run smoke:controlled-agent-lexical-search`. The VS Code executor evidence does not make Browser supported, does not make JetBrains parity complete, and does not introduce production autonomy, release, marketplace, provider-tool, indexing, background search, broad recursive scan, hidden read, shell, git, or file mutation authority.

## S112 explicit selection evidence

S112 completes the Phase 1 controlled lexical search foundation by adding GUI-local result selection over sanitized lexical search metadata. The selection service accepts only safe `succeeded` lexical-search summaries, requires `explicitUserGesture: true`, rejects assistant-minted selections, summarizes selected result ids into bounded labels/counts/byte and line budgets, and omits snippet bodies from the selected context items. Unsafe, private, secret-like, raw, stale, duplicate, empty, or over-budget selections fail closed with sanitized diagnostics.

The selected context is not prompt attachment authority by itself. Its policy keeps `canAttachToPrompt`, `canAutoAttachContext`, `canAutoSend`, `canAutoApply`, `canAutoRunVerification`, `canCallProvider`, `canReadFileBodies`, `canRunCommands`, `canUseTools`, and `canPersistSelection` false. S113 provider proposal work may consume selected search context only after a later explicit user action and a separate provider proposal contract; S112 does not auto-send, auto-attach, call providers, apply edits, run verification, persist raw browser storage, launch hidden indexing, run commands, use git/package/network/tool authority, or grant provider-tool search.

The deterministic local smoke is `npm run smoke:controlled-agent-search-selection`. It transpiles the pure GUI selection service, feeds mock sanitized lexical-search summaries, verifies safe result selection and bounded summaries, verifies unsafe/private/secret/raw result omission, checks stale/empty/assistant-minted/over-budget failures, and asserts no browser-storage raw persistence or automatic send/attach/provider/apply/verification/search/indexing/command/git/package/network/tool calls. It does not run real providers, real IDE UI automation, real workspace search, Browser automation, JetBrains automation, runtime services, package installation, network calls, git actions, shell commands beyond local Node execution, file mutation, or verification execution.

## Scope and limits

The scope is bounded to the controlled workspace/project and explicit safe path labels. It excludes hidden paths, dependencies, generated output, binary files, secret-like paths, private absolute paths, traversal, broad recursive scans, and project-wide dumps.

Limits are metadata-only contract values: bounded files scanned, bounded matches, bounded snippet bytes, literal-only mode, and explicit false flags for regex, glob, path query, indexing, and background search.

## Result contract

Results contain sanitized snippets and metadata only:

- safe workspace-relative path labels;
- ranges;
- language ids;
- bounded snippets;
- match counts;
- truncation flags;
- byte counts;
- SHA-256 hashes;
- safe summary messages.

Results must not include secrets, private paths, raw broad dumps, raw file bodies, provider payloads, tool payloads, raw commands, shell output, cwd/env values, bridge payload dumps, or storage dumps.

## Explicit non-authority

This S110 contract does not permit:

- background indexing;
- automatic search;
- hidden context gathering;
- provider/tool/search authority from assistant output;
- broad workspace scans;
- regex/glob search;
- free-form command execution;
- file mutation;
- production autonomy, release, marketplace, signing, or publication claims.

## Fixture coverage

Valid fixtures cover one GUI/user-minted VS Code literal search and one sanitized host result. Invalid fixtures reject assistant-minted requests, regex/glob attempts, private/hidden/dependency paths, broad recursive overclaim, indexing, Browser/JetBrains execution overclaim, secret-like snippets, and raw provider/tool/content fields.

## Phase 1 S109-S112 foundation audit

S109-S112 are closed as a Phase 1 foundation for explicit, bounded, user-selected lexical search evidence before S113 provider proposal work. This is not production readiness, not autonomy readiness, not release readiness, and not a provider-proposal implementation.

- **S109 authority registry evidence** supplies fail-closed vocabulary and check integration for lexical-search metadata without runtime, provider, search, apply, verification, storage, or workspace authority.
- **S110 contract and pure GUI request/result evidence** supplies strict engine/bridge fixtures plus a pure GUI request/correlation service for GUI/user-minted VS Code literal search metadata. Browser and JetBrains overclaims fail closed in fixtures and service checks.
- **S111 VS Code execution evidence** supplies the only real host executor currently verified for controlled lexical search. It executes only bounded literal searches from explicit GUI requests in VS Code and returns sanitized metadata. It does not make Browser supported, does not prove JetBrains parity, and does not add hidden indexing, background search, provider tools, shell/git/package/network authority, apply, verification, or file mutation.
- **S112 GUI selection evidence** supplies sanitized selection display/state over accepted search results. Safe results can be explicitly selected and summarized within result/byte/line budgets; unsafe/private/secret/raw/stale results are omitted or blocked. Selection remains GUI-local metadata with all no-auto policy flags false and is ready for S113 only after a separate explicit user action.

Phase 1 has no hidden search or hidden indexing path. Search starts only from an explicit user gesture, uses bounded literal text, and is constrained to safe workspace-relative labels through the VS Code host executor evidence. Browser remains unsupported for trusted workspace search because it has no trusted workspace host. JetBrains remains fail-closed until a future card implements and verifies parity. GUI selection does not persist raw snippets in browser storage, auto-attach context to prompts, auto-send chat, call providers, apply edits, run verification, run commands, use git/package/network/tools, or grant provider-tool authority.

## Verification

Run:

```sh
npm run smoke:controlled-agent-lexical-search
npm run validate:contracts
npm run smoke:controlled-agent-real-lexical-search
npm run smoke:controlled-agent-search-selection
cd apps/plugins/vscode && npm run compile && npm test
npm run check
```

`npm run smoke:controlled-agent-lexical-search`, `npm run validate:contracts`, and `npm run check` are S110 contract/pure-service evidence. The focused S110 smoke is fast and deterministic: it reads tracked S110 fixtures, transpiles the pure GUI lexical-search service, and runs local/mock request/result scenarios only. It is included in the root `npm run check` bundle because it does not launch VS Code, Browser, JetBrains, providers, runtime, workspace search, network, shell, git, file mutation, or real verification.

`npm run smoke:controlled-agent-real-lexical-search` and the VS Code package tests are S111 VS Code executor evidence only. They do not launch VS Code UI, browser automation, providers, runtime services, network, git, package installation, indexing, shell/tool execution, broad workspace scans, or file mutation. The real lexical-search smoke is kept as an explicit focused gate rather than added to `npm run check` so the default repository check does not recompile the VS Code plugin for unrelated documentation/contract work.

`npm run smoke:controlled-agent-search-selection` is S112 GUI pure-service selection evidence only. It stays deterministic local/mock and sanitized, verifies explicit selection and omission boundaries, and remains separate from provider proposal work. It does not launch IDE UI automation, call providers, attach prompt context, apply edits, run verification, index/search in the background, write browser storage, or use command/git/package/network/tool authority.

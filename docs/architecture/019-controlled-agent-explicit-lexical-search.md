# 019 Controlled Agent Explicit Lexical Search

This document defines the S110 explicit lexical search contract for controlled-agent runs. It is contract and fixture work only. It does not implement a VS Code search executor, GUI selection UI, provider search tool, workspace index, runtime endpoint, bridge adapter runtime validator, or host capability expansion.

The strict engine schema is `packages/contracts/schemas/engine/controlled-agent-lexical-search.schema.json`. Safe and unsafe engine fixtures live under `packages/contracts/examples/engine/controlled-agent-lexical-search-*.json` and `packages/contracts/examples-invalid/engine/controlled-agent-lexical-search-*.json`. Bridge request/result fixtures for the future controlled lexical search path live under the bridge examples directories and are validated by the existing bridge message schemas. S110-C3 adds `npm run smoke:controlled-agent-lexical-search` as deterministic local/mock evidence over those fixtures and the pure GUI request/result service; it still does not execute VS Code search.


## Contract status

- **Status**: dev-preview contract only.
- **Authority**: `explicit_literal_lexical_search_metadata`.
- **Execution host**: VS Code is the only host allowed to claim execution in this contract. Browser is unsupported for trusted workspace search. JetBrains remains fail-closed until a future verified parity card narrows and proves the path.
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

## First-phase audit for S111

S109 and S110 are ready for the first VS Code host execution card only as bounded prerequisites:

- S109 supplies the fail-closed authority vocabulary and check integration for lexical-search metadata without runtime authority.
- S110-C1 supplies strict engine and bridge fixtures for GUI/user-minted VS Code literal search plus sanitized host results.
- S110-C2 supplies the pure GUI service that can build a request and correlate a sanitized result while keeping GUI authority display-only.
- S110-C3 supplies deterministic local smoke evidence for safe request summaries, Browser unsupported, JetBrains fail-closed, unsafe query/hidden indexing claims blocked, unsafe result metadata rejected, and no provider/tool/apply/verification authority.

This readiness is not real host execution evidence. S111 must add the VS Code executor separately, keep the request type exactly `gui.controlledAgentLexicalSearchRequest`, preserve `host: "vscode"`, `queryMode: "literal_text"`, explicit `includePathLabels`, sanitized snippets only, and continue to fail closed for Browser and JetBrains.

## Verification

Run:

```sh
npm run smoke:controlled-agent-lexical-search
npm run validate:contracts
npm run check
```

The focused smoke is fast and deterministic: it reads tracked S110 fixtures, transpiles the pure GUI lexical-search service, and runs local/mock request/result scenarios only. It is included in the root `npm run check` bundle because it does not launch VS Code, Browser, JetBrains, providers, runtime, workspace search, network, shell, git, file mutation, or real verification.

These commands validate schemas, fixtures, documentation index, identity, and hygiene. They do not launch a search executor, read workspaces, index files, call providers, execute tools, mutate files, or grant host authority.

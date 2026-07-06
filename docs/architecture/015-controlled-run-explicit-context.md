# 015 Controlled Run Explicit Context Contract

This document defines the S100 contract for explicit multi-file and fragment context in controlled runs. It is a documentation foundation only. It does not add a selector, bridge message, runtime endpoint, file reader, model loop, workspace search, memory retrieval, storage contract, or new host authority.

The goal is narrow: a controlled run may use only context that the user has selected and reviewed for that run, with visible bounded previews and safe labels. Context inclusion is one-shot and expires after the run request is assembled. Yet AI must not gather context by scanning, searching, indexing, memory injection, or workspace discovery behind the user's back. A tidy little basket of selected snippets is allowed; a raccoon with a flashlight in the repository is not.

## Status and scope

S100 is a contract for future implementation work. It keeps the S96 useful-run target conservative while allowing the next design slice to describe multiple selected files or fragments instead of a single selected file.

The contract applies to controlled local dev-preview runs only. It preserves the local-first BYOK boundary: core chat, provider setup, IDE GUI workflows, controlled context review, and sanitized reports must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, cloud workspace, production login, marketplace publication, signing, notarization, real-provider CI, release evidence, or production autonomy.

## Allowed context sources

A controlled run may include context only from these explicit sources:

1. **User-selected workspace file fragment**: a safe workspace-relative text path plus an inclusive line range selected in the host editor or selector UI.
2. **User-selected whole-file preview**: a safe workspace-relative text file may be selected only when the visible preview is bounded by the same byte and line limits as fragments. Whole-file inclusion still means bounded visible content, not hidden full-file capture.
3. **Current active editor selection**: the active editor may contribute only the user-visible selected range or a bounded visible excerpt when the user confirms it.
4. **User-pasted text fragment**: pasted context may be included only after the GUI shows a bounded preview, a user-provided or GUI-derived safe label, and byte/line counts.
5. **User-selected prior verification summary**: a sanitized verification result summary may be attached only when it already exists as safe metadata and the user selects it for this run.
6. **User-selected memory note summary**: a project memory note may contribute only a sanitized summary or safe label after an explicit user selection. Raw memory note bodies are not automatically injected.

Every context item must record a safe label, source kind, bounded byte count, bounded line count where applicable, and whether the visible preview was truncated. Workspace file labels must stay workspace-relative and must not expose absolute paths, home paths, private temp roots, provider secrets, tokens, or credential-looking strings.

## Forbidden context behavior

Controlled context must fail closed for all of these behaviors:

- hidden workspace reads, background reads, recursive directory reads, or unprompted file discovery;
- workspace scan, search, grep, glob, regex search, snippet search, semantic search, embeddings, or indexing as context acquisition;
- automatic memory retrieval, automatic memory attach, automatic task-memory injection, or automatic historical-context injection;
- provider/tool calls to gather context;
- shell, git, package-manager, network, MCP, local-tool, or arbitrary command use for context collection;
- assistant-minted file paths, line ranges, request ids, context ids, trust labels, or authority flags;
- hidden expansion from a selected fragment to a broader file, neighboring file, dependency file, import graph, test file, or repository summary;
- raw full-file persistence in reports, history, trace, telemetry, browser storage, host storage, engine storage, dogfood evidence, or smoke output;
- storing raw prompts, provider responses, file bodies, diffs, replacement text, command strings, cwd/env values, private paths, secrets, bridge payloads, or browser-storage dumps as controlled context evidence.

Selecting a file or fragment grants no write, apply, verification, shell, provider, tool, git, package, network, rollback, retry, repair, or task-board authority. Context is input material only, and only for the bounded run where the user selected it.

## Preview and inclusion rules

The GUI must show a visible preview before a context item can be included. The preview is the user's safety boundary, so it must be small, readable, and honest about truncation.

Minimum preview metadata:

- source kind;
- safe display label;
- workspace-relative path label when applicable;
- start and end lines for file fragments when applicable;
- preview byte count;
- preview line count where applicable;
- truncation flag;
- context item id minted by trusted GUI or host code;
- run id or draft id correlation;
- host surface label.

Suggested initial limits for a future implementation:

| Limit | Initial contract value |
| --- | --- |
| Maximum context files per run | 5 |
| Maximum fragments per run | 10 |
| Maximum bytes per item preview | 8 KiB |
| Maximum lines per item preview | 240 |
| Maximum total context bytes per run | 24 KiB |
| Maximum total context lines per run | 600 |
| Maximum label length | 120 characters |

A future card may adjust these values only with an updated contract, invalid fixtures, and audit evidence. Until then, implementations should treat them as hard upper bounds and stop before silently truncating into misleading context.

Context inclusion is one-shot:

1. The user selects files or fragments.
2. The GUI displays bounded previews and safe labels.
3. The user confirms inclusion for the current controlled run draft.
4. The run request uses those selected items once.
5. Accepted send, cancellation, host change, run stop, runtime disconnect, or draft reset clears the selected context bundle.

The same selected context must not be reused for a later run without another explicit user confirmation.

## Safe labels and sanitization

Safe labels are display and report labels, not authority. A label may contain a filename, workspace-relative path, line range, source kind, and short user-facing description. It must not contain raw file bodies, raw prompt text, raw provider output, command text, absolute paths, secrets, credential markers, or private host metadata.

Sanitized reports may include:

- selected context count;
- safe file labels;
- safe fragment labels;
- line ranges;
- byte and line counts;
- truncation flags;
- omitted unsafe item counts;
- blocked reasons;
- run correlation ids that are sanitized and non-secret.

Sanitized reports must not include raw full-file content or raw fragment bodies. If a report needs evidence that context was used, it should use counts, hashes, safe labels, and truncation metadata only.

## Host responsibility boundaries

### Browser / standalone GUI

Browser preview may render the selector shell, empty state, pasted-text preview, and unsupported-state copy. It has no trusted workspace host and must not read workspace files, search the workspace, index the workspace, post privileged read/edit/command bridge messages, or imply trusted controlled execution. Browser-selected context is limited to user-pasted text and local mock fixtures unless a future approved host boundary changes this.

### VS Code

VS Code is the primary trusted dev-preview host for explicit workspace context. It may provide user-selected active editor ranges and selected safe workspace-relative text fragments to the GUI after user action. The extension must enforce workspace-relative path checks, line and byte budgets, text-only handling, request correlation, unsupported-file blocking, and sanitized result metadata. It must not expand selections through search, indexing, import graphs, dependency discovery, or background reads.

### JetBrains

JetBrains may render hosted GUI selection UX and manual parity copy. Until a future verified parity card implements the same trusted controlled context path, JetBrains must fail closed for workspace-file context execution and show unsupported or partial labels. It must not silently fall back to broader file reads, search, indexing, or raw path disclosure.

### Engine/runtime

The engine may receive only the bounded selected context bundle assembled by trusted GUI or host code. It must treat context as transient request input, not as a durable corpus. It must not independently scan, search, index, retrieve memory, expand file paths, call tools, or persist raw file bodies for controlled context.

## Future implementation split

Future implementation must stay split into narrow reviewable parts:

1. **Pure context service**: validates item shapes, limits, safe labels, truncation flags, one-shot clearing rules, and report sanitization without file I/O, storage, provider calls, bridge calls, or workspace mutation.
2. **GUI selector**: presents selected items, visible previews, blocked reasons, host limitations, total budgets, and explicit confirm/remove controls without automatic attach.
3. **Focused smoke**: proves explicit selection, visible bounded preview, one-shot inclusion, no hidden scan/search/indexing, no automatic memory/context injection, browser unsupported behavior, VS Code allowed path behavior, JetBrains fail-closed behavior, and sanitized reports.
4. **Audit**: checks wording, host boundaries, limit enforcement, raw-data non-persistence, local-first BYOK preservation, unsupported-host copy, and public evidence hygiene.

These parts must not be collapsed into a broad runtime feature. Each future card should open only the narrow capability it verifies.

## Verification

For this S100 documentation contract, run:

```sh
npm run audit:controlled-autonomy-wording && npm run check && git diff --check && git status --short
```

This gate validates public wording hygiene, repository docs checks, whitespace hygiene, and tracked status. It does not call providers, require hosted services, read workspaces, search or index files, run a controlled agent, mutate files through the product, publish artifacts, or prove production autonomy.

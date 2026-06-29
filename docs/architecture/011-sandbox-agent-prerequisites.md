# 011 Sandbox Agent Prerequisites

This note defines prerequisites for a future experimental sandbox-agent mode. It is planning guidance only: Yet AI does not currently implement a sandbox agent, autonomous workspace mutation, arbitrary tool execution, shell access, git push, background project scanning, or new runtime authority.

The future mode must preserve Yet AI's local-first BYOK contract. Core workflows must continue to work without a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace. Runtime lifecycle readiness can provide prerequisite diagnostics, but it is metadata only and never grants authority.

## Entry conditions

A sandbox-agent experiment may be considered only after all of these conditions are documented, reviewed, and covered by local deterministic evidence:

1. The mode is explicit user opt-in, labeled experimental, and disabled by default.
2. The user is guided to run it only on a disposable or test project, not on a primary production workspace.
3. The host creates or verifies a workspace checkpoint before the run starts.
4. A rollback plan is documented, tested, and visible before any auto-apply behavior is allowed.
5. The run has fixed limits for maximum steps, maximum touched files, and maximum patch size.
6. Verification is limited to reviewed allowlisted command ids; no free-form command, args, cwd, env, package install, network, or shell string is accepted.
7. Arbitrary shell execution is unavailable.
8. Git push, remote writes, release publishing, package publishing, and other remote mutations are unavailable.
9. Home-directory access is unavailable.
10. Secret-file access is unavailable, including credential stores, token files, SSH keys, shell history, environment dumps, and provider config secrets.
11. Hidden reads, search, recursive scans, background indexing, and unprompted context gathering are unavailable.
12. A full sanitized event trace exists before any agent loop starts.
13. A deny-by-default authority policy exists before any agent loop starts.
14. Browser surfaces remain preview/connect-only unless a separate reviewed local desktop shell owns runtime launch and host authority.
15. Runtime lifecycle readiness is checked only as prerequisite metadata; it does not imply permission to read files, apply edits, run verification, call tools, or launch a runtime.

## Required authority model

The authority model must start closed and open only narrowly documented capabilities. Every capability needs a schema, host support declaration, origin/source check, request correlation minted by trusted GUI or host code, explicit user confirmation where risk exists, sanitized progress/result events, and positive plus invalid fixtures.

The Sprint 40 `tool_authority_policy` contract is the first inert fixture shape for that closed authority model. It records proposed capability, source, risk, requirements, and decision metadata only; it is not a sandbox-agent evaluator and does not let a sandbox run. Its default decision is always `deny`, it preserves `cloudRequired: false`, and it rejects assistant-minted request ids, free-form command/cwd/env material, unsafe paths, secret markers, hidden-read metadata smuggling, and unknown authority fields. High-risk capabilities remain deny-only fixtures until a later reviewed contract and implementation deliberately opens a narrower slice.

The Sprint 41 `experimental_sandbox_session` contract is the next inert fixture shape for this sequence. It records only disabled/opted-in/checkpoint/rollback mode status, explicit user opt-in metadata, bounded limits, checkpoint ids/counts/hashes, and rollback plan ids/counts/hashes. It is metadata-only and does not implement a sandbox agent, bridge commands, runtime endpoints, checkpoint creation, rollback execution, file reads, edit application, verification runs, shell/git/tool/provider/network access, hidden scans, auto-apply, auto-run, auto-rollback, or any agent loop. Non-disabled states require user-origin opt-in and limits; checkpoint and rollback readiness require verified checkpoint metadata plus rollback plan metadata. Assistant-origin opt-in and authority-looking fields must fail closed.

Sprint 41 also has a local checkpoint/rollback substrate smoke, `npm run smoke:sandbox-checkpoint`. That smoke is deterministic evidence for disposable-workspace checkpoint creation and exact-byte restore only. It creates a temp directory, requires `.yet-ai-disposable-workspace.json`, snapshots explicit relative files, mutates/deletes them, restores the checkpoint, and asserts that manifests and reports contain hashes/counts rather than raw file bodies or private absolute paths. Unsafe inputs fail closed, including missing sentinel, absolute/traversal/home/hidden/secret-like paths, symlinks, oversized files, command/cwd/env metadata, and background scan requests. The smoke remains local temp-dir evidence only and grants no IDE, shell, git, network, provider, tool, background scan, auto-rollback, or agent-loop authority.

S41-C5 final audit status: Sprint 41 remains limited to explicit experimental metadata, pure GUI readiness evaluation, and local disposable checkpoint evidence. The reviewed contract, evaluator, checkpoint helper, and smoke add no arbitrary shell/git/tool execution, provider tool calls, bridge execution messages, hidden reads/search/indexing/background scans, home/secret/private-path/network/remote-publish authority, auto-send, auto-apply, auto-run verification, or auto-rollback. Assistant output cannot opt into sandbox mode or mint authority, the evaluator always returns non-executing display state, checkpoint inputs are explicit files in sentinel-marked disposable workspaces, manifests and reports are sanitized to counts/hashes/labels, and the coding-session trace remains read-only metadata. The local-first BYOK/no-hosted-backend invariant is preserved.

Sprint 42 builds on that completed baseline with a bounded patch verification loop contract only. The new `bounded_patch_verification_loop` fixture can say that a verified checkpoint exists, a bounded patch proposal is ready or applied, and one allowlisted verification `commandId` is ready or has returned sanitized result metadata. It cannot start a sandbox agent, apply a patch, run verification, infer a rollback, create an autonomous step loop, or broaden the future sandbox prerequisites. Ready/apply states require verified checkpoint metadata, and blocked states remain valid when prerequisites are missing.

Sprint 42 also adds a local disposable bounded patch substrate smoke, `npm run smoke:bounded-patch-loop`. That helper remains narrower than a sandbox agent: it accepts only explicit replacement edits against files already covered by a verified checkpoint manifest in a sentinel-marked temp workspace, validates all target hashes and ranges before writing, and evaluates verification requests only as fixed in-process allowlist metadata for `repository-check`, `gui-app-tests`, and `engine-chat-tests`. It rejects unsafe paths, hidden/secret/generated/dependency/build segments, symlinks, binary or oversized files, create/delete/rename/move intents, raw command/cwd/env/args metadata, unknown verification ids, and background scan requests. It does not spawn shell commands, run git/network/provider/IDE APIs, scan workspaces, create an autonomous loop, or expose raw file bodies/private paths in reports.

Sprint 73 adds `packages/contracts/schemas/engine/controlled-agent-workspace-readiness.schema.json` as another prerequisite-only contract. It records whether a future controlled-agent workspace mode is disabled, disposable, worktree-based, or existing, plus host, user-origin opt-in evidence, isolation/checkpoint/rollback/limit summaries, and explicit false policy flags. This contract is metadata-only: it does not create a disposable workspace or worktree, choose or expose a private path, start an agent, add a bridge message, add a runtime endpoint, read or write files, run verification, call shell/git/provider/tool APIs, apply patches, run rollback, or grant auto-start/auto-apply/auto-run/auto-rollback authority. User opt-in may be displayed as readiness provenance, but it grants no start authority and cannot be supplied by an assistant. The local-first BYOK invariant remains unchanged; no hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace is required.

Sprint 74 adds `packages/contracts/schemas/engine/controlled-agent-file-read.schema.json` as the first narrow explicit read-authority contract for future controlled-agent work. It is intentionally only a bounded text read request/result metadata shape inside an already controlled workspace. It requires trusted GUI- or host-minted request correlation, controlled workspace/run ids, a single workspace-relative path, text-only expectation, small max-byte and max-line budgets, and explicit `allowBody` budget metadata before any bounded text body may appear. It preserves the existing no-hidden-context rule: no background reads, no recursive search, no globs, no regex, no workspace indexing, and no unprompted context gathering. It also preserves no write/command/provider authority: no file write, apply, shell, git, tool, provider, verification, network, agent-start, auto-run, or rollback permission is created. Unsafe absolute/traversal/home/private/hidden/secret/dependency/build/generated paths, binary reads, symlink traversal, oversized bodies, assistant-minted request ids, and command/cwd/env/git/tool/provider fields must fail closed.


Assistant output is never authority. A model may propose a step, edit, or verification intent, but trusted Yet AI code must validate it against policy before display, and the host must still enforce its own policy before execution. Unsupported hosts fail closed. Browser preview remains non-executing for workspace mutation.

## Safety bounds

A sandbox-agent run must have visible stop conditions and bounded effects:

- stop when the step, file, patch, time, or verification limit is reached;
- stop on policy ambiguity rather than guessing;
- stop on checkpoint or rollback failure;
- stop before accessing paths outside the workspace;
- stop before touching secret-like, generated, binary, dependency, or ignored files unless a reviewed policy explicitly allows a narrow case;
- stop before any operation that would require shell, git remote, network, provider-tool, or hosted-service authority.

Event traces must be sanitized before storage or display. They may include phase/status enums, bounded safe labels, counts, timestamps, selected allowlisted command ids, and short redacted result tails. They must not include prompts, hidden reasoning, raw file bodies, provider responses, tokens, keys, cookies, auth headers, private absolute paths, shell scripts, git remotes, or unbounded logs.

## Sequencing for S39/S40/S41 planning

A conservative sequence is:

1. Define the deny-by-default policy and sandbox event trace schemas with invalid fixtures.
2. Add inert GUI review surfaces that show planned steps, limits, checkpoint status, and stop/rollback guidance without execution controls beyond existing safe actions.
3. Prove checkpoint and rollback behavior with local mock or disposable-project smokes.
4. Add one narrow host-owned capability at a time, starting from existing confirmed edit and allowlisted verification boundaries.
5. Re-run security review before any auto-apply or looped execution is enabled.

Until these gates are complete, docs and UI should describe sandbox-agent work as future experimental planning only, not implemented, not production-ready, and not a replacement for user-reviewed edits and verification.

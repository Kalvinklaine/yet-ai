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

# 008 Reference Divergence Guardrails

Yet AI may learn from external and reference implementations as architectural signal, but it remains a standalone local-first product. Reference material can inform decisions about boundaries, failure modes, lifecycle shape, and verification strategy. It must not turn Yet AI into a fork, copy, or renamed distribution of another product.

This document records public-safe guardrails for using references without importing private comparison notes, source paths, or third-party identifiers into tracked product files.

## Product boundary

Yet AI owns its product identity, runtime contracts, storage names, user experience, plugin packaging, release surfaces, and documentation voice. The source of truth for product-sensitive values remains `product/identity.json`.

Reference inspection may influence architecture only when the resulting design is expressed in Yet AI terms and fits the local-first BYOK contract. Public docs, code, scripts, tests, assets, package metadata, and examples should describe Yet AI behavior directly rather than naming or embedding an external source.

This guardrail does not claim that any new runtime, daemon, provider system, tool engine, GUI component, or packaging feature is implemented. It is a policy for future design and review.

## Conceptual patterns that may be adopted

The following reference patterns are acceptable as conceptual signal when they are re-designed for Yet AI contracts and verified incrementally:

- lifecycle supervision for local runtime processes, restarts, health checks, and bounded diagnostics;
- event replay and snapshot recovery for chat, progress, or runtime state;
- provider capability normalization that turns provider-specific details into sanitized local readiness metadata;
- policy-driven tool authority with explicit schemas, allowlists, request correlation, and user confirmation for risky actions;
- artifact rendering for safe, bounded, product-owned previews and reports;
- edit/apply separation where model output is only a proposal until the user reviews and confirms a bounded host apply action;
- IDE lifecycle parity across supported hosts, with each plugin remaining thin and platform-specific authority staying behind explicit bridge contracts.

These are design ideas, not permission to copy implementation. Each feature still needs its own task, contract, tests, and safety review before code exists.

## Material requiring separate approval

Direct copying, substantial adaptation, vendoring, or publication reuse requires explicit approval plus provenance, licensing, and attribution review before it enters tracked product files or release artifacts. This includes, but is not limited to:

- source files, generated files, build scripts, tests, or fixtures;
- provider catalogs, provider-specific request routing, capability tables, or auth flows;
- daemon routes, process supervisors, lifecycle managers, or local API shapes;
- patch, diff, edit, apply, merge, or verification engines;
- GUI components, visual layouts, icons, screenshots, onboarding flows, marketplace copy, or other user-facing assets;
- product identifiers, package names, storage directories, command prefixes, settings namespaces, URLs, publishers, or release artifact names;
- public wording from docs, READMEs, examples, prompts, UI labels, release notes, or marketplace listings.

If reuse is approved later, the approving task should document the exact source, license, required notices, adaptation boundary, Yet AI-owned interface, verification command, and ongoing sync or ownership policy.

## Public hygiene rule

Tracked public files must stay free of external project identifiers, local external source paths, private scan notes, and comparison details. That rule applies to documentation, source code, comments, tests, scripts, examples, generated files, package metadata, and release artifacts.

Private reference details belong only in ignored local notes, task memories, or task documents that are not published as product files. Public architecture documents should use generic wording such as “reference implementation,” “external implementation,” or “reference pattern” when explaining the policy.

Before merging reference-related work, run the repository hygiene checks required by the task and inspect the diff for accidental identifier, path, asset, or wording leakage.

## Current safety boundaries

Reference-guided work must preserve the active Yet AI safety boundaries unless a future architecture record explicitly changes them and the implementation verifies the change:

- core workflows stay local-first BYOK and must not require a hosted Yet AI backend, Yet AI account, managed model gateway, product credit balance, or cloud workspace;
- provider settings and credentials remain local runtime state, and GUI-facing responses must not return raw provider secrets after save;
- model output must not auto-send prompts, auto-apply edits, auto-run verification, or auto-fix failures;
- workspace context must come from explicit user-selected attachments or approved host actions, not hidden reads, hidden search, background indexing, or silent workspace scans;
- shell, git, tool execution, task mutation, file mutation, and provider-tool authority remain unavailable unless future contracts define strict schemas, policy checks, request correlation, sanitized audit behavior, and user confirmation where appropriate;
- browser and preview surfaces remain non-privileged unless a future card explicitly implements and verifies a bounded authority path.

## Review checklist

Use this checklist when a future task references outside implementations:

1. Is the change expressed as a Yet AI-owned contract, UI, storage rule, or runtime behavior?
2. Does it avoid external identifiers, private paths, copied wording, copied assets, and source-level adaptation unless separately approved?
3. Does it preserve local-first BYOK behavior and direct configured-provider access for core workflows?
4. Does it avoid adding hidden reads, background indexing, auto-send, auto-apply, auto-verify, shell/git/tool execution, or workspace mutation?
5. Does it include focused verification and update the relevant architecture or contract docs before irreversible implementation decisions?

If any answer is no, keep the detail private, split the task, or request explicit approval before implementation. Quiet copies are how gremlins get furniture; Yet AI should keep its own house keys.

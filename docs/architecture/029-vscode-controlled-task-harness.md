# 029 VS Code Controlled Task Harness Contract

This S125-C1 record defines the deterministic metadata contract for one VS Code-first controlled task journey. The harness is a dogfood hardening boundary, not a product readiness decision. It does not add implementation, widen authority, approve production, approve release, approve marketplace publication, approve signing or notarization, or require a hosted Yet AI backend.

## Boundary

The harness describes one controlled journey from user task start through explicit recovery or follow-up:

1. user selects a bounded task preset;
2. user explicitly selects context and visible search results;
3. proposal metadata is detected and then accepted, rejected, or blocked by explicit user review;
4. patch-plan metadata is reviewed before any apply request;
5. apply metadata is explicit, bounded, and user confirmed;
6. verification bundle metadata uses fixed allowlisted command IDs and user confirmation;
7. follow-up and recovery metadata only suggest a user-chosen next step;
8. stale, duplicate, missing, or mismatched correlation lineage fails closed.

The schema is `packages/contracts/schemas/engine/controlled-agent-task-harness.schema.json`. The safe fixture is `packages/contracts/examples/engine/controlled-agent-task-harness-vscode-happy-path.json`. Unsafe fixtures live under `packages/contracts/examples-invalid/engine/` and cover raw data, hidden authority, unsupported browser host, stale lineage acceptance, and production or release overclaim.

## Metadata-only contract

The contract may record identifiers, counts, booleans, enum states, bounded timestamps, and sanitized summaries. It must not contain:

- raw prompt text;
- file bodies or file excerpts;
- diffs, replacement bodies, or generated patch text;
- command text, args, cwd, env, output, logs, or stack traces;
- provider payloads, provider responses, provider tool calls, or model-private data;
- private paths, secrets, access tokens, cookies, API keys, or local credential material.

A harness record is suitable for deterministic contract validation and sanitized dogfood notes only. It is not a replay log and cannot reconstruct edits, commands, prompts, or provider responses. A sleepy contract is safest when it cannot remember the juicy bits.

## Authority model

The harness is deny-by-default. It records only the user-visible gates needed to harden the VS Code task workflow:

- task preset selection does not grant context, provider, apply, verification, or recovery authority;
- context and search are explicit selected metadata only;
- proposal metadata does not grant provider tool authority or raw provider persistence;
- patch-plan review does not store raw diffs or replacement text;
- apply is limited to explicit, bounded, existing text-file mutation metadata and requires user confirmation;
- verification is limited to fixed allowlisted command IDs and requires user confirmation;
- follow-up and recovery are manual guidance only.

The harness forbids hidden reads, hidden search, indexing, background scans, auto-send, auto-apply, auto-verify, auto-repair, arbitrary shell, free-form command fields, args, cwd, env, git mutation, package installation, network authority, provider tools, local tools, and broad workspace mutation.

## Host support

VS Code is the only supported execution host for this harness contract. Browser is unsupported for trusted execution and is intentionally rejected by the schema. JetBrains remains partial and fail-closed: the schema can represent a non-executing JetBrains partial state, but the VS Code controlled task harness must not claim JetBrains parity or execution readiness.

## Correlation and fail-closed states

Every journey records a lineage ID and a lineage status. Valid lineage may proceed through reviewed proposal, patch, apply, verification, and manual follow-up metadata. Stale, duplicate, missing, or mismatched lineage must fail closed:

- proposal decision is blocked;
- patch-plan decision is blocked;
- apply is blocked or not requested and user confirmation remains false;
- verification is blocked or not requested and user confirmation remains false;
- recovery remains manual and cannot run repair, resend provider context, or rerun verification automatically.

Invalid lineage must never be accepted after the fact. The `acceptedAfterInvalidLineage` flag is fixed to false.

## Readiness claims

The contract may claim only that the harness metadata is dogfood-ready for the hardening wave when the schema and fixtures validate. It must keep production, release, and marketplace readiness false. Any stronger claim still requires separate evidence for storage/privacy inventory, host-owned execution proof, CI stability, packaged install/update/recovery, support diagnostics, signing, notarization, publication, and real-provider dogfood review.

## Verification

Run from the repository root:

```sh
npm run validate:contracts
npm run check
git diff --check
```

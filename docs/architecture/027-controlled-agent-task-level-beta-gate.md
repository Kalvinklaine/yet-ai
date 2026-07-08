# Controlled Agent Task-Level Beta Gate

S123 defines a packaged VS Code task-level beta gate for end-to-end useful controlled tasks. This is report and gate documentation only. It does not add packaged automation, runtime authority, bridge authority, provider behavior, apply execution, verification execution, storage, release automation, marketplace publication, signing, notarization, or production approval.

The gate is dev-preview evidence for install-from-file or local packaged VS Code artifacts. It is separate from production, release, marketplace, publication, signing, notarization, and support approval. Passing this gate means a human reviewed sanitized evidence from a bounded controlled task flow; it does not mean Yet AI is approved for public release or marketplace distribution.

## Gate scope

Use this gate only for a small, reversible, user-approved task in a safe local checkout with a packaged or local dev-preview VS Code artifact. Browser can be mentioned only as preview-only/unsupported for trusted workspace execution. JetBrains can be mentioned only as partial/fail-closed unless a later card adds equivalent packaged task-level evidence.

The beta gate ties together the existing controlled-agent surfaces:

1. A task preset is selected by the user before task drafting.
2. Explicit context and bounded lexical search evidence are selected by the user before provider proposal use.
3. A provider proposal is received, reviewed, and summarized with sanitized labels only.
4. A bounded multi-file patch plan is reviewed before any apply decision.
5. Apply happens only after explicit user approval and only when the plan is safe for the existing controlled apply path.
6. An allowlisted verification bundle is run only after explicit user approval.
7. Follow-up or recovery guidance is shown when verification, provider, host, stale result, or apply safety conditions require a manual next choice.
8. Final report, export, and history evidence are sanitized before sharing or tracking.

## Required beta gate observations

Record labels, counts, status names, hashes when already safe, and short summaries only. Keep untested fields as `not run`.

| Gate area | Required observation | Allowed status examples |
| --- | --- | --- |
| Packaged VS Code artifact | The user identifies a local dev-preview VS Code package or local dev checkout artifact family | `packaged dev-preview`, `local dev checkout`, `not run` |
| Task preset | The user selects a preset before drafting or provider send | `fix-small-bug`, `add-focused-test`, `refactor-small-function`, `explain-selected-code`, `improve-copy-or-typing`, `not run` |
| Explicit context/search | The user selects bounded context and/or bounded search results before provider proposal use | `context selected`, `search selected`, `context and search selected`, `blocked`, `not run` |
| Provider proposal | The proposal is received and reviewed without storing raw prompt or response material | `reviewed`, `rejected safely`, `provider unavailable`, `not run` |
| Multi-file patch plan | The user reviews bounded file/edit metadata before apply | `reviewed`, `blocked by policy`, `read-only preset`, `not run` |
| Explicit apply | Apply is skipped, rejected, or explicitly approved only when safe | `explicit apply accepted`, `apply skipped`, `apply rejected`, `not applicable`, `not run` |
| Verification bundle | A fixed allowlisted command-id bundle is explicitly run or skipped with a safe reason | `bundle passed`, `bundle failed`, `bundle skipped`, `blocked`, `not run` |
| Follow-up/recovery | Manual guidance appears for failure, timeout, unsupported host, stale state, mismatch, or repair exhaustion | `recovery shown`, `follow-up drafted`, `stopped`, `not applicable`, `not run` |
| Final evidence | Final report/export/history evidence is sanitized and bounded | `sanitized report checked`, `export/history checked`, `issue fixed before sharing`, `not run` |

## Deterministic smoke bundle

Run the packaged task-level beta smoke bundle from the repository root:

```sh
npm run smoke:controlled-agent-task-beta-bundle
```

The bundle is fail-fast and requires every referenced child package script to exist. It preserves child command output and fails if any child gate fails. It is deterministic local/mock evidence only; it does not launch real providers, use provider credentials, require hosted Yet AI services, require an account, require a managed gateway, require product credits, use a cloud workspace, sign artifacts, publish artifacts, approve release, approve marketplace distribution, or grant production status.

Child gates and purpose:

| Child gate | Purpose |
| --- | --- |
| `npm run smoke:controlled-agent-search-selection` | Verifies explicit bounded controlled search/context selection and unsafe/private/raw omission. |
| `npm run smoke:controlled-agent-task-presets` | Verifies safe task preset metadata, visible user gates, and no automatic send or authority. |
| `npm run smoke:controlled-agent-patch-plan-preview` | Verifies bounded multi-file patch-plan review metadata and unsafe edit rejection. |
| `npm run smoke:controlled-agent-two-step-run` | Verifies staged task run metadata for review, explicit apply/verification gates, and sanitized follow-up state. |
| `npm run smoke:controlled-agent-recovery-matrix` | Verifies visible recovery guidance and blocks unsafe automatic recovery or raw/private/secret metadata. |
| `npm run dogfood:controlled-agent-task-beta-report -- --check-template` | Verifies the S123 report template remains complete and sanitized. |
| `npm run dogfood:controlled-agent-task-beta-report -- --self-test` | Verifies sanitized report acceptance and unsafe evidence rejection. |

Bundle output must stay sanitized: labels, command ids, child script names, counts, and bounded summaries are allowed; raw prompts, responses, file bodies, diffs, replacements, commands, output dumps, cwd/env/process material, private paths, secrets, provider payloads, bridge dumps, and browser-storage dumps are not allowed.

## Report template

Use the validator command to print the current template:

```sh
npm run dogfood:controlled-agent-task-beta-report -- --template
```

The tracked template/check contract requires these sections:

- `Run metadata` for artifact family, host, date label, runtime/provider family, and dev-preview scope.
- `Task-level gate checklist` for preset, context/search, provider proposal, patch plan, explicit apply, verification bundle, follow-up/recovery, and final evidence.
- `Sanitized evidence checklist` for all forbidden raw/private/secret material and overclaims.
- `Result` for sanitized outcome, usefulness summary, blockers, and follow-up.

Completed reports should stay in ignored local evidence locations unless a later task explicitly asks for a sanitized tracked example. Shared reports must contain only safe labels and short summaries.

## Forbidden report evidence

The validator rejects unsafe evidence markers for secrets, credentials, bearer tokens, auth codes, cookies, runtime tokens, private paths, secret URL parameters, raw prompts, raw provider/assistant responses, raw file bodies, raw diffs, raw replacements, raw commands, raw output, cwd/env/process material, provider payloads, bridge payloads, browser storage dumps, hidden authority claims, and hosted Yet AI backend/account/managed gateway/product credit/cloud workspace requirements.

The report must not claim production approval, release approval, marketplace approval, publication approval, signing, notarization, real-provider CI, automated real-provider coverage, or hosted-service readiness. It may only state dev-preview beta gate observations.

## Check and self-test behavior

The deterministic validator is local and metadata-only:

```sh
npm run dogfood:controlled-agent-task-beta-report -- --check-template
npm run dogfood:controlled-agent-task-beta-report -- --self-test
npm run dogfood:controlled-agent-task-beta-report -- --check path/to/local-report.md
```

- `--check-template` validates the tracked template/gate text for required sections and unsafe markers.
- `--self-test` validates one sanitized example and confirms unsafe samples are rejected.
- `--check` validates a bounded local report file without writing output or calling providers.

The validator never launches VS Code, calls providers, reads workspaces beyond the named report file, runs verification bundles, mutates files, posts bridge messages, contacts networks, writes reports by default, signs artifacts, publishes artifacts, or approves release/marketplace status.

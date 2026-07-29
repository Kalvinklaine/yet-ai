# ADR 040: Agent Execution and Architecture Discipline

- Status: accepted
- Plan traceability: master-plan v5, Wave 0, T-157
- Scope: repository guidance, task execution, review, and verification

## Context

Yet AI has several independently verified subsystems and a growing set of architecture records, contracts, smokes, and manual evidence. A task can still drift when its card omits the owning boundary, when documentation evidence is reported as implementation, or when a broad check substitutes for the focused gate of the changed subsystem.

Documentation cannot prove that an agent read, understood, or remembered a rule. Fake proof-of-reading receipts would create ceremony without assurance. Enforcement instead comes from explicit card context, deterministic validators, diff review, focused tests, acceptance commands, and code review.

## Decision

Every implementation card must provide one canonical pre-edit path: read this ADR, read the root guidance, read the owning subsystem guidance, read the relevant architecture contract, and inspect the exact target files before editing. Cross-cutting implementation work also reads `docs/architecture/004-implementation-strategy.md`. The card remains the scope authority and must name its traceability, acceptance criteria, verification command, and non-goals.

Agents preserve the local-first BYOK contract, apply deny-by-default policy to privileged behavior, keep raw provider secrets engine-owned, and maintain provenance and publication safety. Architecture documentation is updated before irreversible layout, protocol, storage, identity, authority, or packaging decisions.

## Required-reading matrix

| Change area | Required guidance before editing | Owning boundary |
| --- | --- | --- |
| Cross-cutting architecture, identity, contracts, scripts, or repository policy | `AGENTS.md`, this ADR, `docs/README.md`, `docs/architecture/003-target-architecture.md`, `docs/architecture/004-implementation-strategy.md`, and the task-linked architecture record | The card must name one primary owner; `scripts` validates and orchestrates but contains no hidden product behavior |
| Engine | Root guidance, this ADR, `apps/engine/README.md`, target architecture, and the relevant engine/API/storage/security contract | Local runtime authority for provider adapters, credentials, direct provider calls, HTTP/SSE/LSP, tools, and engine-owned storage |
| GUI | Root guidance, this ADR, `apps/gui/README.md`, target architecture, and the relevant UI/client contract | Presentation and typed engine/IDE clients; no raw-secret persistence, provider adapters, filesystem mutation, or shell authority |
| VS Code plugin | Root guidance, this ADR, `apps/plugins/vscode/README.md`, target architecture, and the relevant bridge/host contract | Thin trusted host for runtime lifecycle, webview, IDE bridge, and optional LSP client; no provider adapters or duplicated engine state |
| JetBrains plugin | Root guidance, this ADR, `apps/plugins/jetbrains/README.md`, target architecture, and the relevant bridge/host contract | Thin trusted host for runtime lifecycle, JCEF bridge, and platform integration; no provider adapters or duplicated engine state |
| Product identity or packaging | Root guidance, this ADR, `product/identity.json`, `docs/architecture/001-product-identity.md`, `docs/architecture/005-publication-hygiene.md`, and the relevant packaging record | Central identity contract and explicit dev-preview/release boundaries |

If a card spans more than one row, it must explicitly name each touched boundary and the cross-subsystem contract joining them. Reading additional documents is allowed; silently broadening implementation scope is not.

## Task and card traceability

Before editing, a card must state:

1. the plan, wave, issue, or decision that authorizes the work;
2. exact target files or narrowly bounded directories;
3. acceptance criteria stated as observable outcomes;
4. the exact verification command or commands;
5. non-goals and authority boundaries;
6. relevant mandatory reading from the matrix above.

Implementation and tests must trace back to those acceptance criteria. Unrelated cleanup, adjacent roadmap work, and speculative scaffolding require another card. If a blocking ambiguity changes ownership, authority, protocol, storage, or publication meaning, stop and ask rather than inventing a fallback.

## Implementation and evidence vocabulary

Implementation status and evidence status are separate dimensions and must not be collapsed into words such as “done” or “supported” without qualification.

Allowed implementation status vocabulary:

- `implemented`: product code is reachable on the stated live boundary.
- `partial`: a bounded product path exists, but named capabilities or hosts remain absent or fail closed.
- `planned`: architecture or card intent exists without a reachable product implementation.
- `unsupported`: the product intentionally provides no capability on the stated boundary.

Allowed evidence status vocabulary:

- `verified`: the named command or manual procedure passed against the stated revision and environment.
- `agent_reported`: an agent reported a result that the current reviewer or verifier did not independently capture.
- `not_run`: the evidence procedure was not executed.
- `failed`: the evidence procedure ran and did not pass.

Fixtures, schemas, documentation, screenshots, archive inspection, local reducers, mock smokes, and manual reports prove only their stated evidence boundary. They do not by themselves upgrade `planned` or `partial` behavior to `implemented`, prove live engine or host provenance, or establish production, release, marketplace, signing, or support readiness.

## Verification tiers

Cards select the smallest sufficient tier and add every lower tier relevant to the changed files. A higher tier does not erase a focused lower-tier failure.

| Tier | Stable label | Required use |
| --- | --- | --- |
| Tier 0 | `tier_0` | Deterministic documentation, identity, schema, fixture, formatting, and static validators. Documentation-only changes run root `npm run check` and diff hygiene at minimum. |
| Tier 1 | `tier_1` | Focused owner-subsystem compile, typecheck, lint, and unit tests for changed behavior. |
| Tier 2 | `tier_2` | Cross-subsystem contract, integration, routed GUI, bridge, engine, or bounded executor smoke for a changed user or protocol journey. |
| Tier 3 | `tier_3` | Artifact, installed-host, real-provider manual BYOK, release-candidate, or publication evidence. This tier requires explicit card approval and sanitized evidence; it never follows automatically from lower tiers. |

The card records which tier is required and why. Missing dependencies or pre-existing failures are reported accurately; they are not converted into passing evidence by documentation, fixtures, or a narrower unrelated command.

## Self-verification and handoff

Before handoff, the implementing agent must:

1. compare the diff to every acceptance criterion and non-goal;
2. run the exact card command and focused tests required by the selected verification tier;
3. run `git diff --check` and inspect changed public metadata;
4. report changed files, tests, commands, outcomes, assumptions, and residual risks;
5. distinguish `verified`, `agent_reported`, `not_run`, and `failed` evidence without embellishment.

No receipt can prove cognition. The durable assurance chain is explicit task context, machine-checked document structure, reviewable diffs, executable tests, and reviewer judgment.

## Review and fix gates

The planner or reviewer compares the candidate diff with the card, current architecture, subsystem ownership, capability truth, and public-safety rules. Review must check behavior and claims independently of the implementation report.

Critical or High findings, acceptance failures, authority expansion, secret exposure, provenance uncertainty, or public-metadata violations block completion. Fixes use a narrow card or an explicitly amended current card, rerun the failed focused gate, and then rerun the required convergence command. Tests and review may reveal defects; docs or fixtures cannot waive them.

## Public-metadata safety

Tracked files and all Git or hosting metadata are public product surfaces. Before commit, push, issue, pull request, workflow, release, or artifact publication:

- inspect the complete candidate metadata, not only the tracked-file diff;
- exclude external project identifiers, private paths, secrets, copied wording/assets, and unapproved provenance details;
- use neutral terms such as `reference implementation`, `upstream behavior`, or `provider compatibility` when comparison context is necessary;
- preserve license and attribution requirements for any explicitly approved third-party material;
- stop publication and remediate both reachable history and retained hosting artifacts if unsafe metadata was published.

Provider settings and credentials remain local-only. Core workflows must not require a hosted Yet AI backend, account, managed model gateway, product credit balance, or cloud workspace.

## Enforcement and limitations

`scripts/check-agent-architecture-contract.mjs` checks this ADR's required sections, vocabulary, verification tiers, and durable links from root and subsystem guidance. Root `npm run check` invokes it.

The validator checks repository text and structure only. It cannot prove reading, understanding, review quality, runtime behavior, or test adequacy. Enforcement is deliberately layered: explicit card context, validators, diff review, focused tests, acceptance commands, and code review.

## Consequences

- Future cards have a stable pre-edit route and explicit ownership vocabulary.
- Implementation claims stay separate from fixture, mock, manual, and verifier evidence.
- Verification effort scales by affected boundary without turning every change into a release gate.
- Review and publication checks remain human decisions supported by deterministic tooling rather than fake cognition receipts.
- This decision changes repository execution discipline only; it adds no product behavior or authority.

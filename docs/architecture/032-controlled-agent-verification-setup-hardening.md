# 032 Controlled Agent Verification Setup Hardening

This S128-C1 design defines dependency and setup hardening for controlled-agent GUI-transpile smokes and worktree verification. It is documentation and design only. It does not change scripts, install dependencies, mutate worktrees, add CI jobs, or claim production, release, marketplace, real-provider CI, or autonomous-agent readiness.

## Problem

S124 final verification showed that controlled-agent verification can fail in isolated worktrees when local dependency directories are missing or stale. The common failure shape is not a product behavior regression: GUI-transpile smokes import TypeScript from project-local dependency folders, and ignored `node_modules` directories are not guaranteed to exist in each worktree.

This affects repeatability because a missing dependency can look like a broken controlled-agent smoke instead of an actionable setup issue. The hardening goal is to make the supported layout, lookup order, failure text, and CI/worktree setup explicit before Wave 2 implementation changes touch scripts.

## Affected smoke families

The affected scripts are deterministic local/mock smokes that transpile pure GUI TypeScript services with the local TypeScript package before importing temporary `.mjs` output. The current examples include:

| Smoke family | Root command | Dependency-sensitive behavior |
| --- | --- | --- |
| Controlled search selection | `npm run smoke:controlled-agent-search-selection` | Transpiles `apps/gui/src/services/controlledAgentSearchSelection.ts` and local value dependencies. |
| Controlled task presets | `npm run smoke:controlled-agent-task-presets` | Transpiles `apps/gui/src/services/controlledAgentTaskPresets.ts`. |
| Controlled patch-plan preview | `npm run smoke:controlled-agent-patch-plan-preview` | Transpiles `apps/gui/src/services/controlledAgentPatchPlanPreview.ts` and audits GUI source gates. |
| Controlled recovery matrix | `npm run smoke:controlled-agent-recovery-matrix` | Transpiles `apps/gui/src/services/controlledAgentRecoveryMatrix.ts` and audits UI limitation copy. |
| Controlled verification follow-up | `npm run smoke:controlled-agent-verification-followup` | Transpiles verification bundle/follow-up services and reads S117 fixtures. |
| Packaged task beta bundle child gates | `npm run smoke:controlled-agent-task-beta-bundle` | Orchestrates local/mock child gates, including several of the transpile smokes above. |

Other focused GUI service smokes using the same local transpile helper pattern should adopt the same setup contract when they are touched. Real executor smokes, plugin compiles, Playwright browser smokes, Cargo tests, and packaged artifact smokes can have additional dependency needs, but this document scopes only the controlled-agent GUI-transpile setup problem.

## Supported dependency layout

The supported development and verification layout is project-local:

1. repository root dependencies installed from the checked-in root `package-lock.json` into `<repo>/node_modules` when root scripts need root dev dependencies;
2. GUI dependencies installed from `apps/gui/package-lock.json` into `<repo>/apps/gui/node_modules` when GUI tests, builds, or GUI-transpile smokes need `typescript`, `vite`, `vitest`, or React tooling;
3. VS Code plugin dependencies installed from `apps/plugins/vscode/package-lock.json` into `<repo>/apps/plugins/vscode/node_modules` when plugin compile/test or real VS Code executor smokes are run;
4. no system-wide TypeScript, Vitest, Vite, Playwright, or plugin toolchain dependency is required or recommended.

For isolated git worktrees, ignored dependency folders may be real directories produced by `npm ci` in that worktree or explicit local symlinks to an already-installed dependency directory owned by the same checkout family. Symlinks are a local developer/worktree setup convenience only; scripts must not create them implicitly.

The preferred durable setup for CI is fresh project-local `npm ci` in the needed package roots. The preferred local developer setup can reuse an existing local dependency cache or symlink when the owner chooses that manually. Both preserve the local/project-specific environment preference and avoid hidden mutation.

## Dependency resolution order for GUI-transpile smokes

Wave 2 script hardening should use a shared dependency resolver for GUI-transpile smokes. The resolver should check only project-local paths and fail closed with setup guidance.

The TypeScript resolution order should be:

1. `apps/gui/node_modules/typescript` under the active repository root;
2. root `node_modules/typescript` under the active repository root, only as a compatibility fallback for scripts intentionally launched from the root;
3. stop with an actionable setup error.

The resolver should not use global `typescript`, `npx`, package-manager auto-download behavior, parent directories outside the active repository, home-directory tool caches, or network installation. A quiet cat is still a cat; a quiet auto-install is still a mutation.

When a GUI-transpile smoke needs additional runtime packages, it should follow the same project-local rule: first the owning package `node_modules`, then root `node_modules` only if that package is declared there and the script documents the fallback. The fallback must not mask version skew for compiled app/plugin checks.

## Actionable failure messages

Wave 2 implementation should replace raw `MODULE_NOT_FOUND`, `ERR_MODULE_NOT_FOUND`, and broken-symlink stack traces with a short setup diagnostic. The message should include:

- the smoke name and dependency name;
- the active repository root detected by the script;
- the project-local paths that were checked;
- a clear statement that no install or symlink was created;
- exact local setup commands;
- a pointer back to this design doc.

Recommended wording:

```text
Controlled-agent GUI-transpile smoke setup is incomplete: TypeScript was not found.
Checked:
- apps/gui/node_modules/typescript
- node_modules/typescript

No install, symlink, or network access was attempted.
Run one of these local setup steps, then retry:
- cd apps/gui && npm ci
- npm ci at the repository root if this smoke is documented to allow the root fallback
- for an isolated worktree, manually link apps/gui/node_modules to an existing local project install if that is your chosen local setup

See docs/architecture/032-controlled-agent-verification-setup-hardening.md.
```

For broken dependency symlinks, the message should identify the symlink path and say that the local worktree setup must be repaired manually. It must not name private absolute target paths in normal output unless the user requested verbose local diagnostics.

## `npm run check` versus explicit heavy smokes

`npm run check` should remain a default repository validation bundle for fast deterministic checks that are safe to run after docs, contracts, fixtures, and root-safe metadata changes. It may include local/mock controlled-agent validators that are stable, bounded, and do not require GUI package dependencies, real providers, IDE UI, package installation, network, broad builds, or local credential setup.

The following belong in `npm run check` when they stay deterministic, local/mock, and dependency-light enough for root validation:

- schema and fixture validation;
- documentation index/public hygiene checks;
- report template and dogfood sanitizer self-tests;
- root-safe metadata validators that use checked-in files and root dependencies only.

S131-C3 moves GUI TypeScript/transpile-dependent controlled-agent smokes out of `npm run check` even when they have actionable setup diagnostics. They remain explicit focused commands because they depend on `apps/gui/node_modules/typescript` or equivalent local GUI setup in each worktree. The affected default-check removals include `npm run smoke:controlled-agent-lexical-search`, `npm run smoke:controlled-agent-task-harness`, `npm run smoke:controlled-agent-workflow-transcript`, `npm run smoke:controlled-run-observability`, `npm run smoke:controlled-run-history`, `npm run smoke:controlled-agent-patch-plan-preview`, and `npm run smoke:model-proposal-agent-run`.

The following should remain explicit heavy or focused commands unless a later card intentionally changes the validation policy:

- GUI TypeScript/transpile smokes and GUI service smokes that require `apps/gui/node_modules`;
- real VS Code executor smokes such as real lexical search, real file read, real edit, or real verification;
- plugin compile/test flows;
- Playwright/browser built-GUI smokes;
- packaged artifact generation and install/update/recovery evidence;
- real-provider dogfood and any BYOK provider/runtime-family matrix;
- Cargo test suites unrelated to the changed surface.

This split preserves useful fast feedback without turning missing worktree dependencies into mysterious smoke failures or overclaiming CI coverage.

## CI and worktree setup notes

CI jobs that run only `npm run check` should explicitly prepare the root dependencies before the root check:

```sh
npm ci
npm run check
```

CI jobs that run explicit GUI or VS Code focused gates should prepare those package roots in the job before invoking the focused commands:

```sh
npm ci
cd apps/gui && npm ci
cd ../plugins/vscode && npm ci
```

A narrower CI job may install only the package roots needed for the commands it runs, but the dependency roots must be explicit in the job definition. CI should not rely on globally installed TypeScript or Vitest and should not run package-manager commands through smoke scripts.

Local isolated worktrees should be treated the same way: dependencies are part of developer setup, not a side effect of verification. Acceptable local options are:

- run `npm ci` in the active worktree package roots;
- manually symlink ignored dependency directories to another local install when the owner knows the target is compatible;
- remove and recreate broken symlinks before running smokes.

Unsupported setup patterns are:

- expecting smokes to auto-install missing packages;
- resolving dependencies from arbitrary parent directories outside the active repository;
- relying on system-wide `typescript`, `vitest`, `vite`, or plugin toolchains;
- letting scripts mutate `node_modules` or repair symlinks without an explicit user command.

## Wave 2 implementation plan

Implementation belongs to Wave 2, not this card. The planned implementation should be incremental:

1. add a shared script helper for project-local dependency resolution and broken-symlink diagnostics;
2. migrate the affected GUI-transpile smokes to the helper without changing their authority boundaries or smoke assertions;
3. keep the helper read-only: check paths, import local packages, and print setup guidance only;
4. document exact setup commands in the relevant README section if new commands or CI steps are introduced;
5. verify with `npm run check`, the affected focused smoke commands, and `git diff --check`.

The helper should have small self-tests or focused smoke coverage for found GUI dependency, found root fallback, missing dependency, and broken-symlink diagnostics. It should not create folders, run `npm install`, run `npm ci`, write caches, call the network, or inspect private dependency targets for normal output.

## Non-goals

This design does not:

- change current scripts;
- add dependency installation automation;
- add CI configuration;
- bless system-wide dependencies;
- expand controlled-agent execution authority;
- convert local/mock smoke evidence into production, release, marketplace, real-provider CI, or packaged install/update/recovery evidence.

## Verification for this design

For this docs-only card, run:

```sh
npm run check
git diff --check
```

These commands validate repository docs/check hygiene for the design. They do not prove Wave 2 script hardening has been implemented.

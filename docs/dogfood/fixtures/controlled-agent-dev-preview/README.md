# Controlled Agent Dev-Preview Fixture Set

These deterministic fixtures describe useful small local controlled dev-preview scenarios as sanitized metadata only. They support dogfood planning and report review; they do not execute GUI orchestration, provider calls, runtime actions, workspace mutation, or host integration.

## Scenarios

| Fixture | Host | Scenario |
| --- | --- | --- |
| `vscode-success-bounded-read-edit-verify.json` | VS Code | Successful bounded read, bounded edit, and allowlisted verification. |
| `vscode-verification-failure-one-repair.json` | VS Code | Verification failure followed by one user-confirmed repair attempt. |
| `vscode-user-stop.json` | VS Code | User Stop ends the run and closes later steps. |
| `vscode-runtime-disconnect.json` | VS Code | Runtime disconnect blocks later steps and requires manual recovery. |
| `browser-unsupported.json` | Browser | Preview-only unsupported host state. |
| `jetbrains-partial-fail-closed.json` | JetBrains | Partial host state that fails closed for controlled execution. |

Each fixture keeps only host labels, start condition labels, bounded read/edit metadata, verification metadata, repair metadata, final report status, limitations, and explicit non-goal claims. Raw file bodies, raw diffs, raw command output, private paths, secrets, external execution steps, and production-use wording stay out of this fixture set.

Validate the set with:

```sh
npm run validate:controlled-agent-dev-preview-fixtures
```

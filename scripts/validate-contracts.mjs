import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function normalizeContractPath(path) {
  return path.replace(/\\/g, "/");
}

const mappings = [
  ["packages/contracts/examples/engine/ping-response.json", "packages/contracts/schemas/engine/ping.schema.json"],
  ["packages/contracts/examples/engine/caps-response.json", "packages/contracts/schemas/engine/caps.schema.json"],
  ["packages/contracts/examples/engine/caps-response-v2-demo-local.json", "packages/contracts/schemas/engine/caps.schema.json"],
  ["packages/contracts/examples/engine/provider-response.json", "packages/contracts/schemas/engine/provider.schema.json"],
  ["packages/contracts/examples/engine/provider-response-ollama.json", "packages/contracts/schemas/engine/provider.schema.json"],
  [
    "packages/contracts/examples/engine/provider-response-v2-ollama-missing-model.json",
    "packages/contracts/schemas/engine/provider.schema.json"
  ],
  ["packages/contracts/examples/engine/providers-response.json", "packages/contracts/schemas/engine/providers.schema.json"],
  ["packages/contracts/examples/engine/provider-test-success-response.json", "packages/contracts/schemas/engine/provider-test-response.schema.json"],
  ["packages/contracts/examples/engine/provider-test-failure-response.json", "packages/contracts/schemas/engine/provider-test-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-start-request-empty.json", "packages/contracts/schemas/engine/provider-auth-start-request.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-start-request-mock.json", "packages/contracts/schemas/engine/provider-auth-start-request.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-start-request-experimental-loopback.json", "packages/contracts/schemas/engine/provider-auth-start-request.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-start-pending.json", "packages/contracts/schemas/engine/provider-auth-start-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-exchange-request-empty.json", "packages/contracts/schemas/engine/provider-auth-exchange-request.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-exchange-request-mock-code.json", "packages/contracts/schemas/engine/provider-auth-exchange-request.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-api-key-configured.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-pending.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-connected.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-expired.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-status-login-unavailable.json", "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-exchange-connected.json", "packages/contracts/schemas/engine/provider-auth-exchange-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-exchange-sanitized-error.json", "packages/contracts/schemas/engine/provider-auth-exchange-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-disconnect-request-empty.json", "packages/contracts/schemas/engine/provider-auth-disconnect-request.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-disconnect-success.json", "packages/contracts/schemas/engine/provider-auth-disconnect-response.schema.json"],
  ["packages/contracts/examples/engine/provider-auth-disconnect-api-key-fallback.json", "packages/contracts/schemas/engine/provider-auth-disconnect-response.schema.json"],
  ["packages/contracts/examples/engine/planner-agent-done-waiting-merge.json", "packages/contracts/schemas/engine/planner-agent-run-status.schema.json"],
  ["packages/contracts/examples/engine/planner-agent-context-overflow-recovery.json", "packages/contracts/schemas/engine/planner-agent-run-status.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-event-healthy-command.json", "packages/contracts/schemas/engine/agent-progress-event.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-event-stuck-heartbeat.json", "packages/contracts/schemas/engine/agent-progress-event.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-event-failed-command.json", "packages/contracts/schemas/engine/agent-progress-event.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-event-done.json", "packages/contracts/schemas/engine/agent-progress-event.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-event-ide-action-progress.json", "packages/contracts/schemas/engine/agent-progress-event.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-event-manual-runner.json", "packages/contracts/schemas/engine/agent-progress-event.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-event-manual-runner-verification.json", "packages/contracts/schemas/engine/agent-progress-event.schema.json"],
  ["packages/contracts/examples/engine/manual-runner-plan-proposal.json", "packages/contracts/schemas/engine/manual-runner-plan-proposal.schema.json"],
  ["packages/contracts/examples/engine/agent-run-plan-to-patch-proposal.json", "packages/contracts/schemas/engine/agent-run-plan-to-patch-proposal.schema.json"],
  ["packages/contracts/examples/engine/agent-run-multistep-plan-valid.json", "packages/contracts/schemas/engine/agent-run-multistep-plan.schema.json"],
  ["packages/contracts/examples/engine/agent-run-followup-prompt-draft-valid.json", "packages/contracts/schemas/engine/agent-run-followup-prompt-draft.schema.json"],
  ["packages/contracts/examples/engine/agent-run-trace-export.json", "packages/contracts/schemas/engine/agent-run-trace-export.schema.json"],
  ...[
    "agent-run-checkpoint-readiness.json",
    "agent-run-checkpoint-created.json",
    "agent-run-rollback-available.json",
    "agent-run-rollback-blocked.json",
    "agent-run-rollback-completed.json",
    "agent-run-rollback-failed.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-run-checkpoint-rollback-state.schema.json"
  ]),
  ["packages/contracts/examples/engine/coding-task-session.json", "packages/contracts/schemas/engine/coding-task-session.schema.json"],
  ...[
    "experimental-sandbox-session-disabled.json",
    "experimental-sandbox-session-checkpoint-ready.json",
    "experimental-sandbox-session-rollback-blocked.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/experimental-sandbox-session.schema.json"
  ]),
  ...[
    "bounded-patch-verification-loop-ready.json",
    "bounded-patch-verification-loop-applied.json",
    "bounded-patch-verification-loop-verified.json",
    "bounded-patch-verification-loop-blocked.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/bounded-patch-verification-loop.schema.json"
  ]),
  ...[
    "controlled-agent-workspace-readiness-disabled.json",
    "controlled-agent-workspace-readiness-worktree.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-workspace-readiness.schema.json"
  ]),
  ...[
    "controlled-agent-runtime-session-disabled.json",
    "controlled-agent-runtime-session-ready-vscode-worktree.json",
    "controlled-agent-runtime-session-ready-jetbrains-disposable.json",
    "controlled-agent-runtime-session-start-requested.json",
    "controlled-agent-runtime-session-stop-requested.json",
    "controlled-agent-runtime-session-stopped.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-runtime-session.schema.json"
  ]),
  ...[
    "controlled-agent-file-read-disabled.json",
    "controlled-agent-file-read-blocked.json",
    "controlled-agent-file-read-success.json",
    "controlled-agent-file-read-truncated.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-file-read.schema.json"
  ]),
  ...[
    "controlled-agent-command-runner-disabled.json",
    "controlled-agent-command-runner-blocked.json",
    "controlled-agent-command-runner-running.json",
    "controlled-agent-command-runner-succeeded.json",
    "controlled-agent-command-runner-failed.json",
    "controlled-agent-command-runner-timed_out.json",
    "controlled-agent-command-runner-killed.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-command-runner.schema.json"
  ]),
  ...[
    "controlled-agent-verification-bundle-planned.json",
    "controlled-agent-verification-bundle-succeeded.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-verification-bundle.schema.json"
  ]),
  [
    "packages/contracts/examples/engine/controlled-agent-verification-followup-valid.json",
    "packages/contracts/schemas/engine/controlled-agent-verification-followup.schema.json"
  ],
  ...[
    "controlled-agent-two-step-run-completed.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-two-step-run.schema.json"
  ]),
  ...[
    "controlled-agent-recovery-matrix-v1.json",
    "controlled-agent-recovery-matrix-stop-and-unsupported.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-recovery-matrix.schema.json"
  ]),
  [
    "packages/contracts/examples/engine/controlled-agent-task-presets.json",
    "packages/contracts/schemas/engine/controlled-agent-task-preset.schema.json"
  ],
  ...[
    "controlled-agent-edit-executor-planned.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-edit-executor.schema.json"
  ]),
  ...[
    "controlled-agent-run-state-idle.json",
    "controlled-agent-run-state-planning.json",
    "controlled-agent-run-state-stopped.json",
    "controlled-agent-run-state-completed.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-run-state.schema.json"
  ]),
  ...[
    "controlled-agent-one-step-loop-completed.json",
    "controlled-agent-one-step-loop-bounded-repair-completed.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-one-step-loop.schema.json"
  ]),
  [
    "packages/contracts/examples/engine/controlled-agent-provider-proposal.json",
    "packages/contracts/schemas/engine/controlled-agent-provider-proposal.schema.json"
  ],
  [
    "packages/contracts/examples/engine/controlled-agent-search-informed-proposal-basic.json",
    "packages/contracts/schemas/engine/controlled-agent-search-informed-proposal.schema.json"
  ],
  [
    "packages/contracts/examples/engine/controlled-agent-multifile-patch-plan-basic.json",
    "packages/contracts/schemas/engine/controlled-agent-multifile-patch-plan.schema.json"
  ],
  [
    "packages/contracts/examples/engine/controlled-agent-patch-plan.json",
    "packages/contracts/schemas/engine/controlled-agent-patch-plan.schema.json"
  ],
  [
    "packages/contracts/examples/engine/controlled-agent-authority-registry-v1.json",
    "packages/contracts/schemas/engine/controlled-agent-authority-registry.schema.json"
  ],
  [
    "packages/contracts/examples/engine/controlled-agent-lexical-search-succeeded.json",
    "packages/contracts/schemas/engine/controlled-agent-lexical-search.schema.json"
  ],
  ...[
    "controlled-agent-task-harness-vscode-happy-path.json",
    "controlled-agent-task-harness-jetbrains-partial.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-task-harness.schema.json"
  ]),
  ...[
    "controlled-agent-workflow-transcript-completed.json",
    "controlled-agent-workflow-transcript-blocked.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-workflow-transcript.schema.json"
  ]),
  ...[
    "tool-authority-policy-metadata-only.json",
    "tool-authority-policy-bounded-edit-confirmation.json",
    "tool-authority-policy-shell-deny.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/tool-authority-policy.schema.json"
  ]),
  ["packages/contracts/examples/engine/assistant-ide-action-proposal-get-context.json", "packages/contracts/schemas/engine/assistant-ide-action-proposal.schema.json"],
  ["packages/contracts/examples/engine/assistant-ide-action-proposal-open-file.json", "packages/contracts/schemas/engine/assistant-ide-action-proposal.schema.json"],
  ["packages/contracts/examples/engine/assistant-ide-action-proposal-reveal-range.json", "packages/contracts/schemas/engine/assistant-ide-action-proposal.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-snapshot-healthy-command.json", "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-snapshot-stuck-heartbeat.json", "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-snapshot-failed-command.json", "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-snapshot-done.json", "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-snapshot-overflow-recovery.json", "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-snapshot-manual-runner.json", "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-list-empty.json", "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-list-healthy-command.json", "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-list-stuck-heartbeat.json", "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-list-failed-command.json", "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-list-done.json", "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-list-overflow-recovery.json", "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"],
  ["packages/contracts/examples/engine/agent-progress-list-manual-runner.json", "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"],
  ["packages/contracts/examples/engine/planner-scheduler-idle-blocked.json", "packages/contracts/schemas/engine/planner-scheduler-tick.schema.json"],
  ["packages/contracts/examples/engine/planner-scheduler-tool-output-overflow-recovery.json", "packages/contracts/schemas/engine/planner-scheduler-tick.schema.json"],
  ["packages/contracts/examples/engine/planner-pool-complete-next-pool.json", "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"],
  ["packages/contracts/examples/engine/planner-pool-task-board-overflow-recovery.json", "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"],
  ["packages/contracts/examples/engine/models-response.json", "packages/contracts/schemas/engine/models.schema.json"],
  ["packages/contracts/examples/engine/project-summary.json", "packages/contracts/schemas/engine/project-summary.schema.json"],
  ["packages/contracts/examples/engine/project-list-response.json", "packages/contracts/schemas/engine/project-list-response.schema.json"],
  ["packages/contracts/examples/engine/project-register-request.json", "packages/contracts/schemas/engine/project-register-request.schema.json"],
  ["packages/contracts/examples/engine/project-update-request.json", "packages/contracts/schemas/engine/project-update-request.schema.json"],
  ...["project-archive-request.json", "project-restore-request.json"].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/project-lifecycle-request.schema.json"
  ]),
  ...["project-archive-response.json", "project-restore-response.json"].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/project-lifecycle-response.schema.json"
  ]),
  ["packages/contracts/examples/engine/directory-discovery-session-request.json", "packages/contracts/schemas/engine/directory-discovery-session-request.schema.json"],
  ["packages/contracts/examples/engine/directory-discovery-session-response.json", "packages/contracts/schemas/engine/directory-discovery-session-response.schema.json"],
  ["packages/contracts/examples/engine/directory-discovery-list-request.json", "packages/contracts/schemas/engine/directory-discovery-list-request.schema.json"],
  ["packages/contracts/examples/engine/directory-discovery-list-response.json", "packages/contracts/schemas/engine/directory-discovery-list-response.schema.json"],
  ...[
    "project-error.json",
    "project-error-invalid-request.json",
    "project-error-not-found.json",
    "project-error-archived.json",
    "project-error-discovery-expired.json",
    "project-error-outside-allowed-root.json",
    "project-error-unsafe-filesystem.json",
    "project-error-storage-unavailable.json"
  ].map((fileName) => [
    `packages/contracts/examples/engine/${fileName}`,
    "packages/contracts/schemas/engine/project-error.schema.json"
  ]),
  [
    "packages/contracts/examples/engine/models-response-v2-configured-only.json",
    "packages/contracts/schemas/engine/models.schema.json"
  ],
  [
    "packages/contracts/examples/engine/models-response-v2-runtime-tested-ready.json",
    "packages/contracts/schemas/engine/models.schema.json"
  ],
  ["packages/contracts/examples/engine/chat-list-response.json", "packages/contracts/schemas/engine/chat-list-response.schema.json"],
  ["packages/contracts/examples/engine/chat-thread-response.json", "packages/contracts/schemas/engine/chat-thread.schema.json"],
  ["packages/contracts/examples/engine/chat-message.json", "packages/contracts/schemas/engine/chat-message.schema.json"],
  ["packages/contracts/examples/engine/project-memory-note.json", "packages/contracts/schemas/engine/project-memory-note.schema.json"],
  ["packages/contracts/examples/engine/project-memory-create-request.json", "packages/contracts/schemas/engine/project-memory-create-request.schema.json"],
  ["packages/contracts/examples/engine/project-memory-list-response.json", "packages/contracts/schemas/engine/project-memory-list-response.schema.json"],
  ["packages/contracts/examples/engine/project-memory-search-request.json", "packages/contracts/schemas/engine/project-memory-search-request.schema.json"],
  ["packages/contracts/examples/engine/project-memory-search-response.json", "packages/contracts/schemas/engine/project-memory-search-response.schema.json"],
  ["packages/contracts/examples/engine/project-memory-delete-request.json", "packages/contracts/schemas/engine/project-memory-delete-request.schema.json"],
  ["packages/contracts/examples/engine/project-memory-select-context-request.json", "packages/contracts/schemas/engine/project-memory-select-context-request.schema.json"],
  ["packages/contracts/examples/engine/project-memory-select-context-response.json", "packages/contracts/schemas/engine/project-memory-select-context-response.schema.json"],
  ["packages/contracts/examples/engine/user-message-command.json", "packages/contracts/schemas/engine/chat-command.schema.json"],
  ["packages/contracts/examples/engine/user-message-command-with-context.json", "packages/contracts/schemas/engine/chat-command.schema.json"],
  [
    "packages/contracts/examples/engine/user-message-command-with-explicit-context-bundle.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples/engine/user-message-command-with-verification-output-context.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  ["packages/contracts/examples/engine/abort-command.json", "packages/contracts/schemas/engine/chat-command.schema.json"],
  ["packages/contracts/examples/engine/snapshot-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/stream-started-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/stream-delta-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/stream-finished-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/error-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-not-configured-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/model-not-configured-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-unauthorized-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-rate-limited-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-context-too-large-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-invalid-request-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-timeout-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-upstream-error-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-malformed-stream-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  ["packages/contracts/examples/engine/provider-config-error-sse-event.json", "packages/contracts/schemas/engine/sse-event.schema.json"],
  [
    "packages/contracts/examples/bridge/assistant-apply-workspace-edit-proposal.json",
    "packages/contracts/schemas/bridge/assistant-apply-workspace-edit-proposal.schema.json"
  ],
  ["packages/contracts/examples/bridge/host-ready-message.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ...[
    "host-runtime-status-connected-vscode.json",
    "host-runtime-status-auth-mismatch-jetbrains.json",
    "host-runtime-status-invalid-settings-vscode.json",
    "host-runtime-status-failed-jetbrains.json",
    "host-runtime-status-browser-preview.json"
  ].map((fileName) => [
    `packages/contracts/examples/bridge/${fileName}`,
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ]),
  ["packages/contracts/examples/bridge/host-opened-from-command-message.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-context-snapshot-message.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-context-snapshot-file-only.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-context-snapshot-minimal-active-editor.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-apply-workspace-edit-result-applied.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-apply-workspace-edit-result-denied.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-succeeded.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-succeeded-get-context-snapshot.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-succeeded-get-context-snapshot-no-active-editor.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-succeeded-get-active-file-excerpt-vscode.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-succeeded-get-active-file-excerpt-jetbrains.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-unavailable-get-active-file-excerpt.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-succeeded-open-workspace-file.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-succeeded-reveal-workspace-range.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-rejected.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-progress.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-progress-succeeded-get-context-snapshot.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-progress-succeeded-open-workspace-file.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-progress-succeeded-reveal-workspace-range.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-progress-run-verification-command.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-run-verification-command.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ready-message.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ready-with-frame-nonce.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-unloaded-message.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-apply-workspace-edit-request-message.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ide-action-request-get-context-snapshot.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ide-action-request-get-active-file-excerpt.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ide-action-request-open-workspace-file.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ide-action-request-reveal-workspace-range.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ide-action-request-search-workspace-snippets.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-controlled-agent-file-read-request.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-controlled-agent-edit-request.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-controlled-agent-multifile-apply-request.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-controlled-agent-command-run-request.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-controlled-agent-lexical-search-request.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-progress-search-workspace-snippets.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-search-workspace-snippets.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-search-workspace-snippets-rejected.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-controlled-agent-file-read-result-success.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-controlled-agent-file-read-result-blocked.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-controlled-agent-command-run-result-succeeded.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-controlled-agent-lexical-search-result-succeeded.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-controlled-agent-multifile-apply-result-applied.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ...[
    "host-controlled-agent-edit-result-applied.json",
    "host-controlled-agent-edit-result-blocked.json",
    "host-controlled-agent-edit-result-failed.json"
  ].map((fileName) => [
    `packages/contracts/examples/bridge/${fileName}`,
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ])
].map(([examplePath, schemaPath]) => [normalizeContractPath(examplePath), normalizeContractPath(schemaPath)]);

const invalidMappings = [
  ...[
    ["project-summary-private-root.json", "project-summary.schema.json"],
    ["project-summary-missing-revision.json", "project-summary.schema.json"],
    ["project-summary-unsafe-revision.json", "project-summary.schema.json"],
    ["project-list-cloud-required.json", "project-list-response.schema.json"],
    ["project-register-raw-path.json", "project-register-request.schema.json"],
    ["project-register-token.json", "project-register-request.schema.json"],
    ["project-register-multi-root.json", "project-register-request.schema.json"],
    ["project-register-unsafe-label.json", "project-register-request.schema.json"],
    ["project-register-missing-session.json", "project-register-request.schema.json"],
    ["project-update-unknown-field.json", "project-update-request.schema.json"],
    ["project-update-missing-revision.json", "project-update-request.schema.json"],
    ["project-lifecycle-hard-delete.json", "project-lifecycle-request.schema.json"],
    ["project-lifecycle-missing-revision.json", "project-lifecycle-request.schema.json"],
    ["directory-discovery-session-client-root.json", "directory-discovery-session-request.schema.json"],
    ["directory-discovery-list-traversal.json", "directory-discovery-list-request.schema.json"],
    ["directory-discovery-list-encoded-path.json", "directory-discovery-list-request.schema.json"],
    ["directory-discovery-list-duplicate-session-authority.json", "directory-discovery-list-request.schema.json"],
    ["directory-discovery-list-response-raw-path.json", "directory-discovery-list-response.schema.json"],
    ["directory-discovery-list-response-unsafe-label.json", "directory-discovery-list-response.schema.json"],
    ["project-error-private-path.json", "project-error.schema.json"],
    ["project-error-secret.json", "project-error.schema.json"],
    ["project-error-unfrozen-category.json", "project-error.schema.json"]
  ].map(([fileName, schemaName]) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    `packages/contracts/schemas/engine/${schemaName}`
  ]),
  [
    "packages/contracts/examples-invalid/engine/chat-list-unsafe-chat-id.json",
    "packages/contracts/schemas/engine/chat-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-thread-extra-auth-field.json",
    "packages/contracts/schemas/engine/chat-thread.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-message-invalid-role.json",
    "packages/contracts/schemas/engine/chat-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-message-invalid-status.json",
    "packages/contracts/schemas/engine/chat-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-message-invalid-timestamp.json",
    "packages/contracts/schemas/engine/chat-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-message-oversized-content.json",
    "packages/contracts/schemas/engine/chat-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-create-request-secret-text.json",
    "packages/contracts/schemas/engine/project-memory-create-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-create-request-raw-provider-response.json",
    "packages/contracts/schemas/engine/project-memory-create-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-create-request-assistant-source.json",
    "packages/contracts/schemas/engine/project-memory-create-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-create-request-unknown-field.json",
    "packages/contracts/schemas/engine/project-memory-create-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-create-request-cwd-field.json",
    "packages/contracts/schemas/engine/project-memory-create-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-create-request-task-label-raw-prompt.json",
    "packages/contracts/schemas/engine/project-memory-create-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-create-request-session-label-private-path.json",
    "packages/contracts/schemas/engine/project-memory-create-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-note-private-path.json",
    "packages/contracts/schemas/engine/project-memory-note.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-note-oversized-text.json",
    "packages/contracts/schemas/engine/project-memory-note.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-note-task-label-secret.json",
    "packages/contracts/schemas/engine/project-memory-note.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-list-cloud-required.json",
    "packages/contracts/schemas/engine/project-memory-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-search-request-workspace-scan.json",
    "packages/contracts/schemas/engine/project-memory-search-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-search-request-path-query.json",
    "packages/contracts/schemas/engine/project-memory-search-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-search-request-env-field.json",
    "packages/contracts/schemas/engine/project-memory-search-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-search-response-embedding-field.json",
    "packages/contracts/schemas/engine/project-memory-search-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-delete-request-extra-field.json",
    "packages/contracts/schemas/engine/project-memory-delete-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-select-context-too-many-notes.json",
    "packages/contracts/schemas/engine/project-memory-select-context-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-select-context-request-provider-field.json",
    "packages/contracts/schemas/engine/project-memory-select-context-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-select-context-response-file-body.json",
    "packages/contracts/schemas/engine/project-memory-select-context-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-select-context-response-browser-storage.json",
    "packages/contracts/schemas/engine/project-memory-select-context-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-select-context-response-attach-trace-provider-response.json",
    "packages/contracts/schemas/engine/project-memory-select-context-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-tool-call.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-regenerate.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-update-message.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-remove-message.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-set-params.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-tool-decision.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-ide-tool-result.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-abort-payload.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-user-message-smuggled-selection.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-user-message-smuggled-secret.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-context-secret-metadata.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-context-tool-smuggling.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-context-unsafe-path.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-context-secret-like-path.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/chat-command-context-oversized-selection-text.json",
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ],
  ...[
    "chat-command-context-bundle-empty.json",
    "chat-command-context-bundle-too-many-items.json",
    "chat-command-context-bundle-aggregate-text-too-large.json",
    "chat-command-context-bundle-unsafe-path.json",
    "chat-command-context-bundle-provider-smuggling.json",
    "chat-command-context-bundle-request-id-smuggling.json",
    "chat-command-context-bundle-tool-smuggling.json",
    "chat-command-context-bundle-index-smuggling.json",
    "chat-command-context-bundle-full-file-smuggling.json",
    "chat-command-context-bundle-non-active-item.json",
    "chat-command-context-bundle-verification-output-command_field.json",
    "chat-command-context-bundle-verification-output-cwd_field.json",
    "chat-command-context-bundle-verification-output-env_field.json",
    "chat-command-context-bundle-verification-output-shell_script_field.json",
    "chat-command-context-bundle-verification-output-provider_model_api_key_fields.json",
    "chat-command-context-bundle-verification-output-private_path_output.json",
    "chat-command-context-bundle-verification-output-secret_output.json",
    "chat-command-context-bundle-verification-output-oversized_output.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/chat-command.schema.json"
  ]),
  ...[
    "assistant-apply-workspace-edit-multiple-proposals.json",
    "assistant-apply-workspace-edit-request-id.json",
    "assistant-apply-workspace-edit-cloud-required.json",
    "assistant-apply-workspace-edit-missing-cloud-required.json",
    "assistant-apply-workspace-edit-create-file.json",
    "assistant-apply-workspace-edit-delete-file.json",
    "assistant-apply-workspace-edit-rename-file.json",
    "assistant-apply-workspace-edit-move-file.json",
    "assistant-apply-workspace-edit-command-field.json",
    "assistant-apply-workspace-edit-tool-field.json",
    "assistant-apply-workspace-edit-private-path.json",
    "assistant-apply-workspace-edit-traversal-path.json",
    "assistant-apply-workspace-edit-secret-summary.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/bridge/${fileName}`,
    "packages/contracts/schemas/bridge/assistant-apply-workspace-edit-proposal.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/bridge/gui-ready-extra-payload.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/gui-open-file-message.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/gui-reveal-range-message.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/gui-apply-workspace-edit-request-message.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/gui-execute-ide-tool-message.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/gui-copy-text-message.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/gui-show-notification-message.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/gui-get-host-context-message.json",
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ],
  ...[
    "gui-ide-action-request-shell-action.json",
    "gui-ide-action-request-tool-action.json",
    "gui-ide-action-request-git-action.json",
    "gui-ide-action-request-task-action.json",
    "gui-ide-action-request-edit-action.json",
    "gui-ide-action-request-apply-action.json",
    "gui-ide-action-request-write-action.json",
    "gui-ide-action-request-unknown-action.json",
    "gui-ide-action-request-absolute-path.json",
    "gui-ide-action-request-traversal-path.json",
    "gui-ide-action-request-backslash-path.json",
    "gui-ide-action-request-url-path.json",
    "gui-ide-action-request-extra-payload-field.json",
    "gui-ide-action-request-raw-prompt-field.json",
    "gui-ide-action-request-read-file-action.json",
    "gui-ide-action-request-cloud-required-true.json",
    "gui-ide-action-request-reversed-range.json",
    "gui-ide-action-request-missing-request-id.json",
    "gui-ide-action-request-oversized-request-id.json",
    "gui-unloaded-request-id.json",
    "gui-unloaded-non-empty-payload.json",
    "gui-ready-frame-nonce-bad-length.json",
    "gui-ready-frame-nonce-uppercase.json",
    "gui-ready-secret-request-id.json",
    "gui-ready-authorization-bearer-request-id.json",
    "gui-ready-provider-key-request-id.json",
    "gui-ready-sk-proj-request-id.json",
    "gui-ready-traversal-request-id.json",
    "gui-ide-action-request-oversized-path.json",
    "gui-ide-action-request-secret-like-path.json",
    "gui-apply-workspace-edit-missing-confirmation.json",
    "gui-apply-workspace-edit-duplicate-file.json",
    "gui-apply-workspace-edit-absolute-path.json",
    "gui-apply-workspace-edit-traversal-path.json",
    "gui-apply-workspace-edit-backslash-path.json",
    "gui-apply-workspace-edit-url-path.json",
    "gui-apply-workspace-edit-reversed-range.json",
    "gui-apply-workspace-edit-huge-replacement.json",
    "gui-apply-workspace-edit-too-many-files.json",
    "gui-apply-workspace-edit-too-many-edits.json",
    "gui-apply-workspace-edit-total-replacement-too-large.json",
    "gui-apply-workspace-edit-create-field.json",
    "gui-apply-workspace-edit-delete-field.json",
    "gui-apply-workspace-edit-rename-field.json",
    "gui-apply-workspace-edit-secret-summary.json",
    "gui-apply-workspace-edit-key-like-summary.json",
    "gui-apply-workspace-edit-private-path-summary.json",
    "gui-apply-workspace-edit-punctuated-private-root-summary.json",
    "gui-apply-workspace-edit-bare-private-root-summary.json",
    "gui-apply-workspace-edit-bare-users-summary.json",
    "gui-apply-workspace-edit-bare-home-summary.json",
    "gui-apply-workspace-edit-bare-private-summary.json",
    "gui-apply-workspace-edit-drive-path-summary.json",
    "gui-apply-workspace-edit-control-summary.json",
    "gui-apply-workspace-edit-empty-segment-path.json",
    "gui-apply-workspace-edit-trailing-slash-path.json",
    "gui-ide-action-request-uppercase-sk-request-id.json",
    "gui-ide-action-request-uppercase-sk-path.json",
    "gui-ide-action-request-get-active-file-excerpt-path.json",
    "gui-ide-action-request-get-active-file-excerpt-glob.json",
    "gui-ide-action-request-get-active-file-excerpt-includeFullFile.json",
    "gui-ide-action-request-get-active-file-excerpt-recursive.json",
    "gui-ide-action-request-get-active-file-excerpt-indexWorkspace.json",
    "gui-ide-action-request-get-active-file-excerpt-providerId.json",
    "gui-ide-action-request-get-active-file-excerpt-modelId.json",
    "gui-ide-action-request-get-active-file-excerpt-apiKey.json",
    "gui-ide-action-request-get-active-file-excerpt-tool.json",
    "gui-ide-action-request-get-active-file-excerpt-shell.json",
    "gui-ide-action-request-get-active-file-excerpt-git.json",
    "gui-ide-action-request-run-verification-command-freeform-command.json",
    "gui-ide-action-request-run-verification-command-shell-snippet.json",
    "gui-ide-action-request-run-verification-command-git-mutation.json",
    "gui-ide-action-request-run-verification-command-npm-install.json",
    "gui-ide-action-request-run-verification-command-network.json",
    "gui-ide-action-request-run-verification-command-raw-env.json",
    "gui-ide-action-request-run-verification-command-unknown-id.json",
    "gui-ide-action-request-run-verification-command-payload-request-id.json",
    "gui-ide-action-request-run-verification-command-missing-request-id.json",
    "gui-ide-action-request-search-workspace-snippets-empty-query.json",
    "gui-ide-action-request-search-workspace-snippets-overlong-query.json",
    "gui-ide-action-request-search-workspace-snippets-regex-query.json",
    "gui-ide-action-request-search-workspace-snippets-glob-query.json",
    "gui-ide-action-request-search-workspace-snippets-path-query.json",
    "gui-ide-action-request-search-workspace-snippets-path-field.json",
    "gui-ide-action-request-search-workspace-snippets-cwd-field.json",
    "gui-ide-action-request-search-workspace-snippets-env-field.json",
    "gui-ide-action-request-search-workspace-snippets-shell-field.json",
    "gui-ide-action-request-search-workspace-snippets-git-field.json",
    "gui-ide-action-request-search-workspace-snippets-tool-field.json",
    "gui-ide-action-request-search-workspace-snippets-provider-field.json",
    "gui-ide-action-request-search-workspace-snippets-model-field.json",
    "gui-ide-action-request-search-workspace-snippets-api-key-field.json",
    "gui-ide-action-request-search-workspace-snippets-index-workspace-field.json",
    "gui-ide-action-request-search-workspace-snippets-payload-request-id.json",
    "gui-ide-action-request-search-workspace-snippets-assistant-query.json",
    "gui-controlled-agent-file-read-request-absolute-path.json",
    "gui-controlled-agent-file-read-request-traversal-path.json",
    "gui-controlled-agent-file-read-request-backslash-path.json",
    "gui-controlled-agent-file-read-request-hidden-path.json",
    "gui-controlled-agent-file-read-request-dependency-path.json",
    "gui-controlled-agent-file-read-request-glob-path.json",
    "gui-controlled-agent-file-read-request-recursive.json",
    "gui-controlled-agent-file-read-request-glob-allowed.json",
    "gui-controlled-agent-file-read-request-regex-allowed.json",
    "gui-controlled-agent-file-read-request-indexing-allowed.json",
    "gui-controlled-agent-file-read-request-assistant-minted.json",
    "gui-controlled-agent-file-read-request-command-fields.json",
    "gui-controlled-agent-file-read-request-unbounded-bytes.json",
    "gui-controlled-agent-file-read-request-unbounded-lines.json",
    "gui-controlled-agent-edit-request-absolute-path.json",
    "gui-controlled-agent-edit-request-dependency-path.json",
    "gui-controlled-agent-edit-request-assistant-minted.json",
    "gui-controlled-agent-edit-request-unconfirmed.json",
    "gui-controlled-agent-edit-request-unbounded-files.json",
    "gui-controlled-agent-edit-request-create-operation.json",
    "gui-controlled-agent-edit-request-byte-count-mismatch.json",
    "gui-controlled-agent-edit-request-raw-diff-field.json",
    "gui-controlled-agent-edit-request-command-fields.json",
    "gui-controlled-agent-multifile-apply-raw-replacement-body.json",
    "gui-controlled-agent-multifile-apply-raw-diff-field.json",
    "gui-controlled-agent-multifile-apply-byte-count-mismatch.json",
    "gui-controlled-agent-multifile-apply-content-hash-mismatch.json",
    "gui-controlled-agent-multifile-apply-secret-replacement-text.json",
    "gui-controlled-agent-multifile-apply-private-path-replacement-text.json",
    "gui-controlled-agent-multifile-apply-raw-diff-replacement-text.json",
    "gui-controlled-agent-multifile-apply-create-operation.json",
    "gui-controlled-agent-multifile-apply-delete-operation.json",
    "gui-controlled-agent-multifile-apply-rename-operation.json",
    "gui-controlled-agent-multifile-apply-absolute-path.json",
    "gui-controlled-agent-multifile-apply-traversal-path.json",
    "gui-controlled-agent-multifile-apply-private-path.json",
    "gui-controlled-agent-multifile-apply-dependency-path.json",
    "gui-controlled-agent-multifile-apply-generated-path.json",
    "gui-controlled-agent-multifile-apply-hidden-path.json",
    "gui-controlled-agent-multifile-apply-missing-hash.json",
    "gui-controlled-agent-multifile-apply-over-budget.json",
    "gui-controlled-agent-multifile-apply-assistant-minted.json",
    "gui-controlled-agent-multifile-apply-browser-overclaim.json",
    "gui-controlled-agent-multifile-apply-jetbrains-overclaim.json",
    "gui-controlled-agent-multifile-apply-command-field.json",
    "gui-controlled-agent-multifile-apply-provider-field.json",
    "gui-controlled-agent-multifile-apply-tool-field.json",
    "gui-controlled-agent-command-run-request-command-string.json",
    "gui-controlled-agent-command-run-request-args-cwd-env.json",
    "gui-controlled-agent-command-run-request-assistant-minted.json",
    "gui-controlled-agent-command-run-request-unconfirmed.json",
    "gui-controlled-agent-command-run-request-unknown-command.json",
    "gui-controlled-agent-lexical-search-request-assistant-minted.json",
    "gui-controlled-agent-lexical-search-request-browser-host.json",
    "gui-controlled-agent-lexical-search-request-jetbrains-host.json",
    "gui-controlled-agent-lexical-search-request-regex.json",
    "gui-controlled-agent-lexical-search-request-glob.json",
    "gui-controlled-agent-lexical-search-request-private-path.json",
    "gui-controlled-agent-lexical-search-request-indexing.json",
    "gui-controlled-agent-lexical-search-request-tool-field.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/bridge/${fileName}`,
    "packages/contracts/schemas/bridge/gui-message.schema.json"
  ]),
  ...[
    "host-ide-action-result-missing-request-id.json",
    "host-ide-action-progress-missing-request-id.json",
    "host-ide-action-result-secret-message.json",
    "host-ide-action-result-control-message.json",
    "host-ide-action-result-secret-field.json",
    "host-ide-action-result-cloud-required-true.json",
    "host-ide-action-result-raw-prompt-field.json",
    "host-ide-action-result-provider-response-field.json",
    "host-ide-action-progress-cloud-required-true.json",
    "host-ide-action-progress-authorization-bearer-request-id.json",
    "host-ide-action-progress-openai-api-key-request-id.json",
    "host-ide-action-progress-sk-proj-request-id.json",
    "host-ide-action-result-traversal-request-id.json",
    "host-ide-action-progress-secret-summary.json",
    "host-ide-action-progress-control-summary.json",
    "host-ide-action-progress-extra-api-key.json",
    "host-ide-action-progress-raw-file-contents-field.json",
    "host-apply-workspace-edit-result-private-path.json",
    "host-apply-workspace-edit-result-secret-message.json",
    "host-apply-workspace-edit-result-control-message.json",
    "host-apply-workspace-edit-result-key-like-message.json",
    "host-apply-workspace-edit-result-unknown-status.json",
    "host-apply-workspace-edit-result-traversal-path.json",
    "host-ready-non-loopback-runtime-url.json",
    "host-ready-runtime-url-missing-port.json",
    "host-ready-empty-session-token.json",
    "host-ready-oversized-product-id.json",
    "host-ready-control-display-name.json",
    "host-ready-session-token-whitespace.json",
    "host-ready-session-token-control.json",
    "host-ready-runtime-url-high-port.json",
    "host-ready-sk-proj-session-token.json",
    "host-ide-action-result-succeeded-open-missing-path.json",
    "host-ide-action-result-succeeded-open-with-range.json",
    "host-ide-action-result-succeeded-context-missing-context.json",
    "host-ide-action-result-succeeded-context-empty-context.json",
    "host-ide-action-result-succeeded-context-with-path-range.json",
    "host-ide-action-progress-succeeded-reveal-missing-range.json",
    "host-ide-action-progress-succeeded-context-with-path.json",
    "host-ide-action-progress-succeeded-context-with-range.json",
    "host-ide-action-progress-succeeded-context-with-context.json",
    "host-ide-action-progress-succeeded-open-with-range.json",
    "host-ide-action-result-secret-like-relative-path.json",
    "host-ide-action-result-succeeded-missing-action.json",
    "host-ide-action-progress-succeeded-missing-action.json",
    "host-ide-action-result-succeeded-context-browser-source.json",
    "host-ide-action-progress-succeeded-open-missing-path.json",
    "host-ide-action-progress-completed-in-progress.json",
    "host-ide-action-progress-running-succeeded.json",
    "host-ide-action-result-bare-private-root-message.json",
    "host-ide-action-result-punctuated-private-root-message.json",
    "host-context-snapshot-partial-selection-coordinates.json",
    "host-context-snapshot-oversized-selection-text.json",
    "host-context-snapshot-secret-like-workspace-path.json",
    "host-context-snapshot-private-display-path.json",
    "host-context-snapshot-file-contents-field.json",
    "host-context-snapshot-provider-response-field.json",
    "host-ide-action-result-succeeded-open-with-context.json",
    "host-ide-action-result-succeeded-reveal-with-context.json",
    "host-ide-action-result-succeeded-reveal-missing-range.json",
    "host-ide-action-result-failed-open-with-context.json",
    "host-ide-action-result-rejected-reveal-with-context.json",
    "host-ide-action-result-unavailable-context-with-path-range.json",
    "host-ide-action-result-uppercase-sk-message.json",
    "host-ide-action-result-active-file-excerpt-absolute-path.json",
    "host-ide-action-result-active-file-excerpt-secret-like-text.json",
    "host-ide-action-result-active-file-excerpt-oversized-text.json",
    "host-ide-action-result-active-file-excerpt-unknown-field.json",
    "host-ide-action-result-active-file-excerpt-unavailable-with-attachment.json",
    "host-ide-action-result-run-verification-command-command-field.json",
    "host-ide-action-result-run-verification-command-cloud-required.json",
    "host-ide-action-result-run-verification-command-secret-output.json",
    "host-ide-action-result-run-verification-command-private-path-output.json",
    "host-ide-action-result-run-verification-command-cwd-field.json",
    "host-ide-action-progress-run-verification-command-command-field.json",
    "host-ide-action-progress-run-verification-command-secret-summary.json",
    "host-ide-action-result-run-verification-command-missing-output.json",
    "host-ide-action-progress-run-verification-command-with-path.json",
    "host-ide-action-result-search-workspace-snippets-cloud-required.json",
    "host-ide-action-result-search-workspace-snippets-absolute-path.json",
    "host-ide-action-result-search-workspace-snippets-secret-text.json",
    "host-ide-action-result-search-workspace-snippets-command-field.json",
    "host-ide-action-result-search-workspace-snippets-provider-field.json",
    "host-ide-action-result-search-workspace-snippets-missing-snippets.json",
    "host-ide-action-result-search-workspace-snippets-failed-with-snippets.json",
    "host-runtime-status-raw-bearer-token.json",
    "host-runtime-status-api-key.json",
    "host-runtime-status-auth-headers.json",
    "host-runtime-status-cookie-header.json",
    "host-runtime-status-private-path.json",
    "host-runtime-status-request-body.json",
    "host-runtime-status-response-body.json",
    "host-runtime-status-authority-launch.json",
    "host-runtime-status-unknown-lifecycle.json",
    "host-runtime-status-unknown-surface.json",
    "host-runtime-status-shell-field.json",
    "host-runtime-status-git-field.json",
    "host-runtime-status-apply-patch-field.json",
    "host-runtime-status-tools-field.json",
    "host-runtime-status-run-command-field.json",
    "host-runtime-status-request-id.json",
    "host-runtime-status-stack-trace.json",
    "host-controlled-agent-file-read-result-private-path.json",
    "host-controlled-agent-file-read-result-blocked-body.json",
    "host-controlled-agent-file-read-result-unsafe-body.json",
    "host-controlled-agent-file-read-result-command-field.json",
    "host-controlled-agent-edit-result-private-path.json",
    "host-controlled-agent-edit-result-raw-diff-field.json",
    "host-controlled-agent-edit-result-widened-authority.json",
    "host-controlled-agent-edit-result-raw-body-included.json",
    "host-controlled-agent-multifile-apply-result-raw-body.json",
    "host-controlled-agent-multifile-apply-result-raw-diff.json",
    "host-controlled-agent-multifile-apply-result-jetbrains-overclaim.json",
    "host-controlled-agent-multifile-apply-result-command-field.json",
    "host-controlled-agent-command-run-result-raw-output.json",
    "host-controlled-agent-command-run-result-private-path.json",
    "host-controlled-agent-lexical-search-result-browser-success.json",
    "host-controlled-agent-lexical-search-result-secret-snippet.json",
    "host-controlled-agent-lexical-search-result-private-path.json",
    "host-controlled-agent-lexical-search-result-raw-content-field.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/bridge/${fileName}`,
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/bridge/host-opened-from-command-request-id.json",
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/host-opened-from-command-payload.json",
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/host-context-snapshot-unknown-field.json",
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/host-context-snapshot-absolute-path.json",
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/host-context-snapshot-secret-like-display-path.json",
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/host-context-snapshot-privileged-command.json",
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/bridge/host-context-snapshot-reversed-selection-range.json",
    "packages/contracts/schemas/bridge/host-message.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-test-ok-timeout.json",
    "packages/contracts/schemas/engine/provider-test-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-test-fail-reachable.json",
    "packages/contracts/schemas/engine/provider-test-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-test-bad-provider-id.json",
    "packages/contracts/schemas/engine/provider-test-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-test-long-provider-id.json",
    "packages/contracts/schemas/engine/provider-test-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-ollama-api-key-smuggling.json",
    "packages/contracts/schemas/engine/provider.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-ollama-unknown-field.json",
    "packages/contracts/schemas/engine/provider.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-v2-authority-field.json",
    "packages/contracts/schemas/engine/provider.schema.json"
  ],
  ...[
    "provider-auth-start-request-secret-smuggling.json",
    "provider-auth-start-request-unsafe-token-url.json",
    "provider-auth-start-request-endpoint-with-query.json",
    "provider-auth-start-request-endpoint-with-userinfo.json",
    "provider-auth-start-request-endpoint-without-experimental.json",
    "provider-auth-start-request-ttl-without-mode.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/provider-auth-start-request.schema.json"
  ]),
  ...[
    "provider-auth-exchange-request-unknown-field.json",
    "provider-auth-exchange-request-control-code.json",
    "provider-auth-exchange-request-oversized-session.json",
    "provider-auth-exchange-request-whitespace-session.json",
    "provider-auth-exchange-request-whitespace-state.json",
    "provider-auth-exchange-request-whitespace-code.json",
    "provider-auth-exchange-request-only-session.json",
    "provider-auth-exchange-request-only-code.json",
    "provider-auth-exchange-request-missing-code.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/provider-auth-exchange-request.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/engine/provider-auth-disconnect-request-token.json",
    "packages/contracts/schemas/engine/provider-auth-disconnect-request.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-status-raw-token-field.json",
    "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-status-bad-provider-id.json",
    "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-start-unsafe-authorization-url.json",
    "packages/contracts/schemas/engine/provider-auth-start-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-start-non-loopback-http-authorization-url.json",
    "packages/contracts/schemas/engine/provider-auth-start-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-status-invalid-auth-source.json",
    "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-status-pending-missing-session.json",
    "packages/contracts/schemas/engine/provider-auth-status-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-disconnect-revoked-api-key-configured.json",
    "packages/contracts/schemas/engine/provider-auth-disconnect-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/provider-auth-exchange-cloud-required.json",
    "packages/contracts/schemas/engine/provider-auth-exchange-response.schema.json"
  ],
  ...[
    ["provider-auth-status-verification-url.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-start-device-source.json", "provider-auth-start-response.schema.json"],
    ["provider-auth-exchange-browser-source.json", "provider-auth-exchange-response.schema.json"],
    ["provider-auth-disconnect-verification-url.json", "provider-auth-disconnect-response.schema.json"],
    ["provider-auth-status-not-configured.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-start-not-configured.json", "provider-auth-start-response.schema.json"],
    ["provider-auth-exchange-not-configured.json", "provider-auth-exchange-response.schema.json"],
    ["provider-auth-disconnect-not-configured.json", "provider-auth-disconnect-response.schema.json"]
  ].map(([fileName, schemaName]) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    `packages/contracts/schemas/engine/${schemaName}`
  ]),
  ...[
    ["provider-auth-status-account-label-bearer.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-redacted-sk-key.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-scopes-access-token.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-session-jwt.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-last-error-refresh-token.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-last-error-spaced-access-token.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-last-error-spaced-refresh-token.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-exchange-message-cookie.json", "provider-auth-exchange-response.schema.json"],
    ["provider-auth-exchange-last-error-client-secret.json", "provider-auth-exchange-response.schema.json"],
    ["provider-auth-start-authorization-url-token-query.json", "provider-auth-start-response.schema.json"],
    ["provider-auth-disconnect-message-private-path.json", "provider-auth-disconnect-response.schema.json"]
  ].map(([fileName, schemaName]) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    `packages/contracts/schemas/engine/${schemaName}`
  ]),
  [
    "packages/contracts/examples-invalid/engine/planner-scheduler-idle-missing-reason.json",
    "packages/contracts/schemas/engine/planner-scheduler-tick.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-scheduler-overflow-unsafe-message.json",
    "packages/contracts/schemas/engine/planner-scheduler-tick.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-scheduler-overflow-mixed-case-unsafe-message.json",
    "packages/contracts/schemas/engine/planner-scheduler-tick.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-scheduler-merge-completed-overflow-recovery.json",
    "packages/contracts/schemas/engine/planner-scheduler-tick.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-agent-status-secret-field.json",
    "packages/contracts/schemas/engine/planner-agent-run-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-agent-overflow-raw-dump-field.json",
    "packages/contracts/schemas/engine/planner-agent-run-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-agent-overflow-mixed-case-unsafe-message.json",
    "packages/contracts/schemas/engine/planner-agent-run-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-agent-done-overflow-recovery.json",
    "packages/contracts/schemas/engine/planner-agent-run-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-raw-prompt-field.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-chain-of-thought.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-secret-value.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-private-path.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-extra-field.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-raw-content-fields.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-ide-command-fields.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-oversized-id.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-oversized-message.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-oversized-path-label.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-secret-like-message.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-event-manual-runner-shell-git-fields.json",
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ],
  ...[
    "manual-runner-plan-proposal-command-field.json",
    "manual-runner-plan-proposal-unsafe-step.json",
    "manual-runner-plan-proposal-auto-run.json",
    "manual-runner-plan-proposal-authority-fields.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/manual-runner-plan-proposal.schema.json"
  ]),
  ...[
    "agent-run-plan-to-patch-proposal-request-id.json",
    "agent-run-plan-to-patch-proposal-secret.json",
    "agent-run-plan-to-patch-proposal-private-path.json",
    "agent-run-plan-to-patch-proposal-shell-command.json",
    "agent-run-plan-to-patch-proposal-freeform-command.json",
    "agent-run-plan-to-patch-proposal-verification-shell-snippet.json",
    "agent-run-plan-to-patch-proposal-verification-git-mutation.json",
    "agent-run-plan-to-patch-proposal-verification-npm-install.json",
    "agent-run-plan-to-patch-proposal-verification-network.json",
    "agent-run-plan-to-patch-proposal-verification-raw-env.json",
    "agent-run-plan-to-patch-proposal-provider-tool.json",
    "agent-run-plan-to-patch-proposal-hidden-read.json",
    "agent-run-plan-to-patch-proposal-autonomy.json",
    "agent-run-plan-to-patch-proposal-unknown-command-id.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-run-plan-to-patch-proposal.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/engine/agent-run-multistep-plan-unsafe-command.json",
    "packages/contracts/schemas/engine/agent-run-multistep-plan.schema.json"
  ],
  ...[
    "agent-run-followup-prompt-draft-unsafe-raw-output.json",
    "agent-run-followup-prompt-draft-auto-send.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-run-followup-prompt-draft.schema.json"
  ]),
  ...[
"agent-run-trace-export-raw-prompt.json",
    "agent-run-trace-export-private-path.json",
    "agent-run-trace-export-command-string.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-run-trace-export.schema.json"
  ]),
  ...[
    "agent-run-checkpoint-rollback-raw-diff.json",
    "agent-run-checkpoint-rollback-private-path.json",
    "agent-run-checkpoint-rollback-auto-rollback.json",
    "agent-run-checkpoint-rollback-freeform-command.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-run-checkpoint-rollback-state.schema.json"
  ]),
  ...[
    "coding-task-session-unknown-field.json",
    "coding-task-session-raw-prompt.json",
    "coding-task-session-cloud-required.json",
    "coding-task-session-authority-fields.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/coding-task-session.schema.json"
  ]),
  ...[
    "experimental-sandbox-session-default-enabled.json",
    "experimental-sandbox-session-missing-opt-in.json",
    "experimental-sandbox-session-assistant-opt-in.json",
    "experimental-sandbox-session-cloud-required.json",
    "experimental-sandbox-session-unsafe-path.json",
    "experimental-sandbox-session-command-field.json",
    "experimental-sandbox-session-cwd-env-fields.json",
    "experimental-sandbox-session-raw-file-body.json",
    "experimental-sandbox-session-auto-apply-run-rollback.json",
    "experimental-sandbox-session-hidden-scan.json",
    "experimental-sandbox-session-stack-trace.json",
    "experimental-sandbox-session-unknown-field.json",
    "experimental-sandbox-session-checkpoint-ready-unverified.json",
    "experimental-sandbox-session-rollback-ready-missing-plan.json",
    "experimental-sandbox-session-execution-allowed.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/experimental-sandbox-session.schema.json"
  ]),
  ...[
    "bounded-patch-verification-loop-missing-checkpoint.json",
    "bounded-patch-verification-loop-unverified-checkpoint.json",
    "bounded-patch-verification-loop-assistant-authority.json",
    "bounded-patch-verification-loop-auto-apply.json",
    "bounded-patch-verification-loop-auto-run.json",
    "bounded-patch-verification-loop-auto-rollback.json",
    "bounded-patch-verification-loop-raw-command.json",
    "bounded-patch-verification-loop-raw-args.json",
    "bounded-patch-verification-loop-raw-cwd.json",
    "bounded-patch-verification-loop-raw-env.json",
    "bounded-patch-verification-loop-unsafe-path.json",
    "bounded-patch-verification-loop-secret-like-path.json",
    "bounded-patch-verification-loop-hidden-path.json",
    "bounded-patch-verification-loop-raw-diff.json",
    "bounded-patch-verification-loop-file-body.json",
    "bounded-patch-verification-loop-stack-trace.json",
    "bounded-patch-verification-loop-cloud-required.json",
    "bounded-patch-verification-loop-execution-allowed.json",
    "bounded-patch-verification-loop-unknown-field.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/bounded-patch-verification-loop.schema.json"
  ]),
  ...[
    "controlled-agent-workspace-readiness-assistant-opt-in.json",
    "controlled-agent-workspace-readiness-private-path.json",
    "controlled-agent-workspace-readiness-command-fields.json",
    "controlled-agent-workspace-readiness-auto-actions.json",
    "controlled-agent-workspace-readiness-raw-data-fields.json",
    "controlled-agent-workspace-readiness-agent-start-allowed.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-workspace-readiness.schema.json"
  ]),
  ...[
    "controlled-agent-runtime-session-assistant-minted-start-request.json",
    "controlled-agent-runtime-session-browser-supported.json",
    "controlled-agent-runtime-session-execution-allowed.json",
    "controlled-agent-runtime-session-agent-start-allowed.json",
    "controlled-agent-runtime-session-raw-fields.json",
    "controlled-agent-runtime-session-command-authority-fields.json",
    "controlled-agent-runtime-session-missing-checkpoint-rollback-correlation.json",
    "controlled-agent-runtime-session-unbounded-limits.json",
    "controlled-agent-runtime-session-private-path-leakage.json",
    "controlled-agent-runtime-session-action-execution-fields.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-runtime-session.schema.json"
  ]),
  ...[
    "controlled-agent-file-read-absolute-path.json",
    "controlled-agent-file-read-traversal-path.json",
    "controlled-agent-file-read-hidden-path.json",
    "controlled-agent-file-read-secret-dependency-path.json",
    "controlled-agent-file-read-glob-path.json",
    "controlled-agent-file-read-regex-path.json",
    "controlled-agent-file-read-assistant-request-id.json",
    "controlled-agent-file-read-command-fields.json",
    "controlled-agent-file-read-hidden-search-indexing.json",
    "controlled-agent-file-read-binary-symlink.json",
    "controlled-agent-file-read-oversized-body.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-file-read.schema.json"
  ]),
  ...[
    "controlled-agent-command-runner-unknown-command-id.json",
    "controlled-agent-command-runner-raw-command-field.json",
    "controlled-agent-command-runner-raw-args-field.json",
    "controlled-agent-command-runner-cwd-env-fields.json",
    "controlled-agent-command-runner-assistant-request-id.json",
    "controlled-agent-command-runner-shell-git-network-provider-tool.json",
    "controlled-agent-command-runner-unbounded-timeout.json",
    "controlled-agent-command-runner-unbounded-output.json",
    "controlled-agent-command-runner-private-path-output.json",
    "controlled-agent-command-runner-secret-output.json",
    "controlled-agent-command-runner-auto-run-claim.json",
    "controlled-agent-command-runner-freeform-authority.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-command-runner.schema.json"
  ]),
  ...[
    "controlled-agent-verification-bundle-freeform-command.json",
    "controlled-agent-verification-bundle-args-cwd-env-shell.json",
    "controlled-agent-verification-bundle-git-package-network-fields.json",
    "controlled-agent-verification-bundle-unknown-command-id.json",
    "controlled-agent-verification-bundle-unbounded-sequence.json",
    "controlled-agent-verification-bundle-unbounded-timeout-output.json",
    "controlled-agent-verification-bundle-raw-output-dump.json",
    "controlled-agent-verification-bundle-private-path-output.json",
    "controlled-agent-verification-bundle-secret-output.json",
    "controlled-agent-verification-bundle-auto-run-claim.json",
    "controlled-agent-verification-bundle-production-release-overclaim.json",
    "controlled-agent-verification-bundle-provider-tool-field.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-verification-bundle.schema.json"
  ]),
  ...[
    "controlled-agent-verification-followup-raw-stdout.json",
    "controlled-agent-verification-followup-raw-stderr-summary.json",
    "controlled-agent-verification-followup-private-path-secret.json",
    "controlled-agent-verification-followup-auto-repair.json",
    "controlled-agent-verification-followup-command-field.json",
    "controlled-agent-verification-followup-provider-tool-call.json",
    "controlled-agent-verification-followup-hidden-search-read.json",
    "controlled-agent-verification-followup-production-autonomy-overclaim.json",
    "controlled-agent-verification-followup-auto-provider-send.json",
    "controlled-agent-verification-followup-cwd-env.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-verification-followup.schema.json"
  ]),
  ...[
    "controlled-agent-two-step-run-auto-verify.json",
    "controlled-agent-two-step-run-broad-mutation.json",
    "controlled-agent-two-step-run-freeform-command.json",
    "controlled-agent-two-step-run-hidden-read.json",
    "controlled-agent-two-step-run-hidden-search.json",
    "controlled-agent-two-step-run-missing-user-gate.json",
    "controlled-agent-two-step-run-production-overclaim.json",
    "controlled-agent-two-step-run-provider-call.json",
    "controlled-agent-two-step-run-raw-payload.json",
    "controlled-agent-two-step-run-stale-ids.json",
    "controlled-agent-two-step-run-tool-call.json",
    "controlled-agent-two-step-run-unbounded-steps.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-two-step-run.schema.json"
  ]),
  ...[
    "controlled-agent-recovery-matrix-auto-retry-rollback.json",
    "controlled-agent-recovery-matrix-hidden-repair.json",
    "controlled-agent-recovery-matrix-private-path-secret.json",
    "controlled-agent-recovery-matrix-raw-output.json",
    "controlled-agent-recovery-matrix-stale-result-accepted.json",
    "controlled-agent-recovery-matrix-unbounded-attempts.json",
    "controlled-agent-recovery-matrix-unsupported-host-overclaim.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-recovery-matrix.schema.json"
  ]),
  ...[
    "controlled-agent-task-presets-broad-workspace-mutation.json",
    "controlled-agent-task-presets-free-form-command.json",
    "controlled-agent-task-presets-hidden-search.json",
    "controlled-agent-task-presets-missing-user-gates.json",
    "controlled-agent-task-presets-production-claims.json",
    "controlled-agent-task-presets-raw-persistence.json",
    "controlled-agent-task-presets-unsafe-authority.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-task-preset.schema.json"
  ]),
  ...[
    "controlled-agent-edit-executor-unsafe-path.json",
    "controlled-agent-edit-executor-missing-hash.json",
    "controlled-agent-edit-executor-command-raw-diff.json",
    "controlled-agent-edit-executor-unsupported-operation.json",
    "controlled-agent-edit-executor-unbounded-limits.json",
    "controlled-agent-edit-executor-assistant-authority.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-edit-executor.schema.json"
  ]),
  ...[
    "controlled-agent-run-state-auto-start.json",
    "controlled-agent-run-state-shell-git-provider-tool.json",
    "controlled-agent-run-state-raw-prompt-field.json",
    "controlled-agent-run-state-raw-command-field.json",
    "controlled-agent-run-state-assistant-request-id.json",
    "controlled-agent-run-state-unbounded-limits.json",
    "controlled-agent-run-state-private-path-detail.json",
    "controlled-agent-run-state-missing-stop-reason.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-run-state.schema.json"
  ]),
  ...[
    "controlled-agent-one-step-loop-auto-repair.json",
    "controlled-agent-one-step-loop-freeform-command.json",
    "controlled-agent-one-step-loop-hidden-read-search.json",
    "controlled-agent-one-step-loop-raw-prompt-diff-output.json",
    "controlled-agent-one-step-loop-unbounded-edit.json",
    "controlled-agent-one-step-loop-git-network-tool-package-authority.json",
    "controlled-agent-one-step-loop-multiple-repairs.json",
    "controlled-agent-one-step-loop-repair-without-user-confirmation.json",
    "controlled-agent-one-step-loop-repair-freeform-command.json",
    "controlled-agent-one-step-loop-repair-raw-output-diff.json",
    "controlled-agent-one-step-loop-repair-authority-expansion.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-one-step-loop.schema.json"
  ]),
  ...[
    "controlled-agent-provider-proposal-raw-payload.json",
    "controlled-agent-provider-proposal-tool-call.json",
    "controlled-agent-provider-proposal-auto-apply.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-provider-proposal.schema.json"
  ]),
  ...[
    "controlled-agent-search-informed-proposal-raw-search-body.json",
    "controlled-agent-search-informed-proposal-hidden-result.json",
    "controlled-agent-search-informed-proposal-assistant-minted-context.json",
    "controlled-agent-search-informed-proposal-provider-tool-call.json",
    "controlled-agent-search-informed-proposal-command-field.json",
    "controlled-agent-search-informed-proposal-private-path-secret.json",
    "controlled-agent-search-informed-proposal-production-autonomy.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-search-informed-proposal.schema.json"
  ]),
  ...[
    "controlled-agent-multifile-patch-plan-broad-mutation.json",
    "controlled-agent-multifile-patch-plan-raw-replacement-body.json",
    "controlled-agent-multifile-patch-plan-create-operation.json",
    "controlled-agent-multifile-patch-plan-delete-operation.json",
    "controlled-agent-multifile-patch-plan-rename-operation.json",
    "controlled-agent-multifile-patch-plan-absolute-private-path.json",
    "controlled-agent-multifile-patch-plan-dependency-path.json",
    "controlled-agent-multifile-patch-plan-generated-path.json",
    "controlled-agent-multifile-patch-plan-assistant-minted-apply.json",
    "controlled-agent-multifile-patch-plan-missing-pre-edit-hash.json",
    "controlled-agent-multifile-patch-plan-over-budget-files.json",
    "controlled-agent-multifile-patch-plan-over-budget-replacement-bytes.json",
    "controlled-agent-multifile-patch-plan-command-field.json",
    "controlled-agent-multifile-patch-plan-provider-field.json",
    "controlled-agent-multifile-patch-plan-tool-field.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-multifile-patch-plan.schema.json"
  ]),
  ...[
    "controlled-agent-patch-plan-raw-diff.json",
    "controlled-agent-patch-plan-auto-apply.json",
    "controlled-agent-patch-plan-create-operation.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-patch-plan.schema.json"
  ]),
  ...[
    "controlled-agent-authority-registry-raw-payload-fields.json",
    "controlled-agent-authority-registry-unsupported-host-execution.json",
    "controlled-agent-authority-registry-hidden-search-indexing.json",
    "controlled-agent-authority-registry-freeform-command-cwd-env.json",
    "controlled-agent-authority-registry-broad-mutation.json",
    "controlled-agent-authority-registry-provider-tool-authority.json",
    "controlled-agent-authority-registry-production-release-claims.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-authority-registry.schema.json"
  ]),
  ...[
    "controlled-agent-task-harness-raw-data.json",
    "controlled-agent-task-harness-hidden-authority.json",
    "controlled-agent-task-harness-unsupported-browser-host.json",
    "controlled-agent-task-harness-stale-lineage-accepted.json",
    "controlled-agent-task-harness-invalid-lineage-accepted-proposal-state.json",
    "controlled-agent-task-harness-production-overclaim.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-task-harness.schema.json"
  ]),
  ...[
    "controlled-agent-workflow-transcript-raw-data.json",
    "controlled-agent-workflow-transcript-private-path.json",
    "controlled-agent-workflow-transcript-command-output.json",
    "controlled-agent-workflow-transcript-bridge-dump.json",
    "controlled-agent-workflow-transcript-browser-storage-dump.json",
    "controlled-agent-workflow-transcript-overclaim.json",
    "controlled-agent-workflow-transcript-missing-task-preset-label.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-workflow-transcript.schema.json"
  ]),
  ...[
    "controlled-agent-lexical-search-assistant-minted.json",
    "controlled-agent-lexical-search-regex-query.json",
    "controlled-agent-lexical-search-glob-query.json",
    "controlled-agent-lexical-search-private-path.json",
    "controlled-agent-lexical-search-hidden-path.json",
    "controlled-agent-lexical-search-dependency-path.json",
    "controlled-agent-lexical-search-broad-recursive.json",
    "controlled-agent-lexical-search-indexing.json",
    "controlled-agent-lexical-search-browser-execution.json",
    "controlled-agent-lexical-search-jetbrains-execution.json",
    "controlled-agent-lexical-search-provider-field.json",
    "controlled-agent-lexical-search-secret-snippet.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/controlled-agent-lexical-search.schema.json"
  ]),
  ...[
    "tool-authority-policy-permissive-default.json",
    "tool-authority-policy-shell-allow.json",
    "tool-authority-policy-git-allow.json",
    "tool-authority-policy-provider-tool-allow.json",
    "tool-authority-policy-assistant-request-id.json",
    "tool-authority-policy-cloud-required.json",
    "tool-authority-policy-raw-command.json",
    "tool-authority-policy-cwd-env.json",
    "tool-authority-policy-absolute-path.json",
    "tool-authority-policy-home-path.json",
    "tool-authority-policy-secret-marker.json",
    "tool-authority-policy-hidden-search-metadata.json",
    "tool-authority-policy-unknown-field.json",
    "tool-authority-policy-network-allow.json",
    "tool-authority-policy-remote-publish-allow.json",
    "tool-authority-policy-git-remote-mutation.json",
    "tool-authority-policy-network-fetch-payload.json",
    "tool-authority-policy-raw-log-stack.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/tool-authority-policy.schema.json"
  ]),
  ...[
    "assistant-ide-action-proposal-shell-action.json",
    "assistant-ide-action-proposal-tool-action.json",
    "assistant-ide-action-proposal-git-action.json",
    "assistant-ide-action-proposal-task-action.json",
    "assistant-ide-action-proposal-edit-action.json",
    "assistant-ide-action-proposal-missing-confirmation.json",
    "assistant-ide-action-proposal-confirmation-false.json",
    "assistant-ide-action-proposal-cloud-required-true.json",
    "assistant-ide-action-proposal-extra-request-id.json",
    "assistant-ide-action-proposal-absolute-path.json",
    "assistant-ide-action-proposal-traversal-path.json",
    "assistant-ide-action-proposal-secret-like-path.json",
    "assistant-ide-action-proposal-uppercase-sk-path.json",
    "assistant-ide-action-proposal-secret-summary.json",
    "assistant-ide-action-proposal-control-summary.json",
    "assistant-ide-action-proposal-reversed-range.json",
    "assistant-ide-action-proposal-open-file-with-range.json",
    "assistant-ide-action-proposal-get-context-with-path-range.json",
    "assistant-ide-action-proposal-reveal-range-missing-path.json",
    "assistant-ide-action-proposal-reveal-range-missing-range.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/assistant-ide-action-proposal.schema.json"
  ]),
  ...[
    "agent-progress-event-ide-action-missing-request-id.json",
    "agent-progress-event-ide-action-bad-action.json",
    "agent-progress-event-ide-action-absolute-path.json",
    "agent-progress-event-ide-action-traversal-path.json",
    "agent-progress-event-offset-timestamp.json",
    "agent-progress-event-sk-secret-message.json",
    "agent-progress-event-tmp-path-message.json",
    "agent-progress-event-ide-action-access-token-request-id.json",
    "agent-progress-event-ide-action-get-context-with-path-range.json",
    "agent-progress-event-ide-action-open-file-missing-path.json",
    "agent-progress-event-ide-action-reveal-range-missing-path.json",
    "agent-progress-event-ide-action-reveal-range-missing-range.json",
    "agent-progress-event-ide-action-reversed-line-range.json",
    "agent-progress-event-ide-action-reversed-character-range.json",
    "agent-progress-event-ide-action-browser-source.json",
    "agent-progress-event-ide-action-jetbrains-source.json",
    "agent-progress-event-secret-id.json",
    "agent-progress-event-lowercase-private-key-marker.json",
    "agent-progress-event-secret-like-relative-path.json",
    "agent-progress-event-bare-tmp-path-message.json",
    "agent-progress-event-bare-users-path-message.json",
    "agent-progress-event-bare-home-path-message.json",
    "agent-progress-event-bare-private-path-message.json",
    "agent-progress-event-punctuated-private-path-message.json",
    "agent-progress-event-etc-path-message.json",
    "agent-progress-event-windows-drive-slash-message.json",
    "agent-progress-event-uppercase-sk-message.json",
    "agent-progress-event-uppercase-sk-id.json",
    "agent-progress-event-uppercase-sk-path.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-progress-event.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-huge-output-tail.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-offset-timestamp.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-excessive-heartbeat-age.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-invalid-heartbeat-age-type.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-raw-provider-response.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-manual-runner-raw-provider-response.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-file-content-payload.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-secret-key.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-overflow-mixed-case-unsafe.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-overflow-overlong-message.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-done-overflow-recovery.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-done-failed-overflow-recovery.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  ...[
    "agent-progress-snapshot-tmp-path-message.json",
    "agent-progress-snapshot-var-path-message.json",
    "agent-progress-snapshot-volumes-path-message.json",
    "agent-progress-snapshot-mixed-case-private-path-message.json",
    "agent-progress-snapshot-bare-tmp-path-message.json",
    "agent-progress-snapshot-bare-users-path-message.json",
    "agent-progress-snapshot-bare-home-path-message.json",
    "agent-progress-snapshot-bare-private-path-message.json",
    "agent-progress-snapshot-etc-path-message.json",
    "agent-progress-snapshot-opt-path-message.json",
    "agent-progress-snapshot-mnt-path-message.json",
    "agent-progress-snapshot-windows-drive-slash-path-message.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-sk-proj-message.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-snapshot-uppercase-sk-message.json",
    "packages/contracts/schemas/engine/agent-progress-snapshot.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-done-overflow-recovery.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-done-failed-overflow-recovery.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-raw-prompt-field.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-chain-of-thought-field.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-raw-provider-response.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-file-content-payload.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-secret-field.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-secret-value.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-private-path.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  ...[
    "agent-progress-list-tmp-path-message.json",
    "agent-progress-list-var-path-message.json",
    "agent-progress-list-volumes-path-message.json",
    "agent-progress-list-mixed-case-private-path-message.json",
    "agent-progress-list-bare-tmp-path-message.json",
    "agent-progress-list-bare-users-path-message.json",
    "agent-progress-list-bare-home-path-message.json",
    "agent-progress-list-bare-private-path-message.json",
    "agent-progress-list-etc-path-message.json",
    "agent-progress-list-opt-path-message.json",
    "agent-progress-list-mnt-path-message.json",
    "agent-progress-list-windows-drive-slash-path-message.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-sk-secret-tail.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-uppercase-sk-tail.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-cloud-required.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-manual-runner-secret-prompt.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-managed-provider-access.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-overlong-generated-at.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-source-metadata.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-oversized-output-tail.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-overflow-raw-content-marker.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/agent-progress-list-unbounded-snapshots.json",
    "packages/contracts/schemas/engine/agent-progress-list-response.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-card-verified-without-merge.json",
    "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-card-overflow-overlong-summary.json",
    "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-pool-mixed-case-unsafe-summary.json",
    "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-pool-overflow-mixed-case-unsafe-message.json",
    "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-card-overflow-mixed-case-unsafe-message.json",
    "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-pool-closed-overflow-recovery.json",
    "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/planner-card-verified-overflow-recovery.json",
    "packages/contracts/schemas/engine/planner-card-pool-status.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/model-unknown-capability-field.json",
    "packages/contracts/schemas/engine/models.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/model-invalid-readiness-status.json",
    "packages/contracts/schemas/engine/models.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/model-secret-provider-response-field.json",
    "packages/contracts/schemas/engine/models.schema.json"
  ],
  ...[
    "model-v2-unknown-provenance.json",
    "model-v2-bad-timestamp.json",
    "model-v2-secret-like-local-availability-reason.json",
    "model-v2-private-path-local-availability-reason.json",
    "model-v2-raw-provider-response-field.json",
    "model-v2-unknown-field.json",
    "model-v2-authority-fields.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/models.schema.json"
  ]),
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-raw-provider-body.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-unknown-code.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-debug-payload.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-secret-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-token-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-cookie-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-private-path-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-windows-path-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-home-path-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-private-root-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-codex-auth-path-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-auth-json-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-empty-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-missing-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/error-sse-event-overlong-message.json",
    "packages/contracts/schemas/engine/sse-event.schema.json"
  ]
].map(([examplePath, schemaPath]) => [normalizeContractPath(examplePath), normalizeContractPath(schemaPath)]);

const allowlistedUnmappedExamples = [].map(normalizeContractPath);

const identityChecks = [
  {
    examplePath: "packages/contracts/examples/engine/ping-response.json",
    field: "productId",
    identityPath: "product.id"
  },
  {
    examplePath: "packages/contracts/examples/engine/ping-response.json",
    field: "displayName",
    identityPath: "product.displayName"
  },
  {
    examplePath: "packages/contracts/examples/engine/caps-response.json",
    field: "productId",
    identityPath: "product.id"
  }
].map((check) => ({ ...check, examplePath: normalizeContractPath(check.examplePath) }));

async function discoverJsonFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return discoverJsonFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [normalizeContractPath(path)] : [];
    })
  );

  return files.flat().sort();
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${path}: read failure (${error.message})`);
  }
}

async function readJson(path) {
  const text = await readText(path);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: JSON parse failure (${error.message})`);
  }
}

function getIdentityValue(identity, identityPath) {
  return identityPath.split(".").reduce((value, key) => value?.[key], identity);
}

function collectControlledAgentEditReplacementByteCountFailures(examplePath, example) {
  if (example?.type !== "gui.controlledAgentEditRequest") {
    return [];
  }
  return collectReplacementTextBoundFailures(examplePath, example, "payload.edits");
}

function collectControlledAgentMultifileApplyReplacementFailures(examplePath, example) {
  if (example?.type !== "gui.controlledAgentMultifileApplyRequest") {
    return [];
  }
  return collectReplacementTextBoundFailures(examplePath, example, "payload.edits", true);
}

function collectReplacementTextBoundFailures(examplePath, example, editPath, requireHash = false) {
  const failures = [];
  const edits = example?.payload?.edits;
  if (!Array.isArray(edits)) {
    return failures;
  }
  for (const [index, edit] of edits.entries()) {
    if (typeof edit?.replacementText !== "string") {
      continue;
    }
    const actualByteCount = Buffer.byteLength(edit.replacementText, "utf8");
    if (edit.replacementByteCount !== actualByteCount) {
      failures.push(
        `${examplePath}: payload.edits[${index}].replacementByteCount must equal UTF-8 byte length of replacementText; expected ${actualByteCount}, got ${JSON.stringify(
          edit.replacementByteCount
        )}`
      );
    }
    if (requireHash) {
      const actualHash = `sha256:${createHash("sha256").update(edit.replacementText, "utf8").digest("hex")}`;
      if (edit.replacementContentHash !== actualHash) {
        failures.push(`${examplePath}: ${editPath}[${index}].replacementContentHash must equal SHA-256 of replacementText; expected ${actualHash}, got ${JSON.stringify(edit.replacementContentHash)}`);
      }
    }
  }
  return failures;
}

function isControlledAgentEditByteCountMismatchInvalidExample(examplePath) {
  return examplePath.includes("/gui-controlled-agent-edit-request-byte-count-mismatch.json");
}

function isControlledAgentMultifileApplyReplacementMismatchInvalidExample(examplePath) {
  return examplePath.includes("/gui-controlled-agent-multifile-apply-byte-count-mismatch.json") || examplePath.includes("/gui-controlled-agent-multifile-apply-content-hash-mismatch.json");
}

function isControlledAgentMultifileApplySchemaOnlyInvalidExample(examplePath) {
  return examplePath.includes("/gui-controlled-agent-multifile-apply-missing-hash.json") || examplePath.includes("/gui-controlled-agent-multifile-apply-over-budget.json");
}

function collectMappingCoverageFailures(exampleFiles, schemaFiles) {
  const discoveredExamples = new Set(exampleFiles.map(normalizeContractPath));
  const discoveredSchemas = new Set(schemaFiles.map(normalizeContractPath));
  const mappedExamples = new Set(mappings.map(([examplePath]) => examplePath));
  const mappedSchemas = new Set(mappings.map(([, schemaPath]) => schemaPath));
  const allowlistedExamples = new Set(allowlistedUnmappedExamples);
  const failures = [];

  for (const examplePath of discoveredExamples) {
    if (!mappedExamples.has(examplePath) && !allowlistedExamples.has(examplePath)) {
      failures.push(
        `${examplePath}: unmapped contract example; add an explicit example→schema mapping or an allowlist entry with a clear reason`
      );
    }
  }

  for (const examplePath of mappedExamples) {
    if (!discoveredExamples.has(examplePath)) {
      failures.push(`${examplePath}: mapped example file was not discovered`);
    }
  }

  for (const schemaPath of mappedSchemas) {
    if (!discoveredSchemas.has(schemaPath)) {
      failures.push(`${schemaPath}: mapped schema file was not discovered`);
    }
  }

  for (const examplePath of allowlistedExamples) {
    if (!discoveredExamples.has(examplePath)) {
      failures.push(`${examplePath}: allowlisted unmapped example file was not discovered`);
    }
  }

  return failures;
}

function collectInvalidMappingCoverageFailures(exampleFiles, schemaFiles) {
  const discoveredExamples = new Set(exampleFiles.map(normalizeContractPath));
  const discoveredSchemas = new Set(schemaFiles.map(normalizeContractPath));
  const mappedExamples = new Set(invalidMappings.map(([examplePath]) => examplePath));
  const mappedSchemas = new Set(invalidMappings.map(([, schemaPath]) => schemaPath));
  const failures = [];

  for (const examplePath of discoveredExamples) {
    if (!mappedExamples.has(examplePath)) {
      failures.push(
        `${examplePath}: unmapped invalid contract example; add an explicit invalid example→schema mapping`
      );
    }
  }

  for (const examplePath of mappedExamples) {
    if (!discoveredExamples.has(examplePath)) {
      failures.push(`${examplePath}: mapped invalid example file was not discovered`);
    }
  }

  for (const schemaPath of mappedSchemas) {
    if (!discoveredSchemas.has(schemaPath)) {
      failures.push(`${schemaPath}: invalid example mapped schema file was not discovered`);
    }
  }

  return failures;
}

const ajv = new Ajv({ allErrors: true, strict: true, $data: true });

ajv.addKeyword({
  keyword: "maxTotalReplacementText",
  type: "object",
  schemaType: "number",
  validate(limit, payload) {
    if (!Array.isArray(payload?.edits)) {
      return true;
    }
    let total = 0;
    for (const fileEdit of payload.edits) {
      if (!Array.isArray(fileEdit?.textReplacements)) {
        continue;
      }
      for (const replacement of fileEdit.textReplacements) {
        if (typeof replacement?.replacementText === "string") {
          total += replacement.replacementText.length;
          if (total > limit) {
            return false;
          }
        }
      }
    }
    return true;
  }
});

ajv.addKeyword({
  keyword: "replacementTextMatchesByteCount",
  type: "object",
  schemaType: "boolean",
  errors: false,
  validate(required, edit) {
    if (!required || typeof edit?.replacementText !== "string") {
      return true;
    }
    return edit.replacementByteCount === Buffer.byteLength(edit.replacementText, "utf8");
  }
});

ajv.addKeyword({
  keyword: "replacementTextMatchesHash",
  type: "object",
  schemaType: "boolean",
  errors: false,
  validate(required, edit) {
    if (!required || typeof edit?.replacementText !== "string") {
      return true;
    }
    return edit.replacementContentHash === `sha256:${createHash("sha256").update(edit.replacementText, "utf8").digest("hex")}`;
  }
});

ajv.addKeyword({
  keyword: "uniquePathsInEdits",
  type: "object",
  schemaType: "boolean",
  errors: false,
  validate(required, payload) {
    if (!required) {
      return true;
    }
    if (!Array.isArray(payload?.edits)) {
      return true;
    }
    const seen = new Set();
    for (const fileEdit of payload.edits) {
      const path = fileEdit?.workspaceRelativePath;
      if (typeof path !== "string") {
        return true;
      }
      if (seen.has(path)) {
        return false;
      }
      seen.add(path);
    }
    return true;
  }
});
ajv.addKeyword({
  keyword: "maxTotalSelectionText",
  type: "object",
  schemaType: "number",
  validate(limit, context) {
    if (!Array.isArray(context?.items)) {
      return true;
    }
    let total = 0;
    for (const item of context.items) {
      const text = item?.selection?.text;
      if (typeof text === "string") {
        total += text.length;
        if (total > limit) {
          return false;
        }
      }
    }
    return true;
  }
});

addFormats(ajv);

const failures = [];
const compiledSchemas = new Map();
const parsedExamples = new Map();
const parsedInvalidExamples = new Map();

let schemaFiles = [];
let exampleFiles = [];
let invalidExampleFiles = [];
let schemaDiscoverySucceeded = false;
let exampleDiscoverySucceeded = false;
let invalidExampleDiscoverySucceeded = false;
let identity = null;

try {
  schemaFiles = await discoverJsonFiles("packages/contracts/schemas");
  schemaDiscoverySucceeded = true;
} catch (error) {
  failures.push(`packages/contracts/schemas: read failure (${error.message})`);
}

try {
  exampleFiles = await discoverJsonFiles("packages/contracts/examples");
  exampleDiscoverySucceeded = true;
} catch (error) {
  failures.push(`packages/contracts/examples: read failure (${error.message})`);
}

try {
  invalidExampleFiles = await discoverJsonFiles("packages/contracts/examples-invalid");
  invalidExampleDiscoverySucceeded = true;
} catch (error) {
  failures.push(`packages/contracts/examples-invalid: read failure (${error.message})`);
}

try {
  identity = await readJson("product/identity.json");
} catch (error) {
  failures.push(error.message);
}

if (schemaDiscoverySucceeded && schemaFiles.length === 0) {
  failures.push("packages/contracts/schemas: no contract schemas discovered");
}

if (exampleDiscoverySucceeded && exampleFiles.length === 0) {
  failures.push("packages/contracts/examples: no positive contract examples discovered");
}

if (invalidExampleDiscoverySucceeded && invalidExampleFiles.length === 0) {
  failures.push("packages/contracts/examples-invalid: no invalid contract examples discovered");
}

if (schemaDiscoverySucceeded && exampleDiscoverySucceeded) {
  failures.push(...collectMappingCoverageFailures(exampleFiles, schemaFiles));
}

if (schemaDiscoverySucceeded && invalidExampleDiscoverySucceeded) {
  failures.push(...collectInvalidMappingCoverageFailures(invalidExampleFiles, schemaFiles));
}

for (const schemaPath of schemaFiles) {
  try {
    const schema = await readJson(schemaPath);
    compiledSchemas.set(schemaPath, ajv.compile(schema));
  } catch (error) {
    failures.push(`${schemaPath}: schema compilation failure (${error.message})`);
  }
}

for (const examplePath of exampleFiles) {
  try {
    parsedExamples.set(examplePath, await readJson(examplePath));
  } catch (error) {
    failures.push(error.message);
  }
}

for (const examplePath of invalidExampleFiles) {
  try {
    parsedInvalidExamples.set(examplePath, await readJson(examplePath));
  } catch (error) {
    failures.push(error.message);
  }
}

for (const [examplePath, schemaPath] of mappings) {
  try {
    const validate = compiledSchemas.get(schemaPath);
    const example = parsedExamples.get(examplePath);

    if (validate === undefined || example === undefined) {
      continue;
    }

    failures.push(...collectControlledAgentEditReplacementByteCountFailures(examplePath, example));
    failures.push(...collectControlledAgentMultifileApplyReplacementFailures(examplePath, example));

    if (!validate(example)) {
      const details = ajv.errorsText(validate.errors, { separator: "\n  " });
      failures.push(`${examplePath}: positive example failed schema validation against ${schemaPath}:\n  ${details}`);
    }
  } catch (error) {
    failures.push(error.message);
  }
}

for (const [examplePath, schemaPath] of invalidMappings) {
  try {
    const validate = compiledSchemas.get(schemaPath);
    const example = parsedInvalidExamples.get(examplePath);

    if (validate === undefined || example === undefined) {
      continue;
    }

    const byteCountFailures = collectControlledAgentEditReplacementByteCountFailures(examplePath, example);
    if (isControlledAgentEditByteCountMismatchInvalidExample(examplePath)) {
      if (byteCountFailures.length === 0) {
        failures.push(`${examplePath}: byte-count mismatch invalid example did not fail replacementByteCount validation`);
      }
      continue;
    }
    failures.push(...byteCountFailures);

    if (isControlledAgentMultifileApplySchemaOnlyInvalidExample(examplePath)) {
      if (validate(example)) {
        failures.push(`${examplePath}: invalid example unexpectedly passed schema validation against ${schemaPath}`);
      }
      continue;
    }
    const multifileReplacementFailures = collectControlledAgentMultifileApplyReplacementFailures(examplePath, example);
    if (isControlledAgentMultifileApplyReplacementMismatchInvalidExample(examplePath)) {
      if (multifileReplacementFailures.length === 0) {
        failures.push(`${examplePath}: replacement mismatch invalid example did not fail replacementText bound validation`);
      }
      continue;
    }
    failures.push(...multifileReplacementFailures);

    if (validate(example)) {
      failures.push(`${examplePath}: invalid example unexpectedly passed schema validation against ${schemaPath}`);
    }
  } catch (error) {
    failures.push(error.message);
  }
}

if (identity !== null) {
  for (const { examplePath, field, identityPath } of identityChecks) {
    const example = parsedExamples.get(examplePath);
    if (example === undefined) {
      continue;
    }

    const actual = example[field];
    const expected = getIdentityValue(identity, identityPath);
    if (actual !== expected) {
      failures.push(
        `${examplePath}: identity mismatch for ${field}; expected product/identity.json ${identityPath} (${JSON.stringify(
          expected
        )}), got ${JSON.stringify(actual)}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Contract validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Contract validation passed (${schemaFiles.length} schemas, ${exampleFiles.length} examples, ${invalidExampleFiles.length} invalid examples).`
);

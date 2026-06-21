import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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
  ["packages/contracts/examples/engine/coding-task-session.json", "packages/contracts/schemas/engine/coding-task-session.schema.json"],
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
  ["packages/contracts/examples/bridge/gui-ide-action-request-run-verification-command.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/gui-ide-action-request-search-workspace-snippets.json", "packages/contracts/schemas/bridge/gui-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-progress-search-workspace-snippets.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-search-workspace-snippets.json", "packages/contracts/schemas/bridge/host-message.schema.json"],
  ["packages/contracts/examples/bridge/host-ide-action-result-search-workspace-snippets-rejected.json", "packages/contracts/schemas/bridge/host-message.schema.json"]
].map(([examplePath, schemaPath]) => [normalizeContractPath(examplePath), normalizeContractPath(schemaPath)]);

const invalidMappings = [
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
    "packages/contracts/examples-invalid/engine/project-memory-note-private-path.json",
    "packages/contracts/schemas/engine/project-memory-note.schema.json"
  ],
  [
    "packages/contracts/examples-invalid/engine/project-memory-note-oversized-text.json",
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
    "gui-ide-action-request-search-workspace-snippets-assistant-query.json"
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
    "host-runtime-status-stack-trace.json"
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
    ["provider-auth-status-account-label-bearer.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-redacted-sk-key.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-scopes-access-token.json", "provider-auth-status-response.schema.json"],
    ["provider-auth-status-session-jwt.json", "provider-auth-status-response.schema.json"],
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
    "coding-task-session-unknown-field.json",
    "coding-task-session-raw-prompt.json",
    "coding-task-session-cloud-required.json",
    "coding-task-session-authority-fields.json"
  ].map((fileName) => [
    `packages/contracts/examples-invalid/engine/${fileName}`,
    "packages/contracts/schemas/engine/coding-task-session.schema.json"
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
    "tool-authority-policy-remote-publish-allow.json"
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

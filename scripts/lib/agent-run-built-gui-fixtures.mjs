import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const agentRunBuiltGuiFixture = Object.freeze({
  bridgeVersion: "2026-05-15",
  chatId: "chat-agent-run-built-gui",
  providerId: "agent-run-built-gui-provider",
  modelId: "agent-run-built-gui-model",
  goal: "Update the fixture greeting after reviewing explicit local context.",
  userPrompt: "Use only the attached explicit context and return one strict safe-edit proposal JSON object.",
  commandId: "repository-check",
  requestIds: Object.freeze({
    apply: "gui-agent-run-apply-fixture-1",
    verification: "gui-agent-run-verification-fixture-1",
  }),
  explicitContext: Object.freeze({
    kind: "active_editor",
    source: "vscode",
    file: Object.freeze({ displayPath: "src/agentRunFixture.ts", workspaceRelativePath: "src/agentRunFixture.ts", languageId: "typescript" }),
    selection: Object.freeze({ startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 1, text: "export function fixtureGreeting() {\n  return 'old greeting';\n}" }),
    key: "context-agent-run-built-gui",
  }),
  safeEdit: Object.freeze({
    requiresUserConfirmation: true,
    summary: "Replace fixture greeting after explicit review.",
    cloudRequired: false,
    edits: Object.freeze([{ workspaceRelativePath: "src/agentRunFixture.ts", textReplacements: Object.freeze([{ range: Object.freeze({ start: Object.freeze({ line: 2, character: 9 }), end: Object.freeze({ line: 2, character: 23 }) }), replacementText: "'new greeting'" }]) }]),
  }),
  checkpoint: Object.freeze({
    checkpointId: "checkpointAgentRunBuiltGui",
    checkpointHash: sha256("checkpointAgentRunBuiltGui"),
    checkedAt: "2026-06-23T12:00:00Z",
    label: "Verified built-GUI fixture checkpoint",
  }),
  verificationOutputTail: "Repository fixture check passed.",
});

export const agentRunBuiltGuiRawMarkers = Object.freeze([
  "sk-agent-run-built-gui-secret",
  "access_token",
  "Authorization",
  "Bearer",
  "raw diff",
  "raw file body",
  "raw command",
  "npm run check",
  "--watch",
  "\"command\"",
  "\"args\"",
  "\"cwd\"",
  "\"env\"",
  "PRIVATE_TEMP_PATH",
  "/Users/",
  "C:\\Users\\",
]);

export function agentRunBuiltGuiProviderSummary(overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  return {
    id: fixture.providerId,
    kind: "openai-compatible",
    displayName: "Agent Run Built GUI Fixture Provider",
    enabled: true,
    baseUrl: "http://127.0.0.1:43210/v1",
    auth: { type: "none", configured: false },
    models: [agentRunBuiltGuiModelSummary()],
    capabilities: { chat: true, completion: false, embeddings: false },
    ...overrides,
  };
}

export function agentRunBuiltGuiModelSummary(overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  return {
    id: fixture.modelId,
    displayName: fixture.modelId,
    providerId: fixture.providerId,
    capabilities: { chat: true, streaming: true, tools: false, reasoning: false },
    readiness: { status: "ready" },
    ...overrides,
  };
}

export function agentRunBuiltGuiCapsResponse(overrides = {}) {
  const provider = agentRunBuiltGuiProviderSummary();
  return {
    productId: "yet-ai",
    protocolVersion: agentRunBuiltGuiFixture.bridgeVersion,
    runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
    capabilities: [],
    features: {},
    providers: [provider],
    ide: { bridge: true, lsp: false, host: "vscode" },
    agentRunReadiness: agentRunBuiltGuiReadinessMetadata(),
    ...overrides,
  };
}

export function agentRunBuiltGuiReadinessMetadata(overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  const touchedFiles = fixture.safeEdit.edits.map((edit) => edit.workspaceRelativePath);
  return {
    loopId: "loopAgentRunBuiltGuiFixture",
    goal: { id: "goalAgentRunBuiltGuiFixture", title: "Built GUI Agent Run fixture", summary: "One-step Agent Run smoke fixture goal." },
    proposal: {
      id: "proposalAgentRunBuiltGuiFixture",
      summary: fixture.safeEdit.summary,
      touchedFiles,
      source: "assistant_proposal",
      editCount: 1,
      patchBytes: 128,
      contentHash: sha256(JSON.stringify(fixture.safeEdit)),
    },
    checkpoint: {
      checkpointId: fixture.checkpoint.checkpointId,
      checkpointVerified: true,
      checkpointHash: fixture.checkpoint.checkpointHash,
      checkedAt: fixture.checkpoint.checkedAt,
      label: fixture.checkpoint.label,
    },
    sandbox: agentRunBuiltGuiSandboxMetadata(),
    policy: agentRunBuiltGuiPolicyMetadata(),
    verificationCommandId: fixture.commandId,
    ...overrides,
  };
}

export function agentRunBuiltGuiSandboxMetadata(overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  return {
    kind: "experimental_sandbox_session",
    version: "2026-06-21",
    mode: "sandbox_experimental",
    defaultEnabled: false,
    cloudRequired: false,
    authority: "metadata_only",
    executionAllowed: false,
    modeStatus: "checkpoint_ready",
    userOptIn: {
      origin: "user",
      confirmedBy: "user",
      confirmedAt: fixture.checkpoint.checkedAt,
      disposableWorkspaceAcknowledged: true,
      requestIdMintedBy: "gui",
      optInLabel: "Manual Agent Run built-GUI fixture review",
    },
    limits: { maxSteps: 4, maxTouchedFiles: 4, maxPatchBytes: 4096, maxRuntimeSeconds: 120, workspaceRelativePaths: fixture.safeEdit.edits.map((edit) => edit.workspaceRelativePath) },
    checkpoint: {
      status: "verified",
      checkpointId: fixture.checkpoint.checkpointId,
      createdAt: fixture.checkpoint.checkedAt,
      verified: true,
      fileCount: fixture.safeEdit.edits.length,
      contentHash: fixture.checkpoint.checkpointHash,
      label: fixture.checkpoint.label,
    },
    rollback: {
      status: "planned",
      planId: "rollbackAgentRunBuiltGuiFixture",
      planHash: sha256("rollbackAgentRunBuiltGuiFixture"),
      affectedFileCount: fixture.safeEdit.edits.length,
      requiresUserConfirmation: true,
      label: "Manual rollback metadata",
    },
    ...overrides,
  };
}

export function agentRunBuiltGuiPolicyMetadata(overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  return {
    kind: "tool_authority_policy",
    version: "2026-06-21",
    capability: "allowlisted_verification",
    decision: "requires_confirmation",
    source: "gui",
    cloudRequired: false,
    executionAllowed: false,
    allowlistedCommandId: fixture.commandId,
    requestIdMintedBy: "gui",
    requiresUserConfirmation: true,
    reasonCodes: ["explicit_user_confirmation_required", "allowlisted_verification_command_id", "checkpoint_verified"],
    ...overrides,
  };
}

export function agentRunBuiltGuiAssistantMessage(overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  return {
    id: "assistantAgentRunBuiltGuiFixture",
    chatId: fixture.chatId,
    role: "assistant",
    status: "complete",
    createdAt: "2026-06-23T12:00:01Z",
    content: JSON.stringify(fixture.safeEdit),
    ...overrides,
  };
}

export function agentRunBuiltGuiChatThread(messages = []) {
  const fixture = agentRunBuiltGuiFixture;
  return { chatId: fixture.chatId, title: "Agent Run built GUI fixture", createdAt: "2026-06-23T12:00:00Z", updatedAt: "2026-06-23T12:00:00Z", messages };
}

export function agentRunBuiltGuiSseEvents() {
  const fixture = agentRunBuiltGuiFixture;
  return [
    { seq: 0, type: "snapshot", chatId: fixture.chatId, payload: { messages: [] } },
    { seq: 1, type: "message_added", chatId: fixture.chatId, payload: { message: agentRunBuiltGuiAssistantMessage() } },
    { seq: 2, type: "stream_finished", chatId: fixture.chatId, payload: {} },
  ];
}

export function agentRunBuiltGuiApplyResult(requestId = agentRunBuiltGuiFixture.requestIds.apply, overrides = {}) {
  return {
    version: agentRunBuiltGuiFixture.bridgeVersion,
    type: "host.applyWorkspaceEditResult",
    requestId,
    payload: {
      status: "applied",
      message: "Mock host applied after explicit user confirmation.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: agentRunBuiltGuiFixture.safeEdit.edits.map((edit) => edit.workspaceRelativePath),
      ...overrides,
    },
  };
}

export function agentRunBuiltGuiVerificationProgress(requestId = agentRunBuiltGuiFixture.requestIds.verification, overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  return {
    version: fixture.bridgeVersion,
    type: "host.ideActionProgress",
    requestId,
    payload: {
      phase: "running",
      status: "inProgress",
      summary: "Allowlisted repository fixture check is running.",
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: fixture.commandId,
      ...overrides,
    },
  };
}

export function agentRunBuiltGuiVerificationResult(requestId = agentRunBuiltGuiFixture.requestIds.verification, overrides = {}) {
  const fixture = agentRunBuiltGuiFixture;
  return {
    version: fixture.bridgeVersion,
    type: "host.ideActionResult",
    requestId,
    payload: {
      status: "succeeded",
      message: "Mock verification completed.",
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: fixture.commandId,
      exitCode: 0,
      durationMs: 42,
      outputTail: fixture.verificationOutputTail,
      truncated: false,
      ...overrides,
    },
  };
}

export function assertAgentRunBuiltGuiFixtureSafe(value, label = "Agent Run built-GUI fixture evidence") {
  const text = JSON.stringify(value);
  assert(text.length < 12000, `${label} is bounded`);
  for (const marker of agentRunBuiltGuiRawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

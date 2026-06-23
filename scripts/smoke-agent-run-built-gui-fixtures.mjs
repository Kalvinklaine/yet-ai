import assert from "node:assert/strict";
import { agentRunBuiltGuiApplyResult, agentRunBuiltGuiAssistantMessage, agentRunBuiltGuiCapsResponse, agentRunBuiltGuiChatThread, agentRunBuiltGuiFixture, agentRunBuiltGuiProviderSummary, agentRunBuiltGuiReadinessMetadata, agentRunBuiltGuiSseEvents, agentRunBuiltGuiVerificationProgress, agentRunBuiltGuiVerificationResult, assertAgentRunBuiltGuiFixtureSafe } from "./lib/agent-run-built-gui-fixtures.mjs";

const fixture = agentRunBuiltGuiFixture;
const provider = agentRunBuiltGuiProviderSummary();
const caps = agentRunBuiltGuiCapsResponse();
const readiness = agentRunBuiltGuiReadinessMetadata();
const assistant = agentRunBuiltGuiAssistantMessage();
const thread = agentRunBuiltGuiChatThread([assistant]);
const events = agentRunBuiltGuiSseEvents();
const applyResult = agentRunBuiltGuiApplyResult("gui-agent-run-apply-smoke-1");
const verificationProgress = agentRunBuiltGuiVerificationProgress("gui-agent-run-verification-smoke-1");
const verificationResult = agentRunBuiltGuiVerificationResult("gui-agent-run-verification-smoke-1");

assert.equal(provider.id, fixture.providerId);
assert.equal(provider.enabled, true);
assert.equal(provider.models[0].id, fixture.modelId);
assert.equal(provider.models[0].readiness.status, "ready");
assert.equal(caps.runtime.cloudRequired, false);
assert.equal(caps.runtime.providerAccess, "direct");
assert.deepEqual(caps.providers, [provider]);
assert.equal(caps.agentRunReadiness.checkpoint.checkpointVerified, true);
assert.equal(caps.agentRunReadiness.sandbox.checkpoint.verified, true);
assert.equal(caps.agentRunReadiness.policy.allowlistedCommandId, fixture.commandId);
assert.equal(readiness.verificationCommandId, fixture.commandId);
assert.equal(readiness.proposal.touchedFiles.length, 1);
assert.equal(readiness.proposal.touchedFiles[0], "src/agentRunFixture.ts");
assert.equal(readiness.sandbox.executionAllowed, false);
assert.equal(readiness.policy.executionAllowed, false);
assert.equal(readiness.policy.requiresUserConfirmation, true);

const parsedProposal = JSON.parse(assistant.content);
assert.deepEqual(parsedProposal, fixture.safeEdit);
assert.equal(parsedProposal.requiresUserConfirmation, true);
assert.equal(parsedProposal.cloudRequired, false);
assert.equal("command" in parsedProposal, false);
assert.equal("args" in parsedProposal, false);
assert.equal("cwd" in parsedProposal, false);
assert.equal("env" in parsedProposal, false);
assert.equal(thread.chatId, fixture.chatId);
assert.equal(thread.messages.length, 1);
assert.equal(events[0].type, "snapshot");
assert.equal(events[1].type, "message_added");
assert.equal(events[2].type, "stream_finished");
assert.equal(events[1].payload.message.content, assistant.content);

assert.equal(applyResult.type, "host.applyWorkspaceEditResult");
assert.equal(applyResult.payload.status, "applied");
assert.equal(applyResult.payload.cloudRequired, false);
assert.deepEqual(applyResult.payload.affectedFiles, ["src/agentRunFixture.ts"]);
assert.equal(verificationProgress.type, "host.ideActionProgress");
assert.equal(verificationProgress.payload.action, "runVerificationCommand");
assert.equal(verificationProgress.payload.commandId, fixture.commandId);
assert.equal(verificationResult.type, "host.ideActionResult");
assert.equal(verificationResult.payload.action, "runVerificationCommand");
assert.equal(verificationResult.payload.commandId, fixture.commandId);
assert.equal(verificationResult.payload.status, "succeeded");
assert.equal(verificationResult.payload.cloudRequired, false);

assertAgentRunBuiltGuiFixtureSafe({ fixture, provider, caps, readiness, assistant, thread, events, applyResult, verificationProgress, verificationResult }, "Agent Run built-GUI fixture smoke");

console.log("Agent Run built-GUI fixture smoke passed.");
console.log("Verified reusable mock-only S48 fixture data for runtime/provider readiness, explicit context, strict safe-edit assistant response, checkpoint metadata, bridge apply/progress/result, sanitized evidence, no non-loopback provider URL, no secrets, and no private paths.");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createSandboxCheckpoint, verifySandboxCheckpoint } from "./sandbox-checkpoint-state.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const CREATED_AT = "2026-06-23T12:00:00Z";
const SOURCE = "export const readinessLabel = 'draft';\n";
const rawMarkers = [
  SOURCE.trim(),
  "updated label body",
  "raw diff",
  "raw file body",
  "PRIVATE_TEMP_PATH",
  "sk-checkpoint-readiness-secret",
  "access_token",
  "Authorization",
  "Bearer",
  "npm run check",
  "--watch",
  "\"cwd\"",
  "\"env\"",
  "/Users/",
  "C:\\Users\\",
];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-checkpoint-readiness-smoke-ts-"));
  const queue = entries.map((entry) => join(guiSrcRoot, entry));
  const seen = new Set();
  try {
    while (queue.length > 0) {
      const sourcePath = queue.shift();
      if (!sourcePath || seen.has(sourcePath)) {
        continue;
      }
      seen.add(sourcePath);
      const source = await readFile(sourcePath, "utf8");
      for (const dependency of localValueDependencies(source, sourcePath)) {
        if (!seen.has(dependency)) {
          queue.push(dependency);
        }
      }
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        },
      }).outputText;
      const rewritten = transpiled.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.mjs$3");
      const outPath = join(outRoot, relative(guiSrcRoot, sourcePath)).replace(/\.ts$/, ".mjs");
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, rewritten);
    }
    const imports = Object.fromEntries(await Promise.all(entries.map(async (entry) => {
      const modulePath = join(outRoot, entry).replace(/\.ts$/, ".mjs");
      return [entry, await import(pathToFileURL(modulePath).href)];
    })));
    return { imports, cleanup: () => rm(outRoot, { recursive: true, force: true }) };
  } catch (error) {
    await rm(outRoot, { recursive: true, force: true });
    throw error;
  }
}

function localValueDependencies(source, sourcePath) {
  const dependencies = [];
  const importPattern = /(?:import|export)\s+(?!type\b)(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    const candidate = resolve(dirname(sourcePath), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
    if (candidate.startsWith(guiSrcRoot)) {
      dependencies.push(candidate);
    }
  }
  return dependencies;
}

async function disposableWorkspace(root) {
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(join(workspaceRoot, ".yet-ai-disposable-workspace.json"), `${JSON.stringify({ workspaceLabel: "checkpoint readiness smoke" })}\n`);
  await writeFile(join(workspaceRoot, "src", "readiness.ts"), SOURCE);
  return workspaceRoot;
}

function explicitContextItem() {
  return {
    kind: "active_editor",
    source: "vscode",
    file: { displayPath: "src/readiness.ts", workspaceRelativePath: "src/readiness.ts", languageId: "typescript" },
    selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 39, text: "export const readinessLabel = 'draft';" },
    key: "context-checkpoint-readiness",
  };
}

function safeEditProposal() {
  return {
    requiresUserConfirmation: true,
    summary: "Update the readiness label after manual review.",
    cloudRequired: false,
    edits: [{
      workspaceRelativePath: "src/readiness.ts",
      textReplacements: [{ range: { start: { line: 1, character: 31 }, end: { line: 1, character: 36 } }, replacementText: "ready" }],
    }],
  };
}

function hashText(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function sandboxMetadata(verified) {
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
      confirmedAt: CREATED_AT,
      disposableWorkspaceAcknowledged: true,
      requestIdMintedBy: "gui",
      optInLabel: "Manual checkpoint readiness review",
    },
    limits: { maxSteps: 4, maxTouchedFiles: 4, maxPatchBytes: 4096, maxRuntimeSeconds: 120, workspaceRelativePaths: ["src/readiness.ts"] },
    checkpoint: {
      status: "verified",
      checkpointId: verified.summary.id,
      createdAt: CREATED_AT,
      verified: true,
      fileCount: verified.summary.fileCount,
      contentHash: hashText(verified.summary.manifestHash),
      label: "Verified disposable checkpoint",
    },
    rollback: {
      status: "planned",
      planId: "rollbackCheckpointReadiness",
      planHash: hashText("rollbackCheckpointReadiness"),
      affectedFileCount: verified.summary.fileCount,
      requiresUserConfirmation: true,
      label: "Manual rollback metadata",
    },
    summary: "Verified checkpoint metadata is available for explicit user apply review.",
  };
}

function policyMetadata() {
  return {
    kind: "tool_authority_policy",
    version: "2026-06-21",
    mode: "sandbox_preview",
    defaultDecision: "deny",
    cloudRequired: false,
    summary: "Allowlisted verification is metadata-only until the user confirms the next step.",
    capability: "allowlisted_verification",
    source: { origin: "gui", requestIdMintedBy: "gui", hostSurface: "browser" },
    risk: ["metadata_only"],
    requirements: ["explicit_user_confirmation", "trusted_request_id", "schema_validation", "checkpoint_required", "allowlisted_command_id"],
    decision: "allow_with_confirmation",
    workspaceBounds: ["src/readiness.ts"],
    allowlistedCommandId: "repository-check",
    traceLabel: "Checkpoint readiness smoke",
  };
}

function createMockHarness() {
  return {
    providerCalls: 0,
    ideLaunches: 0,
    shellRuns: 0,
    gitRuns: 0,
    toolRuns: 0,
    networkRequests: 0,
    hiddenWorkspaceScans: 0,
    storageWrites: 0,
    applyCalls: 0,
    verificationCalls: 0,
  };
}

function assertHarnessSafe(harness) {
  assert.deepEqual(harness, createMockHarness());
}

function assertNoAutonomy(view, label) {
  assert.equal(view.canAutoSend, false, `${label} auto send`);
  assert.equal(view.canAutoApply, false, `${label} auto apply`);
  assert.equal(view.canAutoRunVerification, false, `${label} auto verification`);
  assert.equal(view.canAutoRollback, false, `${label} auto rollback`);
  assert.equal(view.canStartAutonomousLoop, false, `${label} autonomous loop`);
}

function assertSanitized(value, label, tempRoot) {
  const text = JSON.stringify(value);
  assert.equal(text.length < 9000, true, `${label} is bounded`);
  for (const marker of [...rawMarkers, tempRoot, tmpdir(), homedir()]) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function diagnosticsText(result) {
  return result.diagnostics.map((item) => item.message).join("\n");
}

async function runSmoke() {
  const tmp = await mkdtemp(join(tmpdir(), "yet-agent-run-checkpoint-readiness-smoke-"));
  const { imports, cleanup } = await transpileGuiServices([
    "services/modelProposalPrompt.ts",
    "services/agentRunModelProposal.ts",
    "services/agentRunReadiness.ts",
    "services/agentRunState.ts",
  ]);
  try {
    const workspaceRoot = await disposableWorkspace(tmp);
    const checkpointRoot = join(tmp, "checkpoints");
    const { manifest } = await createSandboxCheckpoint({
      workspaceRoot,
      checkpointRoot,
      checkpointId: "checkpointReadinessSmoke",
      createdAt: CREATED_AT,
      files: ["src/readiness.ts"],
      limits: { maxFiles: 4, maxFileBytes: 1024, maxTotalBytes: 2048 },
    });
    const verified = await verifySandboxCheckpoint({ workspaceRoot, checkpointRoot, manifest });
    const { buildOneStepModelProposalPrompt } = imports["services/modelProposalPrompt.ts"];
    const { evaluateAgentRunModelProposal } = imports["services/agentRunModelProposal.ts"];
    const { composeAgentRunReadiness } = imports["services/agentRunReadiness.ts"];
    const { evaluateAgentRunState } = imports["services/agentRunState.ts"];
    const harness = createMockHarness();

    const prompt = buildOneStepModelProposalPrompt({
      goal: "Update the visible readiness label using only selected context.",
      contextItems: [explicitContextItem()],
      providerReadiness: "Local BYOK provider readiness is confirmed by the user.",
      mode: "safe_edit",
    });
    assert.equal(prompt.prompt.includes("Use only attached explicit context"), true);
    assert.equal(prompt.prompt.includes("Do not run tools, shell, git"), true);
    assert.equal(prompt.prompt.includes("strict safe-edit proposal"), true);
    assertSanitized(prompt, "drafted prompt", tmp);

    const correlation = {
      chatId: "chatCheckpointReadiness",
      goal: "Update the visible readiness label using only selected context.",
      submittedPromptRequestId: "requestCheckpointReadiness1",
      latestUserMessageId: "userCheckpointReadiness1",
      runtimeSettingsVersion: "runtimeCheckpointReadiness1",
    };
    const proposalResult = evaluateAgentRunModelProposal({
      ...correlation,
      latestAssistantMessage: {
        id: "assistantCheckpointReadiness1",
        chatId: correlation.chatId,
        role: "assistant",
        status: "complete",
        responseToRequestId: correlation.submittedPromptRequestId,
        userMessageId: correlation.latestUserMessageId,
        runtimeSettingsVersion: correlation.runtimeSettingsVersion,
        content: JSON.stringify(safeEditProposal()),
      },
    });
    assert.equal(proposalResult.proposalPathState, "proposal_detected");
    assert.equal(proposalResult.diagnostics.length, 0);

    const proposal = {
      ...proposalResult.agentRunInput.proposal,
      source: "assistant_proposal",
      editCount: 1,
      patchBytes: 128,
      contentHash: hashText("checkpoint-readiness-proposal"),
    };

    const ready = composeAgentRunReadiness({
      loopId: "loopCheckpointReadiness",
      goal: proposalResult.agentRunInput.goal,
      proposal,
      checkpoint: {
        checkpointId: verified.summary.id,
        checkpointVerified: true,
        checkpointHash: hashText(verified.summary.manifestHash),
        checkedAt: CREATED_AT,
        label: "Verified checkpoint",
      },
      sandbox: sandboxMetadata(verified),
      policy: policyMetadata(),
      verificationCommandId: "repository-check",
    });
    assert.equal(ready.state, "ready");
    assert.equal(ready.diagnostics.length, 0);
    assert.equal(ready.boundedLoop.status, "ready_for_apply");
    assert.equal(ready.boundedLoop.sandbox.checkpointVerified, true);
    assert.equal(ready.boundedLoop.policy.decision, "ready_for_user_apply");
    assert.equal(ready.boundedLoop.executionAllowed, false);
    assert.equal(ready.boundedLoop.verification.commandId, "repository-check");
    assert.equal(ready.boundedLoop.verification.status, "not_requested");

    const readyView = evaluateAgentRunState(ready.agentRunInput);
    assert.equal(readyView.state, "ready_for_apply");
    assert.equal(readyView.nextUserAction, "confirm_apply");
    assertNoAutonomy(readyView, "ready checkpoint");
    assert.equal(harness.applyCalls, 0);
    assert.equal(harness.verificationCalls, 0);
    assertSanitized({ ready, readyView }, "ready report", tmp);

    const missingCheckpoint = composeAgentRunReadiness({
      loopId: "loopCheckpointMissing",
      goal: proposalResult.agentRunInput.goal,
      proposal,
      sandbox: { ...sandboxMetadata(verified), modeStatus: "opted_in", checkpoint: { ...sandboxMetadata(verified).checkpoint, status: "missing", verified: false } },
      policy: policyMetadata(),
      verificationCommandId: "repository-check",
    });
    assert.equal(missingCheckpoint.state, "blocked");
    assert.equal(missingCheckpoint.boundedLoop, undefined);
    assert.equal(diagnosticsText(missingCheckpoint).includes("checkpoint"), true);
    const missingView = evaluateAgentRunState(missingCheckpoint.agentRunInput);
    assert.equal(missingView.state, "prerequisites_blocked");
    assert.equal(missingView.nextUserAction, "review_prerequisites");
    assertNoAutonomy(missingView, "missing checkpoint");
    assertSanitized({ missingCheckpoint, missingView }, "missing checkpoint report", tmp);

    const unverifiedCheckpoint = composeAgentRunReadiness({
      loopId: "loopCheckpointUnverified",
      goal: proposalResult.agentRunInput.goal,
      proposal,
      checkpoint: {
        checkpointId: "checkpointReadinessSmoke",
        checkpointVerified: false,
        checkpointHash: hashText(verified.summary.manifestHash),
      },
      sandbox: { ...sandboxMetadata(verified), checkpoint: { ...sandboxMetadata(verified).checkpoint, status: "pending", verified: false } },
      policy: policyMetadata(),
      verificationCommandId: "repository-check",
    });
    assert.equal(unverifiedCheckpoint.state, "blocked");
    assert.equal(unverifiedCheckpoint.boundedLoop, undefined);
    assert.equal(diagnosticsText(unverifiedCheckpoint).includes("verified checkpoint"), true);
    const unverifiedView = evaluateAgentRunState(unverifiedCheckpoint.agentRunInput);
    assert.equal(unverifiedView.state, "prerequisites_blocked");
    assertNoAutonomy(unverifiedView, "unverified checkpoint");
    assertSanitized({ unverifiedCheckpoint, unverifiedView }, "unverified checkpoint report", tmp);

    assertHarnessSafe(harness);
  } finally {
    await cleanup();
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Agent Run checkpoint readiness smoke passed.");
}

export { runSmoke };

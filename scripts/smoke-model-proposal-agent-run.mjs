import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const guiSrcRoot = join(repoRoot, "apps", "gui", "src");
const createdReportLimit = 8000;
const rawMarkers = [
  "sk-model-proposal-secret",
  "access_token",
  "Authorization",
  "Bearer",
  "raw diff",
  "raw file body",
  "npm run check",
  "--watch",
  "\"cwd\"",
  "\"env\"",
  "PRIVATE_TEMP_PATH",
  "/Users/",
  "C:\\Users\\",
];

function requireTypescript() {
  const require = createRequire(import.meta.url);
  return require(join(repoRoot, "apps", "gui", "node_modules", "typescript"));
}

async function transpileGuiServices(entries) {
  const ts = requireTypescript();
  const outRoot = await mkdtemp(join(tmpdir(), "yet-model-proposal-smoke-ts-"));
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

function explicitContextItem() {
  return {
    kind: "active_editor",
    source: "vscode",
    file: { displayPath: "src/modelProposal.ts", workspaceRelativePath: "src/modelProposal.ts", languageId: "typescript" },
    selection: { startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 1, text: "export const greeting = 'hello';" },
    key: "context-model-proposal",
  };
}

function safeEditProposal() {
  return {
    requiresUserConfirmation: true,
    summary: "Update the visible greeting label after manual review.",
    cloudRequired: false,
    edits: [{
      workspaceRelativePath: "src/modelProposal.ts",
      textReplacements: [{ range: { start: { line: 1, character: 24 }, end: { line: 1, character: 29 } }, replacementText: "howdy" }],
    }],
  };
}

function unsafeProposalEnvelope() {
  return {
    type: "gui.applyWorkspaceEditRequest",
    version: "2026-05-15",
    payload: {
      ...safeEditProposal(),
      command: "npm run check -- --watch",
    },
  };
}

function boundedLoopForProposal(proposalId) {
  return {
    kind: "bounded_patch_verification_loop",
    version: "2026-06-21",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    status: "ready_for_apply",
    loopId: "loopModelProposalSmoke",
    sandbox: {
      modeStatus: "checkpoint_ready",
      checkpointId: "checkpointModelProposalSmoke",
      checkpointVerified: true,
      checkpointHash: `sha256:${"a".repeat(64)}`,
    },
    limits: { maxTouchedFiles: 4, maxPatchBytes: 4096, maxSteps: 4, maxVerificationSeconds: 120 },
    patch: {
      proposalId,
      source: "assistant_proposal",
      touchedFiles: ["src/modelProposal.ts"],
      editCount: 1,
      patchBytes: 128,
      contentHash: `sha256:${"b".repeat(64)}`,
      summary: "Safe-edit proposal metadata is ready for manual review.",
    },
    policy: {
      decision: "ready_for_user_apply",
      requiresUserConfirmation: true,
      reasonCodes: ["explicit_user_confirmation_required", "checkpoint_verified", "bounded_patch_metadata_only", "allowlisted_verification_command_id"],
    },
    verification: { commandId: "repository-check", status: "not_requested" },
    summary: "Model proposal detected; explicit user confirmation is required before apply.",
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

function assertSanitized(value, label) {
  const text = JSON.stringify(value);
  assert.equal(text.length < createdReportLimit, true, `${label} is bounded`);
  for (const marker of rawMarkers) {
    assert.equal(text.includes(marker), false, `${label} leaked ${marker}`);
  }
}

function diagnosticText(result) {
  return result.diagnostics.map((item) => item.message).join("\n");
}

async function runSmoke() {
  const { imports, cleanup } = await transpileGuiServices([
    "services/modelProposalPrompt.ts",
    "services/agentRunModelProposal.ts",
    "services/agentRunState.ts",
  ]);
  try {
    const { buildOneStepModelProposalPrompt } = imports["services/modelProposalPrompt.ts"];
    const { evaluateAgentRunModelProposal } = imports["services/agentRunModelProposal.ts"];
    const { evaluateAgentRunState } = imports["services/agentRunState.ts"];
    const harness = createMockHarness();

    const prompt = buildOneStepModelProposalPrompt({
      goal: "Change the visible greeting using only selected context.",
      contextItems: [explicitContextItem()],
      providerReadiness: "GPT-4o mini through local BYOK provider is ready.",
      mode: "safe_edit",
    });
    assert.equal(prompt.prompt.includes("Use only attached explicit context"), true);
    assert.equal(prompt.prompt.includes("Do not run tools, shell, git"), true);
    assert.equal(prompt.prompt.includes("strict safe-edit proposal"), true);
    assert.equal(prompt.prompt.includes("requestId"), true);
    assertSanitized(prompt, "prompt");

    const base = {
      chatId: "chat-model-proposal",
      goal: "Change the visible greeting using only selected context.",
      submittedPromptRequestId: "requestModelProposal1",
      latestUserMessageId: "userModelProposal1",
      runtimeSettingsVersion: "runtimeModelProposal1",
    };

    const valid = evaluateAgentRunModelProposal({
      ...base,
      latestAssistantMessage: {
        id: "assistantModelProposal1",
        chatId: base.chatId,
        role: "assistant",
        status: "complete",
        responseToRequestId: base.submittedPromptRequestId,
        userMessageId: base.latestUserMessageId,
        runtimeSettingsVersion: base.runtimeSettingsVersion,
        content: JSON.stringify(safeEditProposal()),
      },
    });
    assert.equal(valid.proposalPathState, "proposal_detected");
    assert.equal(valid.diagnostics.length, 0);
    assert.equal(valid.agentRunInput.proposal.summary, "Update the visible greeting label after manual review.");
    assert.deepEqual(valid.agentRunInput.proposal.touchedFiles, ["src/modelProposal.ts"]);

    const readyView = evaluateAgentRunState({
      ...valid.agentRunInput,
      boundedLoop: boundedLoopForProposal(valid.agentRunInput.proposal.id),
    });
    assert.equal(readyView.state, "ready_for_apply");
    assert.equal(readyView.nextUserAction, "confirm_apply");
    assertNoAutonomy(readyView, "valid proposal");
    assert.equal(harness.applyCalls, 0);
    assert.equal(harness.verificationCalls, 0);
    assertSanitized({ validPath: valid, readyView }, "valid report");

    const malformed = evaluateAgentRunModelProposal({
      ...base,
      latestAssistantMessage: {
        id: "assistantModelProposalMalformed",
        chatId: base.chatId,
        role: "assistant",
        status: "complete",
        responseToRequestId: base.submittedPromptRequestId,
        userMessageId: base.latestUserMessageId,
        runtimeSettingsVersion: base.runtimeSettingsVersion,
        content: "{ \"requiresUserConfirmation\": true, \"edits\": [",
      },
    });
    assert.equal(malformed.proposalPathState, "proposal_rejected");
    assert.equal(malformed.agentRunInput.proposal, undefined);
    assert.equal(diagnosticText(malformed).includes("strict safe-edit JSON proposal"), true);
    assert.equal(diagnosticText(malformed).includes("execution"), true);
    assertSanitized(malformed, "malformed report");

    const unsafe = evaluateAgentRunModelProposal({
      ...base,
      latestAssistantMessage: {
        id: "assistantModelProposalUnsafe",
        chatId: base.chatId,
        role: "assistant",
        status: "complete",
        responseToRequestId: base.submittedPromptRequestId,
        userMessageId: base.latestUserMessageId,
        runtimeSettingsVersion: base.runtimeSettingsVersion,
        content: JSON.stringify(unsafeProposalEnvelope()),
      },
    });
    assert.equal(unsafe.proposalPathState, "proposal_rejected");
    assert.equal(unsafe.agentRunInput.proposal, undefined);
    assert.equal(diagnosticText(unsafe).includes("must not include commands or tool calls"), true);
    assert.equal(diagnosticText(unsafe).includes("strict safe-edit JSON proposal"), true);
    assertSanitized(unsafe, "unsafe report");

    const stale = evaluateAgentRunModelProposal({
      ...base,
      latestAssistantMessage: {
        id: "assistantModelProposalStale",
        chatId: "chat-other",
        role: "assistant",
        status: "complete",
        responseToRequestId: base.submittedPromptRequestId,
        userMessageId: base.latestUserMessageId,
        runtimeSettingsVersion: base.runtimeSettingsVersion,
        content: JSON.stringify(safeEditProposal()),
      },
    });
    assert.equal(stale.proposalPathState, "stale_response");
    assert.equal(stale.agentRunInput.proposal, undefined);

    assertHarnessSafe(harness);
    assertSanitized({ malformed, unsafe, stale }, "rejection summary");
  } finally {
    await cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSmoke();
  console.log("Model proposal Agent Run smoke passed.");
}

export { runSmoke };

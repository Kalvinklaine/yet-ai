import { describe, expect, it } from "vitest";
import plannedBundle from "../../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-planned.json";
import succeededBundle from "../../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-succeeded.json";
import { buildControlledAgentVerificationBundleRequest, type ControlledAgentVerificationBundleRequestCorrelation } from "./controlledAgentVerificationBundle";
import { buildControlledAgentVerificationFollowup } from "./controlledAgentVerificationFollowup";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

function readyCorrelation(): ControlledAgentVerificationBundleRequestCorrelation {
  const result = buildControlledAgentVerificationBundleRequest({
    host: "vscode",
    bundleMetadata: plannedBundle,
    userConfirmed: true,
    requestSeed: "followup-unit",
  });
  expect(result.state).toBe("ready");
  expect(result.correlation).toBeDefined();
  return result.correlation as ControlledAgentVerificationBundleRequestCorrelation;
}

function matchingSucceededBundle() {
  const correlation = readyCorrelation();
  const bundle = clone(succeededBundle) as Record<string, any>;
  bundle.workspace.controlledWorkspaceId = correlation.controlledWorkspaceId;
  bundle.workspace.runId = correlation.runId;
  bundle.workspace.workspaceReadinessId = correlation.workspaceReadinessId;
  bundle.bundle.bundleId = correlation.bundleId;
  bundle.bundle.requestedCommandCount = 3;
  bundle.bundle.commands.push({
    stepId: "step-s117-engine",
    sequenceIndex: 2,
    commandId: "engine-chat-tests",
    timeoutMs: 300000,
    maxOutputBytes: 8000,
    maxOutputLines: 160,
    tailOnly: true,
    commandStringAllowed: false,
    argsAllowed: false,
    cwdAllowed: false,
    envAllowed: false,
    shellAllowed: false,
    status: "failed",
    exitCode: 1,
    durationMs: 1000,
    outputTail: "Engine chat tests reported a bounded sanitized failure category.",
    outputByteCount: 72,
    outputLineCount: 1,
    truncated: true,
    resultHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    summary: "Engine chat tests failed with local deterministic evidence.",
  });
  bundle.aggregateResult.status = "failed";
  bundle.aggregateResult.commandCount = 3;
  bundle.aggregateResult.succeededCount = 2;
  bundle.aggregateResult.failedCount = 1;
  bundle.aggregateResult.resultHash = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
  bundle.aggregateResult.summary = "One user approved check reported a bounded failure category.";
  return { correlation, bundle };
}

function codes(result: ReturnType<typeof buildControlledAgentVerificationFollowup>) {
  return result.diagnostics.map((item) => item.code);
}

describe("controlledAgentVerificationFollowup", () => {
  it("builds safe bounded follow-up draft metadata from correlated bundle summaries", () => {
    const { correlation, bundle } = matchingSucceededBundle();
    const result = buildControlledAgentVerificationFollowup({ current: correlation, bundleResult: bundle, userSelectedNextAction: "draft_manual_fix_prompt" });

    expect(result.state).toBe("ready");
    expect(result.draft).toMatchObject({
      kind: "controlled_agent_verification_followup",
      version: "2026-07-08",
      authority: "verification_followup_metadata",
      cloudRequired: false,
      executionAllowed: false,
      automaticProviderSendAllowed: false,
      automaticRepairAllowed: false,
      autoApplyAllowed: false,
      hiddenContextGatheringAllowed: false,
      userSelectedNextAction: "draft_manual_fix_prompt",
      sourceBundle: {
        kind: "controlled_agent_verification_bundle",
        bundleId: correlation.bundleId,
        aggregateStatus: "failed",
        commandCount: 3,
        failedCount: 1,
      },
      followupProposal: {
        intent: "fix",
        title: "Draft manual fix prompt",
        draftOnly: true,
        requiresUserSend: true,
      },
      contextPolicy: {
        allowedSources: ["sanitized_verification_summary_metadata", "user_selected_next_action"],
        forbidRawStdoutStderr: true,
        forbidCommandStrings: true,
        forbidCwdEnv: true,
        forbidPrivatePathsAndSecrets: true,
        forbidProviderToolCalls: true,
        forbidHiddenContextGathering: true,
      },
      manualActionPolicy: {
        requiresExplicitUserNextAction: true,
        requiresExplicitUserSendClick: true,
        noAutomaticProviderSend: true,
        noAutomaticRepair: true,
        noAutoApply: true,
        noAutoVerification: true,
        noWorkspaceMutation: true,
        noExecutionAuthority: true,
        noProductionAutonomyClaim: true,
      },
    });
    expect(result.draft?.verificationSummaries.map((item) => item.commandId)).toEqual(["repository-check", "gui-app-tests", "engine-chat-tests"]);
    expect(result.authority).toMatchObject({ canCallProvider: false, canRunRepair: false, canApplyEdits: false, canRunVerification: false, canReadFiles: false, canUseTools: false, draftOnly: true, requiresUserSend: true });
    expect(output(result)).not.toContain("commandString");
  });

  it("fails closed for unsafe raw output and does not echo raw values", () => {
    const { correlation, bundle } = matchingSucceededBundle();
    bundle.rawStdout = "SECRET_SENTINEL stdout /Users/alice/project Authorization: Bearer unsafe";
    bundle.bundle.commands[0].stdout = "SECRET_SENTINEL raw stdout";
    bundle.bundle.commands[0].outputTail = "Authorization: Bearer unsafe";

    const result = buildControlledAgentVerificationFollowup({ current: correlation, bundleResult: bundle, userSelectedNextAction: "suggest_manual_next_step" });
    const rendered = output(result);

    expect(result.state).toBe("blocked");
    expect(codes(result)).toContain("unsafe_metadata");
    expect(rendered).not.toContain("SECRET_SENTINEL");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("Bearer unsafe");
    expect(result.draft).toBeUndefined();
  });

  it("fails closed for stale verification lineage", () => {
    const { correlation, bundle } = matchingSucceededBundle();
    bundle.workspace.runId = "other-run";

    const result = buildControlledAgentVerificationFollowup({ current: correlation, bundleResult: bundle, userSelectedNextAction: "explain_result" });

    expect(result.state).toBe("blocked");
    expect(codes(result)).toContain("stale_lineage");
    expect(result.draft).toBeUndefined();
  });

  it("blocks auto-repair and provider-send overclaims without authority widening", () => {
    const { correlation, bundle } = matchingSucceededBundle();
    const result = buildControlledAgentVerificationFollowup({
      current: correlation,
      bundleResult: bundle,
      userSelectedNextAction: "draft_manual_fix_prompt",
      automaticProviderSendAllowed: true,
      automaticRepairAllowed: true,
      autoApplyAllowed: true,
      productionClaimAllowed: true,
    });

    expect(result.state).toBe("blocked");
    expect(codes(result)).toEqual(expect.arrayContaining(["unsafe_metadata", "invalid_authority"]));
    expect(result.authority).toMatchObject({ automaticProviderSendAllowed: false, automaticRepairAllowed: false, autoApplyAllowed: false, executionAllowed: false, canCallProvider: false, canRunRepair: false });
    expect(result.draft).toBeUndefined();
  });

  it("does not leak raw command, cwd, env, private path, provider payload, diff, or replacement text", () => {
    const { correlation, bundle } = matchingSucceededBundle();
    const secret = "sk-proj-unsafe1234567890";
    bundle.bundle.commands[1].summary = `Run npm test from cwd /Users/alice/project with env TOKEN=${secret}`;
    bundle.providerPayload = { prompt: "provider payload", rawDiff: "diff --git SECRET_DIFF", replacement: "SECRET_REPLACEMENT" };

    const result = buildControlledAgentVerificationFollowup({ current: correlation, bundleResult: bundle, userSelectedNextAction: "suggest_manual_next_step" });
    const rendered = output(result);

    expect(result.state).toBe("blocked");
    expect(codes(result)).toContain("unsafe_metadata");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("cwd");
    expect(rendered).not.toContain("TOKEN");
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("provider payload");
    expect(rendered).not.toContain("SECRET_DIFF");
    expect(rendered).not.toContain("SECRET_REPLACEMENT");
  });
});

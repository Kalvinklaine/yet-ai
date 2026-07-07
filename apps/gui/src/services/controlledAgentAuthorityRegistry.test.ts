import { describe, expect, it } from "vitest";
import authorityRegistry from "../../../../packages/contracts/examples/engine/controlled-agent-authority-registry-v1.json";
import { evaluateControlledAgentAuthorityRegistry } from "./controlledAgentAuthorityRegistry";

function cloneRegistry(overrides: Record<string, unknown> = {}): Record<string, any> {
  return { ...(JSON.parse(JSON.stringify(authorityRegistry)) as Record<string, any>), ...overrides };
}

describe("evaluateControlledAgentAuthorityRegistry", () => {
  it("summarizes the safe S109 registry as metadata only without granting authority", () => {
    const result = evaluateControlledAgentAuthorityRegistry(cloneRegistry());

    expect(result.decision).toBe("metadata_only");
    expect(result.allowedToExecute).toBe(false);
    expect(result.canReadFiles).toBe(false);
    expect(result.canSearchWorkspace).toBe(false);
    expect(result.canApplyEdits).toBe(false);
    expect(result.canRunVerification).toBe(false);
    expect(result.canCallProviderTools).toBe(false);
    expect(result.canUseLocalTools).toBe(false);
    expect(result.canRunShell).toBe(false);
    expect(result.canUseGit).toBe(false);
    expect(result.canUseNetwork).toBe(false);
    expect(result.canPublishRelease).toBe(false);
    expect(result.hosts.browser.trustedExecution).toBe(false);
    expect(result.hosts.browser.supportState).toBe("unsupported_for_trusted_execution");
    expect(result.hosts.vscode.supportState).toBe("first_execution_host");
    expect(result.hosts.vscode.trustedExecution).toBe(false);
    expect(result.hosts.jetbrains.trustedExecution).toBe(false);
    expect(result.categories.fileRead.decision).toBe("metadata_only");
    expect(result.categories.lexicalSearch.host).toBe("vscode");
    expect(result.categories.unsupportedOperations.decision).toBe("fail_closed");
    expect(result.diagnostics).toEqual([]);
  });

  it("fails closed on malformed input", () => {
    const result = evaluateControlledAgentAuthorityRegistry(undefined);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toContain("malformed_registry");
    expect(result.categories.fileRead.decision).toBe("fail_closed");
  });

  it("fails closed and redacts raw secret and private path text", () => {
    const input = cloneRegistry({ summary: "Read /Users/alice/.codex/auth.json with sk-secret123456789" });
    input.rawProviderPayload = "Authorization: Bearer very-secret-token";

    const result = evaluateControlledAgentAuthorityRegistry(input);
    const rendered = JSON.stringify(result);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unsafe_text", "unknown_or_invalid_field"]));
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-secret");
    expect(rendered).not.toContain("very-secret-token");
  });

  it("fails closed on unsupported host execution overclaim", () => {
    const input = cloneRegistry();
    input.hosts.browser.trustedExecution = true;
    input.hosts.jetbrains.canClaimExecution = true;

    const result = evaluateControlledAgentAuthorityRegistry(input);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toContain("unsupported_host_overclaim");
    expect(result.hosts.browser.trustedExecution).toBe(false);
    expect(result.hosts.jetbrains.canClaimExecution).toBe(false);
  });

  it("fails closed on hidden indexing or search authority", () => {
    const input = cloneRegistry();
    input.categories.lexicalSearch.hiddenSearchAllowed = true;
    input.categories.lexicalSearch.indexingAllowed = true;

    const result = evaluateControlledAgentAuthorityRegistry(input);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toContain("hidden_indexing_or_search");
    expect(result.canSearchWorkspace).toBe(false);
  });

  it("fails closed on arbitrary shell command cwd or env authority", () => {
    const input = cloneRegistry();
    input.categories.verificationCommandIds.freeformCommandAllowed = true;
    input.categories.verificationCommandIds.cwdAllowed = true;
    input.categories.verificationCommandIds.envAllowed = true;

    const result = evaluateControlledAgentAuthorityRegistry(input);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toContain("freeform_command_authority");
    expect(result.canRunShell).toBe(false);
    expect(result.canRunVerification).toBe(false);
  });

  it("fails closed on broad mutation authority", () => {
    const input = cloneRegistry();
    input.categories.editApply.broadMutationAllowed = true;
    input.categories.editApply.createDeleteRenameMoveAllowed = true;

    const result = evaluateControlledAgentAuthorityRegistry(input);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toContain("broad_mutation_authority");
    expect(result.canApplyEdits).toBe(false);
  });

  it("fails closed on provider or local tool authority", () => {
    const input = cloneRegistry();
    input.categories.providerProposalUse.providerToolAuthorityAllowed = true;
    input.categories.providerProposalUse.localToolAuthorityAllowed = true;

    const result = evaluateControlledAgentAuthorityRegistry(input);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toContain("provider_or_local_tool_authority");
    expect(result.canCallProviderTools).toBe(false);
    expect(result.canUseLocalTools).toBe(false);
  });

  it("fails closed on production release or marketplace claims", () => {
    const input = cloneRegistry({ productionClaimAllowed: true, marketplaceReady: true });

    const result = evaluateControlledAgentAuthorityRegistry(input);

    expect(result.decision).toBe("fail_closed");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["production_or_release_claim", "unknown_or_invalid_field"]));
    expect(result.canPublishRelease).toBe(false);
  });
});

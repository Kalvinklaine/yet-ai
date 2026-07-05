import { describe, expect, it } from "vitest";
import { evaluateControlledAgentDevPreviewStatus } from "./controlledAgentDevPreviewStatus";

function readyInput(): Record<string, unknown> {
  return {
    host: "vscode",
    workspaceReady: true,
    runtimeReady: true,
    oneStepReady: true,
    verificationReady: true,
    repairReady: true,
  };
}

describe("evaluateControlledAgentDevPreviewStatus", () => {
  it("reports VS Code ready with all bounded capabilities", () => {
    const result = evaluateControlledAgentDevPreviewStatus(readyInput());

    expect(result.state).toBe("ready");
    expect(result.host).toBe("vscode");
    expect(result.capabilities).toEqual({
      explicitStart: true,
      boundedRead: true,
      boundedEdit: true,
      allowlistedVerification: true,
      boundedRepair: true,
      sanitizedReport: true,
    });
    expect(result.summary).toBe("Controlled agent dev-preview is ready for explicit VS Code user start.");
    expect(result.limitations).toEqual(["No current dev-preview limitations were reported."]);
  });

  it("reports browser as unsupported without action capabilities", () => {
    const result = evaluateControlledAgentDevPreviewStatus({ ...readyInput(), host: "browser" });

    expect(result.state).toBe("unsupported");
    expect(result.host).toBe("browser");
    expect(result.capabilities).toEqual({
      explicitStart: false,
      boundedRead: false,
      boundedEdit: false,
      allowlistedVerification: false,
      boundedRepair: false,
      sanitizedReport: true,
    });
    expect(result.limitations).toContain("Browser preview cannot start the controlled local agent dev-preview.");
  });

  it("reports JetBrains as partial even when metadata is otherwise ready", () => {
    const result = evaluateControlledAgentDevPreviewStatus({ ...readyInput(), host: "jetbrains" });

    expect(result.state).toBe("partial");
    expect(result.host).toBe("jetbrains");
    expect(result.capabilities.explicitStart).toBe(true);
    expect(result.capabilities.boundedRepair).toBe(true);
    expect(result.summary).toBe("Controlled agent dev-preview is partially available for JetBrains metadata only.");
    expect(result.limitations).toContain("JetBrains host support is partial in this VS Code-first dev-preview.");
  });

  it("blocks missing readiness metadata", () => {
    const result = evaluateControlledAgentDevPreviewStatus({ host: "vscode" });

    expect(result.state).toBe("blocked");
    expect(result.host).toBe("vscode");
    expect(result.capabilities.explicitStart).toBe(false);
    expect(result.capabilities.sanitizedReport).toBe(true);
    expect(result.limitations).toEqual(expect.arrayContaining([
      "Workspace readiness metadata is required before controlled dev-preview actions.",
      "Runtime readiness metadata is required before controlled dev-preview actions.",
    ]));
  });

  it("blocks runtime disconnected status", () => {
    const result = evaluateControlledAgentDevPreviewStatus({ ...readyInput(), runtimeDisconnected: true });

    expect(result.state).toBe("blocked");
    expect(result.capabilities.explicitStart).toBe(false);
    expect(result.limitations).toContain("Runtime is disconnected; no automatic retry is started.");
  });

  it("reports repair-ready missing as partial", () => {
    const result = evaluateControlledAgentDevPreviewStatus({ ...readyInput(), repairReady: false });

    expect(result.state).toBe("partial");
    expect(result.capabilities.explicitStart).toBe(true);
    expect(result.capabilities.allowlistedVerification).toBe(true);
    expect(result.capabilities.boundedRepair).toBe(false);
    expect(result.limitations).toContain("One user-confirmed bounded repair attempt is not ready.");
  });

  it("does not echo raw input text", () => {
    const result = evaluateControlledAgentDevPreviewStatus({
      host: "vscode /Users/alice/private sk-proj-123456789",
      workspaceReady: false,
      runtimeReady: false,
      rawCommand: "npm test -- --watch /Users/alice/private",
    });
    const rendered = JSON.stringify(result);

    expect(result.host).toBe("unknown");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("sk-proj-123456789");
    expect(rendered).not.toContain("npm test");
  });
});

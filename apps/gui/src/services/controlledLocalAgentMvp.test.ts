import { describe, expect, it } from "vitest";
import runtimeSessionReady from "../../../../packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json";
import worktreeReadiness from "../../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import { buildControlledLocalAgentMvp } from "./controlledLocalAgentMvp";

function readyRuntimeSession(): Record<string, any> {
  return JSON.parse(JSON.stringify(runtimeSessionReady));
}

describe("buildControlledLocalAgentMvp", () => {
  it("propagates runtime session evidence as display-only metadata", () => {
    const report = buildControlledLocalAgentMvp({
      userOptIn: { source: "user", confirmed: true },
      workspaceReadiness: structuredClone(worktreeReadiness),
      runtimeSession: readyRuntimeSession(),
    });

    expect(report.runtimeSession.present).toBe(true);
    expect(report.runtimeSession.status).toBe("ready_to_start");
    expect(report.runtimeSession.displayOnly).toBe(true);
    expect(report.runtimeSession.executionAllowed).toBe(false);
    expect(report.runtimeSession.agentStartAllowed).toBe(false);
    expect(report.checklist.find((item) => item.id === "runtime_session")?.state).toBe("ready");
    expect(JSON.stringify(report)).not.toContain("Start Agent");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("shows absent runtime session as pending metadata", () => {
    const report = buildControlledLocalAgentMvp({
      userOptIn: { source: "user", confirmed: true },
      workspaceReadiness: structuredClone(worktreeReadiness),
    });

    expect(report.runtimeSession.present).toBe(false);
    expect(report.runtimeSession.status).toBe("disabled");
    expect(report.checklist.find((item) => item.id === "runtime_session")?.state).toBe("pending");
    expect(report.checklist.find((item) => item.id === "runtime_session")?.label).toBe("Runtime session metadata is unavailable.");
  });

  it("blocks unsafe runtime session metadata without leaking raw values", () => {
    const input = readyRuntimeSession();
    input.rawCommand = "npm test -- --watch /Users/alice/private access_token=" + "s".repeat(64);
    input.details.summary = "raw command access_token=" + "t".repeat(64);

    const report = buildControlledLocalAgentMvp({
      userOptIn: { source: "user", confirmed: true },
      workspaceReadiness: structuredClone(worktreeReadiness),
      runtimeSession: input,
    });
    const rendered = JSON.stringify(report);

    expect(report.runtimeSession.status).toBe("blocked");
    expect(report.runtimeSession.diagnostics).toContain("unsafe_metadata");
    expect(rendered).not.toContain("npm test");
    expect(rendered).not.toContain("/Users/alice");
    expect(rendered).not.toContain("access_token");
    expect(rendered).not.toContain("s".repeat(64));
    expect(rendered).not.toContain("t".repeat(64));
  });
});

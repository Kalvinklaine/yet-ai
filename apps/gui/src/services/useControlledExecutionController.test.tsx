// @vitest-environment jsdom
import { act, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyControlledCapabilityProvenance } from "./controlledCapabilityProvenance";
import { createProjectRuntimeSettings } from "./projectClient";
import { parseProjectId } from "./projectRouting";
import { ProjectScopeController } from "./projectScope";
import type { ChatRuntimeSettings } from "./runtimeClient";
import { useControlledExecutionController } from "./useControlledExecutionController";

const publishControlledHostProgress = vi.fn(async (..._args: unknown[]) => ({ ok: true, data: { snapshots: [] } }));
vi.mock("./runtimeClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("./runtimeClient")>(),
  publishControlledHostProgress: (...args: unknown[]) => publishControlledHostProgress(...args),
}));

let root: ReactDOM.Root | undefined;
const projectId = parseProjectId("prj_AAAAAAAAAAAAAAAAAAAAAA")!;
const liveCapabilities = {
  protocolVersion: "controlled_host_capabilities_v2" as const,
  authority: "metadata_only" as const,
  hostSurface: "vscode" as const,
  capabilities: { controlledStart: "supported", controlledRead: "supported", controlledEdit: "supported", controlledVerification: "supported", controlledRepair: "supported" } as const,
  correlationRequirements: [],
  authorityFlags: {},
  limits: { maxReadBytes: 2048, maxReadLines: 80, maxEditFiles: 3, maxEditOperations: 8, maxPatchBytes: 12000, maxVerificationOutputBytes: 12000, maxVerificationOutputLines: 240, maxRepairAttempts: 1 },
  reasonCodes: [],
  safeLabels: { host: "VS Code", support: "supported" },
};

type Controller = ReturnType<typeof useControlledExecutionController>;

type ProbeProps = { host: "browser" | "vscode" | "jetbrains"; scopeKey: string; project?: typeof projectId; onController: (controller: Controller) => void };

function Probe({ host, scopeKey, project = projectId, onController }: ProbeProps) {
  const settingsRef = useRef<ChatRuntimeSettings>(createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" }, project));
  const settingsRevisionRef = useRef(0);
  const chatIdRef = useRef<string | null>("chat-one");
  const projectScopeControllerRef = useRef(new ProjectScopeController(project));
  settingsRef.current = createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" }, project, projectScopeControllerRef.current.current());
  const controller = useControlledExecutionController({
    projectId: project,
    host,
    scopeKey,
    capabilityProvenance: classifyControlledCapabilityProvenance({ host, hostCapabilities: host === "vscode" ? liveCapabilities : undefined }),
    settingsRef,
    settingsRevisionRef,
    chatIdRef,
    projectScopeController: projectScopeControllerRef.current,
  });
  useEffect(() => onController(controller), [controller, onController]);
  return null;
}

async function render(props: ProbeProps) {
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(<Probe {...props} />);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  publishControlledHostProgress.mockClear();
});

describe("useControlledExecutionController", () => {
  it.each([
    "controlledFileReadCorrelationRef",
    "controlledEditCorrelationRef",
    "controlledCommandRunCorrelationRef",
    "controlledLexicalSearchCorrelationRef",
    "controlledMultifileApplyCorrelationRef",
    "controlledVerificationBundleCorrelationRef",
    "oneStepFileReadRequestIdRef",
    "oneStepEditRequestIdRef",
    "oneStepCommandRunRequestIdRef",
    "oneStepVerificationBundleRequestIdRef",
  ] as const)("clears %s when project, chat, settings, host, or generation scope changes", async (refName) => {
    let controller!: Controller;
    const onController = (next: Controller) => { controller = next; };
    await render({ host: "vscode", scopeKey: "project-a:chat-a:0:ready-a:vscode", onController });
    (controller[refName] as { current: unknown }).current = { requestId: "request-one" };
    await act(async () => root?.render(<Probe host="vscode" scopeKey="project-b:chat-b:1:ready-b:vscode" onController={onController} />));
    expect(controller[refName].current).toBeNull();
  });

  it.each([
    ["project", "project-b:chat-a:0:ready-a:vscode"],
    ["chat", "project-a:chat-b:0:ready-a:vscode"],
    ["settings", "project-a:chat-a:1:ready-a:vscode"],
    ["host", "project-a:chat-a:0:ready-a:jetbrains"],
    ["generation", "project-a:chat-a:0:ready-b:vscode"],
  ] as const)("clears every accepted one-step request and counter immediately when %s scope changes", async (_axis, nextScopeKey) => {
    let controller!: Controller;
    const onController = (next: Controller) => { controller = next; };
    await render({ host: "vscode", scopeKey: "project-a:chat-a:0:ready-a:vscode", onController });
    controller.oneStepFileReadRequestRef.current = { requestId: "read-one" } as never;
    controller.oneStepEditRequestRef.current = { requestId: "edit-one" } as never;
    controller.oneStepCommandRunRequestRef.current = { requestId: "command-one" } as never;
    controller.oneStepVerificationBundleRequestRef.current = { requestId: "verification-one" } as never;
    controller.oneStepLoopRunCounterRef.current = 7;

    await act(async () => root?.render(<Probe host="vscode" scopeKey={nextScopeKey} onController={onController} />));

    expect(controller.oneStepFileReadRequestRef.current).toBeNull();
    expect(controller.oneStepEditRequestRef.current).toBeNull();
    expect(controller.oneStepCommandRunRequestRef.current).toBeNull();
    expect(controller.oneStepVerificationBundleRequestRef.current).toBeNull();
    expect(controller.oneStepLoopRunCounterRef.current).toBe(0);
  });

  it.each(["browser", "jetbrains"] as const)("does not publish progress for unsupported %s host", async (host) => {
    let controller!: Controller;
    await render({ host, scopeKey: `${host}:scope`, onController: (next) => { controller = next; } });
    controller.publishControlledProgress("controlled_read", { correlationId: "request-one", kind: "read", transition: "requested", itemCount: 1 });
    await act(async () => Promise.resolve());
    expect(publishControlledHostProgress).not.toHaveBeenCalled();
  });

  it("publishes only bounded progress for project-scoped live VS Code provenance", async () => {
    let controller!: Controller;
    await render({ host: "vscode", scopeKey: "vscode:scope", onController: (next) => { controller = next; } });
    controller.publishControlledProgress("controlled_read", { correlationId: "request-one", kind: "read", transition: "requested", itemCount: 1 });
    await act(async () => Promise.resolve());
    expect(publishControlledHostProgress).toHaveBeenCalledWith(expect.objectContaining({ projectScope: expect.objectContaining({ projectId }) }), {
      correlationId: "request-one",
      kind: "read",
      transition: "requested",
      itemCount: 1,
    });
  });
});

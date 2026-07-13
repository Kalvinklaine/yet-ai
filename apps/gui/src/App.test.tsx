// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, completedApplyRequestChatsLimit, completedIdeActionRequestChatsLimit, generateApplyRequestSessionNonce, rememberCompletedApplyRequest, rememberCompletedIdeActionRequest } from "./App";
import { buildVerificationFollowupPrompt } from "./services/verificationFollowupPrompt";
import { validateWorkspaceSnippetQuery } from "./services/activeEditorContext";
import type { ProviderAuthResponse, ProviderAuthStatus } from "./services/providerAuthClient";
import { GUI_BRIDGE_VERSION } from "./bridge/bridgeAdapter";
import worktreeReadiness from "../../../packages/contracts/examples/engine/controlled-agent-workspace-readiness-worktree.json";
import fileReadSuccess from "../../../packages/contracts/examples/engine/controlled-agent-file-read-success.json";
import fileReadBlocked from "../../../packages/contracts/examples/engine/controlled-agent-file-read-blocked.json";
import hostFileReadSuccess from "../../../packages/contracts/examples/bridge/host-controlled-agent-file-read-result-success.json";
import commandRunSucceeded from "../../../packages/contracts/examples/engine/controlled-agent-command-runner-succeeded.json";
import commandRunBlocked from "../../../packages/contracts/examples/engine/controlled-agent-command-runner-blocked.json";
import runtimeSessionReady from "../../../packages/contracts/examples/engine/controlled-agent-runtime-session-ready-vscode-worktree.json";
import editExecutorPlanned from "../../../packages/contracts/examples/engine/controlled-agent-edit-executor-planned.json";
import controlledPatchPlan from "../../../packages/contracts/examples/engine/controlled-agent-patch-plan.json";
import hostEditApplied from "../../../packages/contracts/examples/bridge/host-controlled-agent-edit-result-applied.json";
import hostLexicalSearchSucceeded from "../../../packages/contracts/examples/bridge/host-controlled-agent-lexical-search-result-succeeded.json";
import plannedVerificationBundle from "../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-planned.json";
import succeededVerificationBundle from "../../../packages/contracts/examples/engine/controlled-agent-verification-bundle-succeeded.json";
import taskHarnessHappyFixture from "../../../packages/contracts/examples/engine/controlled-agent-task-harness-vscode-happy-path.json";
import taskHarnessJetBrainsFixture from "../../../packages/contracts/examples/engine/controlled-agent-task-harness-jetbrains-partial.json";
import workflowTranscriptCompletedFixture from "../../../packages/contracts/examples/engine/controlled-agent-workflow-transcript-completed.json";
import workflowTranscriptBlockedFixture from "../../../packages/contracts/examples/engine/controlled-agent-workflow-transcript-blocked.json";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bridgeVersion = GUI_BRIDGE_VERSION;
const fetchMock = vi.fn();

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  delete window.acquireVsCodeApi;
  delete window.postIntellijMessage;
  delete window.__yetAiInitialRuntimeConfig;
  if (appParentDescriptor) Object.defineProperty(window, "parent", appParentDescriptor);
  if (appReferrerDescriptor) Object.defineProperty(Document.prototype, "referrer", appReferrerDescriptor);
  vi.restoreAllMocks();
});

const appParentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
const appReferrerDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "referrer");

describe("codingTaskPrompt builder", () => {
  it("validates workspace snippet queries as literal explicit-search input", () => {
    expect(validateWorkspaceSnippetQuery("chat composer")).toEqual({ query: "chat composer", valid: true, message: "Literal query ready. Click Search project snippets to read bounded IDE-provided snippets." });
    expect(validateWorkspaceSnippetQuery("   ").message).toBe("Enter a literal project snippet query before searching.");
    expect(validateWorkspaceSnippetQuery("../secret").message).toContain("literal text only");
    expect(validateWorkspaceSnippetQuery("chat.*composer").message).toContain("literal text only");
    expect(validateWorkspaceSnippetQuery("shell env").message).toContain("tool, path, provider, regex, and glob queries are not allowed");
    expect(validateWorkspaceSnippetQuery("raw output").message).toBe("Remove secret-like text from the snippet query before searching.");
    expect(validateWorkspaceSnippetQuery("access_token=" + "x".repeat(64)).message).toBe("Remove secret-like text from the snippet query before searching.");
  });

  it("builds sanitized bounded verification follow-up and fix prompts", () => {
    const rawSecret = "access_token=" + "x".repeat(64);
    const prompt = buildVerificationFollowupPrompt({
      status: "failed",
      message: "Tests failed.",
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: "gui-app-tests",
      exitCode: 1,
      durationMs: 25,
      outputTail: `failed /Users/alice/private/repo ${rawSecret}\n${"safe output line ".repeat(120)}`,
      truncated: true,
    }, "fix");

    expect(prompt).toContain("Verification fix prompt");
    expect(prompt).toContain("Command id: gui-app-tests");
    expect(prompt).toContain("Status: failed");
    expect(prompt).toContain("Exit code: 1");
    expect(prompt).toContain("Output truncated: yes");
    expect(prompt).toContain("Raw command output is intentionally omitted from this fix draft.");
    expect(prompt).toContain("Propose a safe edit only");
    expect(prompt).not.toContain("safe output line");
    expect(prompt).not.toContain("access_token");
    expect(prompt).not.toContain("/Users/alice");
    expect(prompt.length).toBeLessThan(1800);

    const followup = buildVerificationFollowupPrompt({
      status: "succeeded",
      message: "Checks passed.",
      cloudRequired: false,
      action: "runVerificationCommand",
      commandId: "repository-check",
      exitCode: 0,
      outputTail: "all checks passed",
      truncated: false,
    }, "followup");
    expect(followup).toContain("Verification follow-up prompt");
    expect(followup).toContain("Explain this verification result");
  });
});
describe("hosted iframe shell layout", () => {
  afterEach(() => {
    if (appParentDescriptor) {
      Object.defineProperty(window, "parent", appParentDescriptor);
    }
    if (appReferrerDescriptor) {
      Object.defineProperty(Document.prototype, "referrer", appReferrerDescriptor);
    }
  });

  it("uses JetBrains host class for parent wrapper iframe bridge mode", async () => {
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(Document.prototype, "referrer", {
      configurable: true,
      get: () => "https://wrapper.example/shell.html",
    });
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    expect(container?.querySelector("main.app-shell.host-jetbrains")).toBeDefined();
    expect(container?.querySelector("main.app-shell.host-browser")).toBeNull();
    expect(container?.textContent).toContain("bridge jetbrains");
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "gui.ready" }), "https://wrapper.example");
  });

  it("renders browser preview lifecycle copy as connect-only without launch authority", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Browser standalone mode connects to a running loopback runtime for chat/provider setup");
    expect(container?.textContent).toContain("Demo Mode, Ollama, and OpenAI-compatible BYOK models");
    expect(container?.textContent).toContain("cannot launch/restart");
    expect(container?.textContent).toContain("run host actions");
  });
});

describe("runtime refresh feedback", () => {
  it("manual Refresh runtime click shows in-flight feedback before resolving and then success status", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockClear();

    const ping = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/ping")) {
        return ping.promise;
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          protocolVersion: "2026-05-15",
          runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
          capabilities: [],
          features: {},
          providers: [],
          ide: { bridge: true, lsp: false },
        }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: readyRuntimeOptions().models }));
      }
      return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
    });

    act(() => {
      findButton("Refresh runtime").click();
    });

    expect(findButton("Checking runtime…").disabled).toBe(true);
    expect(container?.textContent).toContain("Checking runtime…");
    expect(container?.textContent).toContain("Attempt 2 at");

    ping.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();

    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).toContain("Attempt 2 at");
    expect(findButton("Refresh runtime").disabled).toBe(false);
  });

  it("failed Refresh runtime attempts are visibly distinguishable", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Runtime check failed");
    expect(container?.textContent).toContain("Attempt 1 at");

    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Runtime check failed");
    expect(container?.textContent).toContain("Attempt 2 at");
    expect(findButton("Refresh runtime").disabled).toBe(false);
  });

  it("clears stale runtime models when model refresh fails", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockClear();
    mockRuntimeResponses({ providers: [enabledProvider()], modelsFailure: true });

    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Runtime check failed: 503 models unavailable");
    expect(container?.textContent).toContain("Models refresh failed: 503: models unavailable");
    expect(container?.textContent).toContain("State: Runtime/provider refresh failed");
    expect(container?.textContent).toContain("Runtime model refresh failed before a send-ready model was selected. Refresh runtime, Test provider, or inspect local runtime logs.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders Session token guidance and does not persist a manually entered token", async () => {
    const runtimeToken = "local-dev-token-secret";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Browser standalone mode connects to a running loopback runtime.");
    expect(container?.textContent).toContain("Enter its URL and optional Session token, then configure Demo Mode, Ollama, or OpenAI-compatible BYOK providers.");
    expect(container?.textContent).toContain("This token authorizes GUI-to-runtime only; it is not a provider API key.");

    await act(async () => {
      setInputValue(sessionTokenInput(), runtimeToken);
    });

    expect(sessionTokenInput().value).toBe(runtimeToken);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(runtimeToken);
  });

  it("disables Session token autocomplete", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(sessionTokenInput().autocomplete).toBe("off");
  });


  it("renders host.runtimeStatus diagnostics as metadata only without enabling Send", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    await dispatchRuntimeStatus(runtimeStatusPayload());
    await flushAsync();

    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).toContain("VS Code reports runtime connected");
    expect(container?.textContent).toContain("Token: present, value hidden");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders host capability metadata as non-authority and keeps browser actions disabled", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", controlledCapabilities: controlledHostCapabilitiesFixture() });
    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "connected", diagnosis: "runtime connected and host supports controlled actions", nextAction: "Use explicit controls when ready." }));
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Host capability metadata");
    expect(text).toContain("metadata only");
    expect(text).toContain("allowed to execute: false");
    expect(text).toContain("Host/plugin support signals are display evidence only; they never enable Send, apply, verification, or IDE actions.");
    expect(text).toContain("Controlled host matrix: preview_only_unsupported · read unsupported_no_trusted_workspace_host · edit unsupported_no_trusted_workspace_host · verification unsupported_no_trusted_workspace_host.");
    expect(text).toContain("Controlled capabilities v2: VS Code host · Controlled dev-preview path ready · allowed to execute: false.");
    expect(text).toContain("Safe capability labels: Start: supported metadata only · Read: supported metadata only · Edit: supported metadata only · Verification: supported metadata only · Repair: unsupported fail-closed.");
    expect(text).toContain("Correlation requirements: Requires request id · Requires runtime session id · Requires explicit user gesture.");
    expect(text).toContain("Reason labels: Reason metadata only · Reason explicit user gesture required.");
    expect(findButton("Send").disabled).toBe(true);
    expect(findButton("Repository check").disabled).toBe(true);
    expect(findButton("GUI app tests").disabled).toBe(true);
    expect(buttonsNamed("Get IDE context")).toHaveLength(0);
    expect(buttonsNamed("Run read-only IDE action")).toHaveLength(0);
    expect(buttonsNamed("Apply in VS Code after review")).toHaveLength(0);
  });

  it("renders controlled workspace readiness as metadata-only without bridge authority", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-workspace-readiness-details");
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Controlled workspace readiness");
    expect(container?.textContent).toContain("S73 future gated");
    expect(container?.textContent).toContain("metadata only");
    expect(container?.textContent).toContain("ready for future controlled mode");

    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Cannot start an agent.");
    expect(text).toContain("Browser preview remains unsupported for future controlled mode.");
    expect(text).toContain("Can start agent: false");
    expect(text).toContain("Can read files: false");
    expect(text).toContain("Can run commands: false");
    expect(text).toContain("Can apply edits: false");
    expect(text).toContain("Can call provider: false");
    expect(buttonsNamed("Start Agent")).toHaveLength(0);
    expect(buttonsNamed("Create Worktree")).toHaveLength(0);
    expect(buttonsNamed("Read Files")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_workspace_readiness");
  });

  it("renders controlled file read evidence as sanitized metadata without bridge or storage authority", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentFileRead: fileReadSuccess }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-file-read-details");
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Controlled file read evidence");
    expect(container?.textContent).toContain("S74 bounded read");
    expect(container?.textContent).toContain("metadata only");
    expect(container?.textContent).not.toContain("This bounded excerpt is explicit");

    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const traceDetails = findDetails("coding-session-trace-details");
    await act(async () => {
      traceDetails.open = true;
      traceDetails.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const timelineDetails = findDetails("multi-step-task-timeline-details");
    await act(async () => {
      timelineDetails.open = true;
      timelineDetails.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Bounded controlled workspace read evidence.");
    expect(text).toContain("Path label: docs/architecture/013-agent-readiness-milestone.md");
    expect(text).toContain("Controlled file read session metadata");
    expect(text).toContain("controlledAgent.fileReadResult");
    expect(text).toContain("fileRead · evidence");
    expect(text).not.toContain("# 013 Agent Run Readiness Milestone");
    expect(text).not.toContain("This bounded excerpt is explicit");
    expect(buttonsNamed("Read Files")).toHaveLength(0);
    expect(buttonsNamed("Read file")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_file_read");
    expect(browserStorageDump()).not.toContain("This bounded excerpt is explicit");
  });

  it("renders controlled file read blocked metadata without raw content or actions", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentFileRead: fileReadBlocked }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-file-read-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Controlled file read evidence");
    expect(text).toContain("blocked");
    expect(text).toContain("Allowed to read: false");
    expect(text).toContain("blockedReason: policy_denied");
    expect(text).not.toContain("This bounded excerpt is explicit");
    expect(buttonsNamed("Read Files")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("posts exactly one controlled read request only after explicit click", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }) });
    renderApp();
    await flushAsync();

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentFileReadRequest")).toHaveLength(0);
    expect(buttonsNamed("Request controlled read")).toHaveLength(0);

    const details = findDetails("controlled-agent-file-read-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    await act(async () => {
      findButton("Request controlled read").click();
    });

    const readRequests = postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentFileReadRequest");
    expect(readRequests).toHaveLength(1);
    expect(readRequests[0][0]).toMatchObject({
      version: bridgeVersion,
      type: "gui.controlledAgentFileReadRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        workspaceRelativePath: "docs/architecture/013-agent-readiness-milestone.md",
        allowBody: true,
        singleFileOnly: true,
        recursive: false,
        globAllowed: false,
        regexAllowed: false,
        indexingAllowed: false,
      },
    });
    expect(buttonsNamed("Request controlled read")).toHaveLength(0);
    expect(findButton("Clear pending read")).toBeDefined();
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_file_read");
  });

  it("renders controlled task harness and transcript journey without pre-gate authority", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentTaskHarness: taskHarnessHappyFixture, controlledAgentWorkflowTranscript: workflowTranscriptCompletedFixture }) });
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Controlled task journey harness");
    expect(container?.textContent).toContain("Preset, context, search, proposal, patch-plan, apply, verification, follow-up, recovery, and final labels");
    expect(container?.textContent).toContain("Preset id: fix-small-bug");
    expect(container?.textContent).toContain("Search results: 2");
    expect(container?.textContent).toContain("Controlled workflow transcript");
    expect(container?.textContent).toContain("completed");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest" || message.type === "gui.controlledAgentLexicalSearchRequest" || message.type === "gui.controlledAgentMultifileApplyRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_task_harness");
    expect(browserStorageDump()).not.toContain("controlled_agent_workflow_transcript");
  });

  it("keeps JetBrains controlled task journey partial and fail-closed", async () => {
    const postMessage = vi.fn();
    window.postIntellijMessage = postMessage;
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentTaskHarness: taskHarnessJetBrainsFixture, controlledAgentWorkflowTranscript: workflowTranscriptBlockedFixture }) });
    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    expect(container?.textContent).toContain("JetBrains partial/fail-closed");
    expect(container?.textContent).toContain("Partial host; metadata fail-closed");
    expect(container?.textContent).toContain("JetBrains or partial-host transcript evidence remains conservative");
    expect(container?.textContent).toContain("blocked");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);
    if (appParentDescriptor) Object.defineProperty(window, "parent", appParentDescriptor);
    if (appReferrerDescriptor) Object.defineProperty(Document.prototype, "referrer", appReferrerDescriptor);
  });

  it("posts controlled verification bundle only after explicit click and renders sanitized result", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentVerificationBundle: plannedVerificationBundle }) });
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Controlled verification bundle");
    expect(container?.textContent).toContain("Step 1: repository-check");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Run controlled verification bundle").click();
    });

    const bundleRequests = postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest");
    expect(bundleRequests).toHaveLength(1);
    const request = bundleRequests[0][0] as { requestId: string; payload: Record<string, unknown> };
    expect(request.payload).toMatchObject({ requestIdMintedBy: "gui", assistantMinted: false, commandIds: ["repository-check", "gui-app-tests", "engine-chat-tests"] });
    expect(request.payload).not.toHaveProperty("command");
    expect(request.payload).not.toHaveProperty("cwd");
    expect(request.payload).not.toHaveProperty("env");

    const result = JSON.parse(JSON.stringify(succeededVerificationBundle)) as Record<string, any>;
    result.workspace.controlledWorkspaceId = request.payload.controlledWorkspaceId;
    result.workspace.runId = request.payload.runId;
    result.workspace.workspaceReadinessId = request.payload.workspaceReadinessId;
    result.bundle.bundleId = request.payload.bundleId;
    result.bundle.requestedCommandCount = 3;
    result.bundle.commands.push({ ...result.bundle.commands[1], stepId: "step-s117-engine", sequenceIndex: 2, commandId: "engine-chat-tests", resultHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333", outputTail: "Engine chat tests completed with bounded sanitized evidence.", summary: "Engine chat tests passed with local deterministic evidence." });
    result.aggregateResult.commandCount = 3;
    result.aggregateResult.succeededCount = 3;
    await dispatchHostMessage({ version: bridgeVersion, type: "host.controlledAgentVerificationBundleResult", requestId: request.requestId, payload: result });
    await flushAsync();

    expect(container?.textContent).toContain("Verification bundle result accepted: succeeded.");
    expect(container?.textContent).toContain("Sanitized summary tail: Repository check completed with bounded sanitized evidence.");
    expect(findButton("Draft sanitized verification follow-up").disabled).toBe(false);
    expect(findButton("Draft manual fix prompt").disabled).toBe(true);
    const fetchCallsBeforeDraft = fetchMock.mock.calls.length;
    await act(async () => {
      findButton("Draft sanitized verification follow-up").click();
    });

    expect(chatInput().value).toContain("Suggest manual next step");
    expect(chatInput().value).toContain("Use only the sanitized verification summary metadata below");
    expect(chatInput().value).toContain("Step 1 Repository check");
    expect(container?.textContent).toContain("Suggest manual next step created as a local draft.");
    expect(container?.textContent).toContain("manual Send required");
    expect(agentRunPanel().textContent).not.toContain("/Users/");
    expect(agentRunPanel().textContent).not.toContain("Authorization");
    expect(chatInput().value).not.toContain("/Users/");
    expect(chatInput().value).not.toContain("Authorization");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.controlledAgentCommandRunRequest" || message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest")).toHaveLength(1);
    expect(fetchMock.mock.calls).toHaveLength(fetchCallsBeforeDraft);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_verification_bundle");
  });

  it("drafts a manual fix prompt after failed controlled verification bundle only by click", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentVerificationBundle: plannedVerificationBundle }) });
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Run controlled verification bundle").click();
    });
    const request = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    const result = JSON.parse(JSON.stringify(succeededVerificationBundle)) as Record<string, any>;
    result.workspace.controlledWorkspaceId = request.payload.controlledWorkspaceId;
    result.workspace.runId = request.payload.runId;
    result.workspace.workspaceReadinessId = request.payload.workspaceReadinessId;
    result.bundle.bundleId = request.payload.bundleId;
    result.bundle.commands[1].status = "failed";
    result.bundle.commands[1].exitCode = 1;
    result.bundle.commands[1].summary = "GUI app tests failed with bounded local evidence.";
    result.bundle.commands[1].outputTail = "GUI app tests reported a bounded failure category.";
    result.bundle.commands.push({ ...result.bundle.commands[1], stepId: "step-s117-engine", sequenceIndex: 2, commandId: "engine-chat-tests", status: "succeeded", exitCode: 0, resultHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333", outputTail: "Engine chat tests completed with bounded sanitized evidence.", summary: "Engine chat tests passed with local deterministic evidence." });
    result.bundle.requestedCommandCount = 3;
    result.bundle.summary = "One user approved check reported a bounded failure category.";
    result.aggregateResult.status = "failed";
    result.aggregateResult.succeededCount = 1;
    result.aggregateResult.failedCount = 1;
    result.aggregateResult.truncated = true;
    result.aggregateResult.commandCount = 3;
    result.aggregateResult.summary = "One user approved check reported a bounded failure category.";
    await dispatchHostMessage({ version: bridgeVersion, type: "host.controlledAgentVerificationBundleResult", requestId: request.requestId, payload: result });
    await flushAsync();

    expect(findButton("Draft manual fix prompt").disabled).toBe(false);
    expect(chatInput().value).toBe("");
    const fetchCallsBeforeDraft = fetchMock.mock.calls.length;
    await act(async () => {
      findButton("Draft manual fix prompt").click();
    });

    expect(chatInput().value).toContain("Draft manual fix prompt");
    expect(chatInput().value).toContain("failed");
    expect(chatInput().value).toContain("GUI app tests failed with bounded local evidence.");
    expect(container?.textContent).toContain("Draft manual fix prompt created as a local draft.");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest")).toHaveLength(1);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(0);
    expect(fetchMock.mock.calls).toHaveLength(fetchCallsBeforeDraft);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("blocks stale controlled verification bundle lineage before follow-up drafting", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentVerificationBundle: plannedVerificationBundle }) });
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Run controlled verification bundle").click();
    });
    const request = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    const result = JSON.parse(JSON.stringify(succeededVerificationBundle)) as Record<string, any>;
    result.workspace.controlledWorkspaceId = "other-workspace";
    result.workspace.runId = request.payload.runId;
    result.workspace.workspaceReadinessId = request.payload.workspaceReadinessId;
    result.bundle.bundleId = request.payload.bundleId;
    await dispatchHostMessage({ version: bridgeVersion, type: "host.controlledAgentVerificationBundleResult", requestId: request.requestId, payload: result });
    await flushAsync();

    expect(container?.textContent).toContain("Ignored stale verification bundle result.");
    expect(findButton("Draft sanitized verification follow-up").disabled).toBe(true);
    expect(chatInput().value).toBe("");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentVerificationBundleRequest")).toHaveLength(1);
  });

  it("posts controlled lexical search only after explicit click and selection stays local", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }) });
    renderApp();
    await flushAsync();

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentLexicalSearchRequest")).toHaveLength(0);
    expect(container?.textContent).toContain("Controlled lexical search results");

    await act(async () => {
      findButton("Request controlled lexical search").click();
    });

    const searchRequests = postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentLexicalSearchRequest");
    expect(searchRequests).toHaveLength(1);
    const request = searchRequests[0][0] as { requestId: string; payload: Record<string, unknown> };
    expect(request.payload).toMatchObject({ host: "vscode", explicitUserGesture: true, queryMode: "literal_text" });

    const result = structuredClone(hostLexicalSearchSucceeded) as Record<string, any>;
    result.requestId = request.requestId;
    result.payload.requestId = request.requestId;
    result.payload.controlledWorkspaceId = request.payload.controlledWorkspaceId;
    result.payload.runId = request.payload.runId;
    result.payload.runtimeSessionId = request.payload.runtimeSessionId;
    result.payload.workspaceReadinessId = request.payload.workspaceReadinessId;
    await dispatchHostMessage({ version: bridgeVersion, type: "host.controlledAgentLexicalSearchResult", requestId: result.requestId, payload: result.payload });
    await flushAsync();

    expect(container?.textContent).toContain("Displayed safe results: 1");
    const checkbox = Array.from(container?.querySelectorAll<HTMLInputElement>("input[type='checkbox']") ?? []).find((item) => item.parentElement?.textContent?.includes("search-result-"));
    expect(checkbox).toBeDefined();
    await act(async () => {
      checkbox?.click();
    });

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentLexicalSearchRequest")).toHaveLength(1);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(0);
    expect(container?.textContent).toContain("Selected safe results: 1");
    expect(container?.textContent).toContain("explicit user-selected context only");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("function ChatComposer");
  });

  it("keeps browser controlled read unsupported and unable to post", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-file-read-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(container?.textContent).toContain("Explicit controlled read requestunsupported");
    expect(container?.textContent).toContain("Request diagnostics: browser_host, unsupported_host");
    expect(buttonsNamed("Request controlled read")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("ignores stale and duplicate controlled read results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-file-read-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    await act(async () => {
      findButton("Request controlled read").click();
    });

    const request = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentFileReadRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    const stale = controlledReadHostMessage(request.requestId, request.payload, { requestId: "other-request" });
    await dispatchHostControlledFileReadResult(stale.requestId, stale.payload);
    expect(container?.textContent).toContain("Ignored stale controlled read result.");
    expect(findButton("Clear pending read")).toBeDefined();

    const accepted = controlledReadHostMessage(request.requestId, request.payload);
    await dispatchHostControlledFileReadResult(accepted.requestId, accepted.payload);
    expect(container?.textContent).toContain("Controlled read result accepted: success.");
    expect(container?.textContent).toContain("Bounded text read completed within budget");
    expect(container?.textContent).not.toContain("# 013 Agent Run Readiness Milestone");
    expect(container?.textContent).not.toContain("This bounded excerpt is explicit");

    await dispatchHostControlledFileReadResult(accepted.requestId, accepted.payload);
    expect(container?.textContent).toContain("Ignored duplicate controlled read result.");
  });

  it("blocks unsafe controlled read results without rendering raw body or private paths", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-file-read-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    await act(async () => {
      findButton("Request controlled read").click();
    });

    const request = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentFileReadRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    const unsafe = controlledReadHostMessage(request.requestId, request.payload, { text: "Authorization: Bearer abc sk-secret123456789 from /Users/alice/private", sanitizedPathLabel: "/Users/alice/private/secret.txt" });
    await dispatchHostControlledFileReadResult(unsafe.requestId, unsafe.payload);

    const text = container?.textContent ?? "";
    expect(text).toContain("Unsafe controlled file read request metadata omitted near hostMessage.payload.result.sanitizedPathLabel.");
    expect(text).not.toContain("Authorization: Bearer");
    expect(text).not.toContain("sk-secret123456789");
    expect(text).not.toContain("/Users/alice");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("sk-secret123456789");
  });

  it("posts exactly one controlled edit request only after explicit click", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata() }) });
    renderApp();
    await flushAsync();

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest")).toHaveLength(0);
    expect(buttonsNamed("Request controlled edit")).toHaveLength(0);

    const details = findDetails("controlled-agent-edit-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    await act(async () => {
      findButton("Request controlled edit").click();
    });

    const editRequests = postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest");
    expect(editRequests).toHaveLength(1);
    expect(editRequests[0][0]).toMatchObject({
      version: bridgeVersion,
      type: "gui.controlledAgentEditRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        userConfirmed: true,
        edits: [
          {
            operation: "replace",
            workspaceRelativePath: "apps/gui/src/App.tsx",
            replacementText: "const title = \"Yet AI\";\n",
          },
        ],
      },
    });
    expect(container?.textContent ?? "").not.toContain("const title = \"Yet AI\";");
    expect(buttonsNamed("Request controlled edit")).toHaveLength(0);
    expect(findButton("Clear pending edit")).toBeDefined();
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_edit_executor");
  });

  it("renders controlled patch plan dry-run preview and posts no edit request before confirmation", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata(), controlledAgentPatchPlan: controlledPatchPlan }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-edit-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    let text = container?.textContent ?? "";
    expect(text).toContain("Dry-run patch plan preview");
    expect(text).toContain("One bounded replacement candidate is ready for review.");
    expect(text).toContain("docs/safe-copy.md · lines 8-10 · bounded wording replacement · 96 bytes · expected sha256:bbbbbbbbbbb… · user apply required true");
    expect(text).toContain("Confirm the dry-run patch plan preview before requesting the controlled edit.");
    expect(buttonsNamed("Request controlled edit")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Confirm dry-run preview").click();
    });

    text = container?.textContent ?? "";
    expect(text).toContain("confirmed");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest")).toHaveLength(0);
    await act(async () => {
      findButton("Request controlled edit").click();
    });

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest")).toHaveLength(1);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_patch_plan");
  });

  it("keeps unsafe controlled patch plan preview non-actionable", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const unsafePlan = JSON.parse(JSON.stringify(controlledPatchPlan)) as Record<string, any>;
    unsafePlan.patchPlan.candidates[0].operation = "create";
    unsafePlan.patchPlan.candidates[0].existingFileRequired = false;
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata(), controlledAgentPatchPlan: unsafePlan }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-edit-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Unsafe or malformed patch plan preview metadata is non-actionable.");
    expect(text).toContain("unsupported_operation");
    expect(text).toContain("Controlled edit request is disabled because the dry-run patch plan preview is non-actionable.");
    expect(buttonsNamed("Confirm dry-run preview")).toHaveLength(0);
    expect(buttonsNamed("Request controlled edit")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest")).toHaveLength(0);
  });

  it("keeps browser controlled edit unsupported and unable to post", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata() }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-edit-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(container?.textContent).toContain("Explicit controlled edit requestunsupported");
    expect(container?.textContent).toContain("Request diagnostics: browser_host, unsupported_host");
    expect(buttonsNamed("Request controlled edit")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("ignores stale and duplicate controlled edit results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata() }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-edit-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    await act(async () => {
      findButton("Request controlled edit").click();
    });

    const request = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentEditRequest")?.[0] as { requestId: string; payload: Record<string, any> };
    const stale = controlledEditHostMessage(request.requestId, request.payload, { requestId: "other-request" });
    await dispatchHostControlledEditResult(stale.requestId, stale.payload);
    expect(container?.textContent).toContain("Ignored stale controlled edit result.");
    expect(findButton("Clear pending edit")).toBeDefined();

    const accepted = controlledEditHostMessage(request.requestId, request.payload);
    await dispatchHostControlledEditResult(accepted.requestId, accepted.payload);
    expect(container?.textContent).toContain("Controlled edit result accepted: applied.");
    expect(container?.textContent).toContain("Update selected UI metadata lines.");
    expect(container?.textContent).not.toContain("const title = \"Yet AI\";");

    await dispatchHostControlledEditResult(accepted.requestId, accepted.payload);
    expect(container?.textContent).toContain("Ignored duplicate controlled edit result.");
  });

  it("blocks unsafe controlled edit results without rendering raw body, diff, secrets, or private paths", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata() }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-edit-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    await act(async () => {
      findButton("Request controlled edit").click();
    });

    const request = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentEditRequest")?.[0] as { requestId: string; payload: Record<string, any> };
    const unsafe = controlledEditHostMessage(request.requestId, request.payload, { rawDiff: "Authorization: Bearer abc sk-secret123456789 from /Users/alice/private", message: "Edit failed safely." });
    await dispatchHostControlledEditResult(unsafe.requestId, unsafe.payload);

    const text = container?.textContent ?? "";
    expect(text).toContain("Unsupported controlled edit request field rawDiff.");
    expect(text).not.toContain("Authorization: Bearer");
    expect(text).not.toContain("sk-secret123456789");
    expect(text).not.toContain("/Users/alice");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("sk-secret123456789");
  });

  it("renders controlled command result metadata as sanitized evidence without bridge or storage authority", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentCommandRunner: commandRunSucceeded }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-command-runner-details");
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Controlled command evidence");
    expect(container?.textContent).toContain("S75 command id");
    expect(container?.textContent).toContain("metadata only");
    expect(container?.textContent).not.toContain("Repository validation completed with sanitized metadata");

    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const traceDetails = findDetails("coding-session-trace-details");
    await act(async () => {
      traceDetails.open = true;
      traceDetails.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const timelineDetails = findDetails("multi-step-task-timeline-details");
    await act(async () => {
      timelineDetails.open = true;
      timelineDetails.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Allowlisted command-id evidence.");
    expect(text).toContain("Command id: repository-check");
    expect(text).toContain("Command label: Repository check");
    expect(text).toContain("Output tail: Repository validation completed with sanitized metadata");
    expect(text).toContain("Controlled command session metadata");
    expect(text).toContain("controlledAgent.commandResult");
    expect(text).toContain("command · evidence");
    expect(text).not.toContain("npm test");
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("raw cwd");
    expect(text).not.toContain("raw env");
    expect(buttonsNamed("Run command")).toHaveLength(0);
    expect(buttonsNamed("Run controlled command")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.controlledCommandRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_command_runner");
    expect(browserStorageDump()).not.toContain("Repository validation completed with sanitized metadata");
  });

  it("renders controlled command blocked metadata without raw command authority", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentCommandRunner: commandRunBlocked }) });
    renderApp();
    await flushAsync();

    const details = findDetails("controlled-agent-command-runner-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Controlled command evidence");
    expect(text).toContain("blocked");
    expect(text).toContain("Allowed to run command: false");
    expect(text).toContain("blockedReason: policy_denied");
    expect(text).toContain("Can run shell: false");
    expect(text).not.toContain("npm test");
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("npm test");
    expect(buttonsNamed("Run command")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.controlledCommandRequest")).toHaveLength(0);
  });

  it("renders controlled runtime session metadata as read-only evidence without start authority", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }) });
    renderApp();
    await flushAsync();

    const traceDetails = findDetails("coding-session-trace-details");
    await act(async () => {
      traceDetails.open = true;
      traceDetails.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Controlled runtime session metadata");
    expect(text).toContain("S82 evidence");
    expect(text).toContain("read only");
    expect(text).toContain("Session record stores sanitized metadata only");
    expect(text).toContain("Runtime session execution allowed: false");
    expect(text).toContain("Runtime session agent start allowed: false");
    expect(text).toContain("controlledAgent.runtimeSessionReady");
    expect(text).toContain("Controlled runtime session metadata");
    expect(buttonsNamed("Start Agent")).toHaveLength(0);
    expect(buttonsNamed("Run Agent")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.controlledRuntimeSessionRequest" || message.type === "gui.controlledRunRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_runtime_session");
  });

  it("blocks unsafe controlled runtime session metadata without leaking raw values", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const rawSecret = "access_token=" + "r".repeat(64);
    const unsafeRuntimeSession = structuredClone(runtimeSessionReady) as Record<string, any>;
    unsafeRuntimeSession.rawCommand = `npm test /Users/alice/private ${rawSecret}`;
    unsafeRuntimeSession.details.summary = `raw command ${rawSecret}`;
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: unsafeRuntimeSession }) });
    renderApp();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Controlled runtime session metadata");
    expect(text).toContain("blocked");
    expect(text).toContain("unsafe_metadata");
    expect(text).not.toContain("npm test");
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("r".repeat(64));
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.controlledRuntimeSessionRequest")).toHaveLength(0);
  });

  it("renders controlled run skeleton and stops with GUI-local state only", async () => {
    const historySecret = "sk-" + "h".repeat(40);
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentFileRead: fileReadSuccess, controlledAgentCommandRunner: commandRunSucceeded }) });
    renderApp();
    await flushAsync();

    const panel = container?.querySelector("[data-testid='controlled-agent-run-panel']");
    expect(panel?.textContent).toContain("S91 controlled agent dev-preview");
    expect(panel?.textContent).toContain("dev-preview, not production autonomy");
    expect(panel?.textContent).toContain("VS Code supported path");
    expect(panel?.textContent).toContain("Dev-preview readiness");
    expect(panel?.textContent).toContain("Host: vscode");
    expect(panel?.textContent).toContain("VS Code is the supported explicit-control path");
    expect(panel?.textContent).toContain("Browser is preview-only and unsupported for privileged controlled actions");
    expect(panel?.textContent).toContain("JetBrains stays partial/fail-closed where controlled gaps remain");
    expect(panel?.textContent).toContain("Phase: planning");
    expect(panel?.textContent).toContain("Current step: Review sanitized plan metadata");
    expect(panel?.textContent).toContain("Stop reason: none");
    expect(panel?.textContent).toContain("Limit maxSteps: 6");
    expect(panel?.textContent).toContain("Counter fileReadsUsed: 1");
    expect(panel?.textContent).toContain("Counter verificationRuns: 1");
    expect(container?.textContent).toContain("Controlled run history");
    expect(container?.textContent).toContain("local metadata");
    expect(container?.textContent).toContain("sanitized labels only");
    expect(container?.textContent).toContain("controlled-run-planning");
    expect(container?.textContent).toContain("Summary labels: Allowlisted preset completed successfully");
    expect(container?.textContent).toContain("Counters: read count 1 · edit count 0 · verification count 1");
    expect(container?.textContent).toContain("Artifact labels: bounded read metadata · bounded · gui_memory_only");
    expect(panel?.textContent).toContain("Execution allowed: false");
    expect(panel?.textContent).toContain("Agent start allowed: false");
    expect(buttonsNamed("Start Agent")).toHaveLength(0);
    expect(buttonsNamed("Run Agent")).toHaveLength(0);

    await act(async () => {
      findButton("Stop controlled run").click();
    });

    const stoppedText = panel?.textContent ?? "";
    expect(stoppedText).toContain("Phase: stopped");
    expect(stoppedText).toContain("Stop reason: user stop");
    expect(stoppedText).toContain("Controlled run stopped from the S76 skeleton UI.");
    expect(findButton("Stop controlled run").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.controlledRunRequest" || message.type === "gui.controlledRunStopRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("controlled_agent_run");
    expect(container?.textContent).not.toContain(historySecret);
    expect(container?.textContent).not.toContain("raw prompt");
    expect(container?.textContent).not.toContain("raw diff");
    expect(browserStorageDump()).not.toContain("Repository validation completed with sanitized metadata");
  });

  it("shows JetBrains diagnostics handoff during runtime errors without rendering logs", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Diagnostics available");
    expect(text).toContain("Copy Diagnostics");
    expect(text).toContain("Open Logs Folder");
    expect(text).toContain("sanitized bundle");
    expect(text).toContain("Raw logs are not shown in the Web UI");
    expect(text).not.toContain("access_token");
    expect(browserStorageDump()).not.toContain("Diagnostics available");
  });

  it("shows JetBrains diagnostics handoff when runtime status is normal", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    await dispatchRuntimeStatus(runtimeStatusPayload({ surface: "jetbrains", lifecycle: "connected", diagnosis: "runtime connected", nextAction: "Use the chat when ready." }));
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Runtime connected");
    expect(text).toContain("Diagnostics available");
    expect(text).toContain("Tools → Yet AI: Copy Diagnostics or Open Logs Folder");
    expect(text).not.toContain("Recent log tail");
    expect(browserStorageDump()).not.toContain("Open Logs Folder");
  });

  it("does not claim browser standalone can open JetBrains logs", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Browser standalone mode connects to a running loopback runtime");
    expect(text).not.toContain("Diagnostics available");
    expect(text).not.toContain("Open Logs Folder");
    expect(text).not.toContain("Tools → Yet AI");
  });

  it("renders auth mismatch lifecycle guidance without token leakage", async () => {
    const token = "host-runtime-status-secret-value";
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "auth_mismatch", tokenState: "mismatch", diagnosis: "runtime rejected the current local credentials", nextAction: `Refresh runtime without exposing ${token}.` }));
    await flushAsync();

    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "auth_mismatch", tokenState: "mismatch", diagnosis: "runtime rejected the current local credentials", nextAction: "Refresh runtime after mismatch." }));
    await flushAsync();

    expect(container?.textContent).toContain("Runtime authorization mismatch");
    expect(container?.textContent).toContain("Runtime session mismatch");
    expect(container?.textContent).toContain("Raw token values are never shown here");
    expect(container?.textContent).not.toContain(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("ignores stale lifecycle status after runtime settings change", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "failed", diagnosis: "runtime launch failed with sanitized diagnostics" }));
    expect(container?.textContent).toContain("Runtime launch failed");

    await act(async () => {
      setInputValue(runtimeBaseUrlInput(), "http://127.0.0.1:8765");
    });
    await flushAsync();

    expect(container?.textContent).not.toContain("Runtime launch failed");
  });

  it("queues latest runtime settings when host.ready arrives during an in-flight refresh", async () => {
    const hostToken = "queuedHostLocalValue";
    const initialPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") {
        return initialPing.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          displayName: "Yet AI",
          version: "0.0.0",
          ready: true,
          serverTime: "2026-05-24T00:00:00Z",
        }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          protocolVersion: "2026-05-15",
          runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
          capabilities: [],
          features: {},
          providers: [],
          ide: { bridge: true, lsp: false },
        }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: hostToken });

    initialPing.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();
    await flushAsync();

    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${hostToken}`)).toBe(true);
  });

  it("refreshes an already-ready hosted GUI when host.ready updates only the runtime token", async () => {
    const initialToken = "initialHostLocalValue";
    const updatedToken = "updatedHostLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: initialToken });
    await flushAsync();
    fetchMock.mockClear();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: updatedToken });
    await flushAsync();
    await flushAsync();

    const refreshedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(refreshedCalls.length).toBeGreaterThan(0);
    expect(refreshedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${updatedToken}`)).toBe(true);
    expect(browserStorageDump()).not.toContain(initialToken);
    expect(browserStorageDump()).not.toContain(updatedToken);
  });

  it("uses hosted runtime copy without exposing a host.ready token", async () => {
    const hostToken = "hostReadyLocalRuntimeValue";
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: hostToken });
    await flushAsync();

    expect(container?.textContent).toContain("Runtime connection is IDE-managed");
    expect(container?.textContent).toContain("Trusted host.ready supplied the loopback URL and an in-memory Session token");
    expect(container?.textContent).toContain("there is no visible token to copy");
    expect(container?.textContent).toContain("IDE-managed runtime recovery");
    expect(container?.textContent).toContain("do not copy raw runtime tokens into chat");
    expect(container?.textContent).not.toContain(hostToken);
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(browserStorageDump()).not.toContain(hostToken);
  });

  it("clears stale ping caps and identity warnings after unexpected refresh exceptions", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).toContain("/v1/ping");
    expect(container?.textContent).toContain("\"ready\": true");

    fetchMock.mockImplementation(() => Promise.reject(new Error("unexpected refresh crash")));

    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Runtime check failed: network unexpected refresh crash");
    expect(container?.textContent).toContain("No data");
    expect(container?.textContent).not.toContain("\"ready\": true");
    expect(container?.textContent).not.toContain("\"protocolVersion\": \"2026-05-15\"");
  });

  it("keeps Send disabled after settings change until the new runtime is verified", async () => {
    const runtimeBPing = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8765/v1/ping") {
        return runtimeBPing.promise;
      }
      if (url.startsWith("http://127.0.0.1:8765/")) {
        if (url.endsWith("/v1/caps")) {
          return Promise.resolve(jsonResponse({
            productId: "yet-ai",
            protocolVersion: "2026-05-15",
            runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
            capabilities: [],
            features: {},
            providers: [],
            ide: { bridge: true, lsp: false },
          }));
        }
        if (url.endsWith("/v1/models")) {
          return Promise.resolve(jsonResponse({ models: [readyModel({ id: "gpt-b", displayName: "GPT B", providerId: "runtime-b" })] }));
        }
        if (url.endsWith("/v1/providers")) {
          return Promise.resolve(jsonResponse({ providers: [{ ...enabledProvider(), id: "runtime-b", displayName: "Runtime B", models: [readyModel({ id: "gpt-b", displayName: "GPT B" })] }], cloudRequired: false, providerAccess: "direct" }));
        }
        if (url.endsWith("/v1/provider-auth/openai/status")) {
          return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
        }
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(findButton("Send").disabled).toBe(true);

    runtimeBPing.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("State: GPT B (runtime-b)");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("ignores old refresh results that resolve after settings change", async () => {
    const oldPing = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/ping") {
        return oldPing.promise;
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          protocolVersion: "2026-05-15",
          runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
          capabilities: [],
          features: {},
          providers: [],
          ide: { bridge: true, lsp: false },
        }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: url.startsWith("http://127.0.0.1:8001/") ? [readyModel({ id: "old-model", displayName: "Old Model", providerId: "old-runtime" })] : [readyModel({ id: "new-model", displayName: "New Model", providerId: "new-runtime" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        const isOld = url.startsWith("http://127.0.0.1:8001/");
        return Promise.resolve(jsonResponse({ providers: [{ ...enabledProvider(), id: isOld ? "old-runtime" : "new-runtime", displayName: isOld ? "Old Runtime" : "New Runtime", models: [readyModel({ id: isOld ? "old-model" : "new-model", displayName: isOld ? "Old Model" : "New Model" })] }], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url === "http://127.0.0.1:8765/v1/ping") {
        return Promise.resolve(jsonResponse({
          productId: "yet-ai",
          displayName: "Yet AI",
          version: "0.0.0",
          ready: true,
          serverTime: "2026-05-24T00:00:00Z",
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await flushAsync();

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });

    oldPing.resolve(jsonResponse({
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("State: New Model (new-runtime)");
    expect(container?.textContent).not.toContain("State: Old Model (old-runtime)");
  });
});

describe("provider secret boundary", () => {
  it("renders OpenAI login unavailable with API key fallback", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Experimental account login (non-default)");
    expect(container?.textContent).toContain("OpenAI account login is planned/not available for production; use the OpenAI API-key fallback.");
    expect(container?.textContent).toContain("Create an API key in the provider console");

    await act(async () => {
      findButton("Use OpenAI API key fallback").click();
    });

    expect(findInputValue("openai-api")).toBeDefined();    await act(async () => {
      findButton("Use OpenAI API key fallback").click();
    });
    await flushAsync();

    expect(findInputValue("openai-api")).toBeDefined();
    expect(findInputValue("https://api.openai.com/v1")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
    expect(findDetails("provider-setup-details").open).toBe(true);
    expect(document.activeElement).toBe(apiKeyInput());
    expect(container?.textContent).toContain("OpenAI API-key setup opened");
    expect(container?.textContent).toContain("Paste your provider API key, save or update the provider, test provider, then refresh runtime/model readiness before sending.");
    expect(container?.textContent).toContain("Paste your provider API key, save or update the provider, test provider, then refresh runtime/model readiness before sending.");
  });

  it("does not write provider auth state or secrets to browser storage", async () => {
    const secret = "auth-secret-token-value";
    mockRuntimeResponses({ authMessage: secret });
    renderApp();

    await flushAsync();

    expect(browserStorageDump()).not.toContain(secret);
  });

  it("opens provider setup from chat fallback, focuses API key, and keeps fallback secret out of storage", async () => {
    const secret = "sk-fallback-focus-secret-value";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();
    const details = findDetails("provider-setup-details");
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(details.open).toBe(false);

    await act(async () => {
      findButton("Use OpenAI API key fallback").click();
    });
    await flushAsync();

    expect(details.open).toBe(true);
    expect(findInputValue("openai-api")).toBeDefined();
    expect(findInputValue("https://api.openai.com/v1")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
    expect(document.activeElement).toBe(apiKeyInput());
    expect(container?.querySelector(".provider-setup-card-highlight")).toBeDefined();
    expect(container?.textContent).toContain("OpenAI API-key setup opened");
    expect(container?.textContent).toContain("Paste your provider API key, save or update the provider, test provider, then refresh runtime/model readiness before sending.");

    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    expect(apiKeyInput().value).toBe(secret);
    expect(browserStorageDump()).not.toContain(secret);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("saves OpenAI API-key fallback, clears the raw key, and refreshes to send readiness", async () => {
    const secret = "sk-save-refresh-secret-value";
    let savedProvider = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/providers")) {
        const body = JSON.parse(String(init.body)) as { auth?: { apiKey?: string } };
        expect(body.auth?.apiKey).toBe(secret);
        savedProvider = true;
        return Promise.resolve(jsonResponse(enabledProvider()));
      }
      return mockRuntimeResponse(input, init, savedProvider ? {
        ...readyRuntimeOptions(),
        authResponse: providerAuthResponse("api_key_configured"),
      } : {
        authResponse: providerAuthResponse("login_unavailable"),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderApp();

    await flushAsync();
    expect(findButton("Send").disabled).toBe(true);

    await act(async () => {
      findButton("Use OpenAI API key fallback").click();
    });
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    expect(apiKeyInput().value).toBe(secret);

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("API-key fallback configured");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Next safest action: Type a prompt and click Send through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
    expect(container?.textContent).not.toContain(secret);
    expect(browserStorageDump()).not.toContain(secret);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("successful provider test clears raw API key input and refreshes model readiness without persisting provider secrets", async () => {
    const secret = "sk-test-refresh-secret-value";
    let providerTested = false;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/providers/openai-api/test")) {
        providerTested = true;
        return Promise.resolve(jsonResponse({
          ok: true,
          providerId: "openai-api",
          status: "reachable",
          message: "Provider is reachable and accepted the configured credentials.",
          modelId: "gpt-4o-mini",
          cloudRequired: false,
        }));
      }
      return mockRuntimeResponse(input, init, {
        providers: [enabledProvider()],
        models: providerTested ? [readyModel({ providerId: "openai-api" })] : [readyModel({ providerId: "openai-api", readiness: { status: "missing_credentials", reason: "Provider test has not confirmed the saved key yet." } })],
        authResponse: providerAuthResponse("api_key_configured"),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("Model is not ready yet");
    expect(findButton("Send").disabled).toBe(true);

    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("Provider test succeeded");
    expect(container?.textContent).toContain("The raw API-key field was cleared; Test provider uses the saved local runtime credential.");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Next safest action: Type a prompt and click Send through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
    expect(container?.textContent).not.toContain(secret);
    expect(browserStorageDump()).not.toContain(secret);
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("does not open invalid provider auth URLs", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    mockRuntimeResponses({ authSupportsLogin: true, startAuthUrl: "file:///tmp/provider-token" });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Connect OpenAI account (experimental)").click();
    });

    expect(openMock).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Provider auth URL was not opened because it is not HTTPS or loopback.");
  });

  it("starts experimental OpenAI login with explicit flag and opens a safe URL", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    mockRuntimeResponses({
      authSupportsLogin: true,
      startAuthUrl: "https://auth.openai.com/oauth/authorize?state=codex-test",
      startAuthMessage: "Experimental high-risk Codex-like OpenAI login is pending.",
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Connect OpenAI account (experimental)").click();
    });

    const startCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/start") && init?.method === "POST");
    expect(startCall?.[1]?.body).toBe(JSON.stringify({ experimentalCodexLike: true }));
    expect(openMock).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize?state=codex-test", "_blank", "noopener,noreferrer");
    expect(container?.textContent).toContain("high-risk and private-endpoint-style");
    expect(container?.textContent).toContain("Session is tracked locally by the runtime and hidden here");
    expect(container?.textContent).not.toContain("Session: provider-login-session-001");
    expect(container?.textContent).toContain("Expires: 2026-05-24T01:00:00Z");
    expect(container?.textContent).toContain("Requested scopes: openid, profile, email, offline_access");
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
  });

  it("ignores stale provider auth start responses after runtime settings change", async () => {
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    const startAuth = deferred<Response>();
    mockRuntimeResponses({ authSupportsLogin: true });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/start") {
        return startAuth.promise;
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Connect OpenAI account (experimental)").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    startAuth.resolve(jsonResponse({
      ...pendingExperimentalAuthResponse(),
      authorizationUrl: "https://auth.openai.com/oauth/authorize?state=stale-secret",
      message: "stale auth response",
    }));
    await flushAsync();

    expect(openMock).not.toHaveBeenCalled();
    expect(container?.textContent).not.toContain("stale auth response");
    expect(container?.textContent).not.toContain("Session: provider-login-session-001");
  });

  it("enables pending experimental authorization-code exchange", async () => {
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Manual authorization-code exchange");
    expect(findButton("Exchange authorization code").disabled).toBe(true);

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-123");
    });

    expect(findButton("Exchange authorization code").disabled).toBe(false);
  });

  it("sends session id state and code for manual exchange and clears code", async () => {
    const code = "manual-code-456";
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse(), exchangeResponse: connectedExperimentalAuthResponse() });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const exchangeCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST");
    expect(exchangeCall?.[1]?.body).toBe(JSON.stringify({ sessionId: "provider-login-session-001", code, state: "codex-state-001" }));
    expect(authCodeInputOptional()?.value ?? "").toBe("");
  });

  it("clears authorization code immediately during manual exchange and blocks duplicate submits", async () => {
    const exchange = deferred<Response>();
    const code = "manual-code-duplicate";
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/exchange") {
        return exchange.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: pendingExperimentalAuthResponse() });
    });

    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    const exchangeCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST");
    expect(exchangeCalls).toHaveLength(1);
    expect(exchangeCalls[0]?.[1]?.body).toBe(JSON.stringify({ sessionId: "provider-login-session-001", code, state: "codex-state-001" }));
    expect(authCodeInput().value).toBe("");
    expect(findButton("Exchanging…").disabled).toBe(true);
    expect(container?.textContent).not.toContain(code);
    expect(browserStorageDump()).not.toContain(code);

    exchange.resolve(jsonResponse(connectedExperimentalAuthResponse()));
    await flushAsync();
    await flushAsync();

    expect(authCodeInputOptional()?.value ?? "").toBe("");
  });

  it("rejects unsafe authorization-code markers before manual exchange", async () => {
    const unsafeCode = "access_token=" + "u".repeat(64);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(authCodeInput(), unsafeCode);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST")).toHaveLength(0);
    expect(authCodeInput().value).toBe("");
    expect(container?.textContent).toContain("Authorization code is empty, too large, or contains unsafe token/cookie/verifier markers. Paste only the browser authorization code.");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("u".repeat(64));
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(unsafeCode);
  });

  it("fails manual exchange closed when pending session or state markers are unsafe", async () => {
    mockRuntimeResponses({
      authResponse: {
        ...pendingExperimentalAuthResponse(),
        sessionId: "provider-login-session-001 Cookie=secret",
        authorizationUrl: "https://auth.openai.com/oauth/authorize?client_id=yet-ai-local&state=access_token%3Dunsafe",
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-safe-shape");
    });

    expect(container?.textContent).toContain("Authorization state is malformed or unsafe in the pending login response.");
    expect(findButton("Exchange authorization code").disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/exchange") && init?.method === "POST")).toHaveLength(0);
    expect(container?.textContent).not.toContain("Cookie=secret");
    expect(container?.textContent).not.toContain("access_token");
  });

  it("renders connected sanitized status after successful manual exchange", async () => {
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse(), exchangeResponse: connectedExperimentalAuthResponse() });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-789");
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Experimental OpenAI account login is connected through the local runtime, but API-key fallback remains the default real-provider path.");
    expect(container?.textContent).toContain("Account: user@example.test");
    expect(container?.textContent).not.toContain("manual-code-789");
    expect(container?.textContent).not.toContain("access_token");
  });

  it("renders connected account login as a guided path without raw sessions", async () => {
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI account connected");
    expect(container?.textContent).toContain("Ready for chat through the local runtime");
    expect(container?.textContent).toContain("Account: user@example.test");
    expect(container?.textContent).toContain("Token hint: oauth-...test");
    expect(container?.textContent).toContain("Raw provider tokens, cookies, auth codes, provider API keys, and runtime Session token values are not shown here. Runtime Session token and provider credentials are separate secrets.");
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
    expect(container?.textContent).not.toContain("provider-login-session");
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it("keeps API-key provider and model readiness ahead of connected experimental account login", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      authResponse: {
        ...connectedExperimentalAuthResponse(),
        sessionId: "provider-login-session-precedence",
        redacted: "oauth-...precedence",
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI account connected");
    expect(container?.textContent).toContain("Experimental account login is connected/available only as an explicit high-risk path; API-key providers remain the safe default when configured.");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Why: Send is enabled for GPT-4o mini through openai-api.");
    expect(container?.textContent).toContain("Next safest action: Type a prompt and click Send through the local runtime.");
    expect(container?.textContent).not.toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
    expect(container?.textContent).not.toContain("Experimental account login can send");
    expect(container?.textContent).not.toContain("Prefer configuring an API-key or local provider; otherwise type a prompt only if you accept the experimental dev-preview risk.");
    expect(container?.textContent).not.toContain("Experimental fallback send ready");
    expect(findButton("Send").disabled).toBe(false);
    expect(browserStorageDump()).not.toContain("provider-login-session-precedence");
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it("keeps connected experimental account login sanitized with API-key fallback visible", async () => {
    const rawSession = "provider-login-session-raw-visible-guard";
    const rawAccessToken = "access_token=" + "t".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("connected"),
        sessionId: rawSession,
        accountLabel: `user@example.test ${rawAccessToken}`,
        scopes: ["openid", rawAccessToken],
        redacted: "oauth-...test",
        message: `Connected ${rawAccessToken}`,
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI account connected");
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
    expect(container?.textContent).toContain("Raw provider tokens, cookies, auth codes, provider API keys, and runtime Session token values are not shown here.");
    expect(container?.textContent).not.toContain(rawSession);
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("t".repeat(64));
    expect(browserStorageDump()).not.toContain(rawSession);
    expect(browserStorageDump()).not.toContain("access_token");
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it("redacts raw provider-auth private paths and token markers from visible login status and browser storage", async () => {
    const rawSession = "provider-login-session-private-path-guard";
    const rawAccessToken = "access_token=" + "v".repeat(64);
    const rawPrivatePath = "/Users/alice/private/.codex/auth.json";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("connected"),
        sessionId: rawSession,
        accountLabel: `user@example.test ${rawPrivatePath}`,
        scopes: ["openid", rawPrivatePath, rawAccessToken],
        redacted: `oauth-...test ${rawPrivatePath}`,
        message: `Connected ${rawPrivatePath} ${rawAccessToken}`,
        lastError: `last error Cookie: login-cookie ${rawPrivatePath}`,
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI account connected");
    expect(container?.textContent).toContain("[redacted]");
    expect(container?.textContent).not.toContain(rawSession);
    expect(container?.textContent).not.toContain(rawPrivatePath);
    expect(container?.textContent).not.toContain("/Users/alice");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("login-cookie");
    expect(container?.textContent).not.toContain("v".repeat(64));
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSession);
    expect(browserStorageDump()).not.toContain(rawPrivatePath);
    expect(browserStorageDump()).not.toContain("access_token");
  });

  it("shows runtime 401 as local session-token mismatch recovery in browser standalone", async () => {
    mockRuntimeResponses({ authStatusCode: 401, modelsFailure: true });
    renderApp();

    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Local runtime session token mismatch");
    expect(text).toContain("GUI-to-runtime Session token or loopback URL mismatch");
    expect(text).toContain("not an OpenAI, GPT, OAuth, or provider API-key problem");
    expect(text).toContain("Browser standalone cannot launch or restart the runtime");
    expect(text).toContain("GPT/OpenAI experimental login cannot start until you provide a matching loopback runtime URL and Session token");
    expect(text).not.toContain("raw-secret");
    expect(text).not.toContain("Bearer");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("keeps experimental login visible but disabled under runtime 401", async () => {
    mockRuntimeResponses({ authStatusCode: 401, modelsFailure: true });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Experimental GPT/OpenAI login is blocked by runtime auth");
    expect(container?.textContent).toContain("Blocked prerequisite");
    expect(container?.textContent).toContain("Fix the local GUI-to-runtime Session token mismatch first");
    expect(findButton("Connect OpenAI account (experimental)").disabled).toBe(true);
    expect(container?.textContent).not.toContain("authorizationUrl");
    expect(container?.textContent).not.toContain("access_token");
  });

  it("keeps API-key fallback visible under runtime 401 without claiming it fixes runtime auth", async () => {
    mockRuntimeResponses({ authStatusCode: 401, modelsFailure: true });
    renderApp();

    await flushAsync();

    expect(buttonsNamed("Use OpenAI API key fallback").length).toBeGreaterThan(0);
    await act(async () => {
      findButton("Use OpenAI API key fallback").click();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("OpenAI API-key fallback selected, but it cannot fix the local GUI-to-runtime session token mismatch.");
    expect(text).toContain("Fix the runtime URL/session token first");
    expect(text).toContain("Provider API key");
    expect(apiKeyInput()).toBeDefined();
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders all experimental login card actions without raw authorization URL material", async () => {
    const authUrl = "https://auth.openai.com/oauth/authorize?client_id=yet-ai-local&state=secret-state-query&code_challenge=secret-challenge";
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({
      authSupportsLogin: true,
      startAuthUrl: authUrl,
      startAuthMessage: "Experimental high-risk Codex-like OpenAI login is pending.",
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Experimental Codex-like account login risk");
    expect(container?.textContent).toContain("not official public OpenAI OAuth support");
    expect(container?.textContent).toContain("Connect OpenAI account (experimental)");
    expect(buttonsNamed("Experimental high-risk account login")).toHaveLength(0);
    expect(buttonsNamed("Start experimental OpenAI login")).toHaveLength(0);
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
    expect(container?.textContent).toContain("Login/chat only. No workspace execution.");
    expect(container?.textContent).not.toContain("secret-state-query");
    expect(container?.textContent).not.toContain("secret-challenge");

    await act(async () => {
      findButton("Connect OpenAI account (experimental)").click();
    });

    expect(openMock).toHaveBeenCalledWith(authUrl, "_blank", "noopener,noreferrer");
    expect(container?.textContent).not.toContain(authUrl);
    expect(container?.textContent).not.toContain("secret-state-query");
    expect(container?.textContent).not.toContain("secret-challenge");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("secret-state-query");
    expect(browserStorageDump()).not.toContain("secret-challenge");
  });

  it("keeps Send disabled while disconnecting connected experimental login when no API-key model is ready", async () => {
    const disconnect = deferred<Response>();
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/disconnect") {
        return disconnect.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: providerAuthResponse("connected") });
    });

    await act(async () => {
      findButton("Disconnect login").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("State: OpenAI account login changing");
    expect(container?.textContent).toContain("Send is disabled while the local runtime updates account-login state and no API-key provider is ready.");
    expect(findButton("Send").disabled).toBe(true);

    disconnect.resolve(jsonResponse({ ...providerAuthResponse("not_configured"), success: true }));
    await flushAsync();
  });

  it("does not persist raw provider auth, authorization code, session, or runtime token markers in browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSession = "provider-login-session-storage-guard";
    const rawCode = "manual-code-storage-guard";
    const rawRuntimeToken = "runtime-session-storage-guard";
    const rawProviderToken = "access_token=" + "s".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...pendingExperimentalAuthResponse(),
        sessionId: rawSession,
        message: `Pending ${rawProviderToken}`,
      },
      exchangeResponse: {
        ...connectedExperimentalAuthResponse(),
        message: `Connected ${rawProviderToken}`,
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), rawRuntimeToken);
    });
    await act(async () => {
      setInputValue(authCodeInput(), rawCode);
    });

    expect(browserStorageDump()).not.toContain(rawSession);
    expect(browserStorageDump()).not.toContain(rawCode);
    expect(browserStorageDump()).not.toContain(rawRuntimeToken);
    expect(browserStorageDump()).not.toContain("access_token");

    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authCodeInputOptional()?.value ?? "").toBe("");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSession);
    expect(browserStorageDump()).not.toContain(rawCode);
    expect(browserStorageDump()).not.toContain(rawRuntimeToken);
    expect(browserStorageDump()).not.toContain("access_token");
  });

  it("renders sanitized manual exchange failures and clears code", async () => {
    const code = "manual-code-fail";
    const rawToken = "access_token=" + "a".repeat(64);
    mockRuntimeResponses({
      authResponse: pendingExperimentalAuthResponse(),
      exchangeResponse: {
        ...providerAuthResponse("expired"),
        configured: false,
        success: false,
        lastError: `Expired duplicate exchange ${rawToken} verifier=${"b".repeat(64)} auth.json cookie=secret`,
      },
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authCodeInputOptional()?.value ?? "").toBe("");
    expect(container?.textContent).toContain("Expired duplicate exchange [redacted]");
    expect(container?.textContent).not.toContain(code);
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("verifier");
    expect(container?.textContent).not.toContain("auth.json");
    expect(container?.textContent).not.toContain("cookie=secret");
  });

  it("disables manual exchange when pending authorization state cannot be parsed", async () => {
    mockRuntimeResponses({ authResponse: { ...pendingExperimentalAuthResponse(), authorizationUrl: "not a url" } });
    renderApp();

    await flushAsync();

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-disabled");
    });

    expect(container?.textContent).toContain("Authorization state cannot be parsed from the pending login response.");
    expect(findButton("Exchange authorization code").disabled).toBe(true);
  });

  it("primary OpenAI account login starts the experimental Codex-like path", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    mockRuntimeResponses({ authSupportsLogin: true });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Connect OpenAI account (experimental)").click();
    });

    const startCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/provider-auth/openai/start") && init?.method === "POST");
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]?.[1]?.body).toBe(JSON.stringify({ experimentalCodexLike: true }));
    expect(buttonsNamed("Experimental high-risk account login")).toHaveLength(0);
    expect(buttonsNamed("Start experimental OpenAI login")).toHaveLength(0);
  });

  it("renders sanitized recovery when account login start fails", async () => {
    mockRuntimeResponses({ authSupportsLogin: true, startAuthStatus: 400, startAuthError: "invalid provider auth request access_token=" + "x".repeat(64) });
    renderApp();

    await flushAsync();

    await act(async () => {
      findButton("Connect OpenAI account (experimental)").click();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Account login start needs attention");
    expect(text).toContain("OpenAI account login could not start. The runtime returned a sanitized error");
    expect(text).toContain("Retry experimental account login");
    expect(text).toContain("Use OpenAI API key fallback");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("x".repeat(64));
  });

  it("surfaces unauthorized provider auth errors safely", async () => {
    mockRuntimeResponses({ authStatusCode: 401 });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Unauthorized local runtime request. Check the session token.");
    expect(container?.textContent).not.toContain("Bearer");
  });

  it.each([
    ["not_configured", "No production OpenAI account login is configured. Use the OpenAI API-key fallback as the safe/default real-provider path; the experimental account path is optional and high-risk.", "Safe next step"],
    ["login_available", "OpenAI account login is exposed by the local runtime, but it is experimental/non-default until official production support is approved.", "Account login is available only as an explicit experimental path."],
    ["api_key_configured", "OpenAI API-key fallback is configured locally. Account login is not required for the default real-provider path, and API-key/Demo Mode precedence stays intact.", "The safe/default API-key path is already available locally."],
    ["pending", "Experimental OpenAI account login is pending. Finish the browser/device step, then exchange the code or refresh status; use API-key fallback for the default path.", "Complete browser verification, paste only the authorization code if needed"],
    ["connected", "Experimental OpenAI account login is connected through the local runtime, but API-key fallback remains the default real-provider path.", "API-key providers and Demo Mode still take precedence for chat when ready"],
    ["expired", "Experimental OpenAI account login expired. Reconnect only if you accept the risk, or use the API-key fallback.", "The session can no longer power chat."],
    ["revoked", "Experimental OpenAI account login was revoked or disconnected. Reconnect only if you accept the risk, or use the API-key fallback.", "The runtime reports the account path as revoked or disconnected."],
    ["error", "Experimental OpenAI account login reported a sanitized error. Retry/reconnect only if you accept the risk, or use the API-key fallback.", "Only sanitized error details are shown."],
  ] satisfies Array<[ProviderAuthStatus, string, string]>)("renders provider auth status %s", async (status, copy, recoveryCopy) => {
    mockRuntimeResponses({ authResponse: providerAuthResponse(status) });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain(status);
    expect(container?.textContent).toContain(copy);
    expect(container?.textContent).toContain(recoveryCopy);
    expect(container?.textContent).toContain("Login/chat only. No workspace execution.");
  });

  it("enables disconnect for connected account login", async () => {
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(findButton("Disconnect login").disabled).toBe(false);
  });

  it("keeps disconnect disabled for API key configured fallback", async () => {
    mockRuntimeResponses({ authResponse: providerAuthResponse("api_key_configured") });
    renderApp();

    await flushAsync();

    expect(findButton("Disconnect login").disabled).toBe(true);
  });

  it("renders runtime-restart recovery guidance for pending experimental login without leaking session data", async () => {
    const rawSession = "provider-login-session-runtime-restart";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({
      runtimeFailure: true,
      authResponse: {
        ...pendingExperimentalAuthResponse(),
        sessionId: rawSession,
      },
    });
    renderApp();

    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Runtime unavailable or restarted: click Refresh runtime, then Refresh login status.");
    expect(text).toContain("If the pending browser session is stale, reconnect or use the API-key fallback.");
    expect(text).toContain("Reconnect login");
    expect(text).toContain("Cancel or disconnect login");
    expect(text).toContain("Use OpenAI API key fallback");
    expect(text).not.toContain(rawSession);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSession);
  });

  it("re-queries provider auth after runtime reconnect and clears stale pending UI", async () => {
    const rawSession = "provider-login-session-reconnect-cleanup";
    const staleCode = "manual-code-before-reconnect";
    let statusResponse: ProviderAuthResponse = {
      ...pendingExperimentalAuthResponse(),
      sessionId: rawSession,
    };
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(statusResponse));
      }
      return mockRuntimeResponse(input, init, { authResponse: statusResponse });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(authCodeInput(), staleCode);
    });
    expect(authCodeInput().value).toBe(staleCode);
    const statusCallsBeforeReconnect = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status")).length;

    statusResponse = {
      ...providerAuthResponse("expired"),
      lastError: "Runtime recovered without the pending browser session.",
    };
    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "disconnected", diagnosis: "runtime stopped during pending login", nextAction: "Restart runtime." }));
    await flushAsync();

    let text = container?.textContent ?? "";
    expect(authCodeInputOptional()).toBeUndefined();
    expect(text).toContain("Checking account login status…");
    expect(text).toContain("Refresh the local runtime status or continue with the API-key fallback.");
    expect(text).not.toContain(rawSession);
    expect(text).not.toContain(staleCode);

    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "connected", diagnosis: "runtime reconnected after restart", nextAction: "Refresh runtime." }));
    await flushAsync();
    await flushAsync();

    const statusCallsAfterReconnect = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/provider-auth/openai/status")).length;
    expect(statusCallsAfterReconnect).toBeGreaterThan(statusCallsBeforeReconnect);
    text = container?.textContent ?? "";
    expect(text).toContain("OpenAI account expired");
    expect(text).toContain("Runtime recovered without the pending browser session.");
    expect(text).toContain("Reconnect OpenAI account");
    expect(text).toContain("Use OpenAI API key fallback");
    expect(text).not.toContain("Manual authorization-code exchange");
    expect(text).not.toContain(rawSession);
    expect(text).not.toContain(staleCode);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSession);
    expect(browserStorageDump()).not.toContain(staleCode);
  });

  it("clears stale manual exchange input when refreshed status becomes terminal", async () => {
    const code = "manual-code-cleared-after-expiry";
    let statusResponse = pendingExperimentalAuthResponse();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(statusResponse));
      }
      return mockRuntimeResponse(input, init, { authResponse: statusResponse });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    expect(authCodeInput().value).toBe(code);

    statusResponse = {
      ...providerAuthResponse("expired"),
      lastError: "Pending browser session expired before exchange.",
    };
    await act(async () => {
      findButton("Refresh login status").click();
      await Promise.resolve();
    });
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(authCodeInputOptional()).toBeUndefined();
    expect(text).toContain("OpenAI account expired");
    expect(text).toContain("Pending browser session expired before exchange.");
    expect(text).toContain("Reconnect OpenAI account");
    expect(text).toContain("Use OpenAI API key fallback");
    expect(text).not.toContain(code);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(code);
  });

  it("renders retry exchange disconnect and fallback recovery actions for rejected manual exchange", async () => {
    const code = "manual-code-rejected-once";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({
      authResponse: pendingExperimentalAuthResponse(),
      exchangeResponse: {
        ...pendingExperimentalAuthResponse(),
        success: false,
        lastError: "Authorization exchange was rejected by the local runtime.",
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("If exchange is rejected, retry exchange with a fresh browser code once");
    expect(text).toContain("Authorization exchange was rejected by the local runtime.");
    expect(text).toContain("Reconnect login");
    expect(text).toContain("Cancel or disconnect login");
    expect(text).toContain("Use OpenAI API key fallback");
    expect(authCodeInput().value).toBe("");
    expect(text).not.toContain(code);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(code);
  });

  it("sanitizes token-like provider auth last errors before display", async () => {
    const rawToken = "Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const rawApiKey = "api_key=sk-testabcdefghijklmnopqrstuvwxyz";
    const longValue = "x".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("error"),
        lastError: `provider failed ${rawToken} ${rawApiKey} access_token=${longValue} refresh_token=${longValue}`,
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Sanitized login error: provider failed [redacted]");
    expect(container?.textContent).not.toContain("Bearer");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("api_key");
    expect(container?.textContent).not.toContain(longValue);
  });

  it("renders error account login with sanitized retry guidance and API-key fallback", async () => {
    const longValue = "q".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("error"),
        lastError: `callback failed access_token=${longValue} Cookie: session=secret`,
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("OpenAI login needs attention");
    expect(container?.textContent).toContain("Sanitized login error: callback failed [redacted]");
    expect(container?.textContent).toContain("Retry login");
    expect(container?.textContent).toContain("Use OpenAI API key fallback");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("session=secret");
    expect(container?.textContent).not.toContain(longValue);
  });

  it("sanitizes experimental provider auth messages and details before display", async () => {
    const rawCode = "authorization=code-secret-value";
    const rawToken = "refresh_token=" + "z".repeat(64);
    mockRuntimeResponses({
      authResponse: {
        ...providerAuthResponse("pending"),
        message: `experimental pending ${rawCode} Authorization: Bearer short-secret`,
        accountLabel: `${rawToken} Cookie: session=secret; refresh=also-secret`,
        scopes: ["openid", `access_token=${"y".repeat(64)}`, "C:\\Users\\alice\\.codex\\auth.json OPENAI_API_KEY=env-secret"],
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("experimental pending [redacted]");
    expect(container?.textContent).not.toContain("code-secret-value");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("short-secret");
    expect(container?.textContent).not.toContain("session=secret");
    expect(container?.textContent).not.toContain("auth.json");
    expect(container?.textContent).not.toContain("OPENAI_API_KEY");
    expect(container?.textContent).not.toContain("z".repeat(64));
    expect(container?.textContent).not.toContain("y".repeat(64));
  });

  it("browser storage does not contain raw provider API keys", () => {
    localStorage.clear();
    sessionStorage.clear();
    const secret = "sk-yet-test-secret";
    const transientForm = { apiKey: secret };
    const clearedForm = { ...transientForm, apiKey: "" };
    expect(clearedForm.apiKey).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("provider presets fill OpenAI-compatible and local fields without an API key", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    fetchMock.mockClear();

    await act(async () => {
      findButton("OpenAI API key fallback (safe default)").click();
    });

    expect(findInputValue("openai-api")).toBeDefined();
    expect(findInputValue("https://api.openai.com/v1")).toBeDefined();
    expect(findInputValue("gpt-4o-mini")).toBeDefined();
    expect(findInputValue("GPT-4o mini")).toBeDefined();
    expect(findSelectValue("openai-compatible")).toBeDefined();
    expect(findSelectValue("api_key")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("api.openai.com"))).toBe(true);
    expect(browserStorageDump()).not.toContain("sk-");

    await act(async () => {
      findButton("LM Studio local").click();
    });

    expect(findInputValue("lm-studio-local")).toBeDefined();
    expect(findInputValue("http://127.0.0.1:1234/v1")).toBeDefined();
    expect(findInputValue("local-model")).toBeDefined();
    expect(findSelectValue("openai-compatible")).toBeDefined();
    expect(apiKeyInput().value).toBe("");

    await act(async () => {
      findButton("Ollama local (native)").click();
    });

    expect(findInputValue("ollama-local")).toBeDefined();
    expect(findInputValue("http://127.0.0.1:11434")).toBeDefined();
    expect(findSelectValue("ollama")).toBeDefined();
    expect(findSelectValue("none")).toBeDefined();
    expect(findInputValue("llama3.2")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("For local Ollama, the engine calls your Ollama server directly at http://127.0.0.1:11434");
    expect(container?.textContent).toContain("No API key, hosted Yet AI service, account, managed model gateway, cloud workspace, or product credit balance is required");

    await act(async () => {
      findButton("Ollama OpenAI-compatible /v1").click();
    });

    expect(findInputValue("ollama-openai-compatible")).toBeDefined();
    expect(findInputValue("http://127.0.0.1:11434/v1")).toBeDefined();
    expect(findSelectValue("openai-compatible")).toBeDefined();
    expect(apiKeyInput().value).toBe("");
  });

  it("keeps Session token and provider API key guidance visibly distinct", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("This token authorizes GUI-to-runtime only; it is not a provider API key.");
    expect(container?.textContent).toContain("Provider API key is for upstream providers that require one and is sent to the local runtime only on save, cleared from this form immediately after save/update is submitted, and never written to browser storage. Ollama local uses auth None.");
    expect(apiKeyInput().placeholder).toBe("Provider API key, not the runtime Session token");
    expect(container?.textContent).toContain("This is your provider/OpenAI API key, not the runtime Session token.");
  });

  it("submit clears preset API key input and keeps secrets out of browser storage", async () => {
    const secret = "sk-test-preset-secret";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await act(async () => {
      findButton("OpenAI API key fallback (safe default)").click();
    });
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    expect(apiKeyInput().value).toBe(secret);

    await act(async () => {
      findButton("Create provider").click();
    });

    expect(apiKeyInput().value).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("http://127.0.0.1:8001/"))).toBe(true);
    const providerSaveCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers") && init?.method === "POST");
    expect(providerSaveCall?.[1]?.body).toContain(secret);
  });

  it("update existing provider clears API key input and keeps secrets out of browser storage", async () => {
    const secret = "sk-test-update-secret";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Edit").click();
    });
    expect(apiKeyInput().value).toBe("");
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    expect(apiKeyInput().value).toBe(secret);

    await act(async () => {
      findButton("Update provider").click();
    });

    expect(apiKeyInput().value).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
    const providerUpdateCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers/openai-api") && init?.method === "PATCH");
    expect(providerUpdateCall?.[1]?.body).toContain(secret);
  });

  it("failed provider save does not restore raw secret into the DOM or browser storage", async () => {
    const secret = "sk-failed-save-secret";
    mockRuntimeResponses({ ...readyRuntimeOptions(), providerSaveStatus: 500, providerSaveResponse: { error: `save failed api_key=${secret}` } });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });

    await act(async () => {
      findButton("Create provider").click();
    });

    expect(apiKeyInput().value).toBe("");
    expect(container?.textContent).toContain("save failed [redacted]");
    expect(container?.textContent).not.toContain(secret);
    expect(container?.textContent).not.toContain("api_key");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("provider mutation invalidates readiness until provider refresh completes", async () => {
    const providerSave = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    expect(findButton("Send").disabled).toBe(false);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/providers")) {
        return providerSave.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
    });

    expect(findButton("Send").disabled).toBe(true);

    providerSave.resolve(jsonResponse(enabledProvider()));
    await flushAsync();
    await flushAsync();

    expect(findButton("Send").disabled).toBe(false);
  });

  it("ignores stale provider save errors after runtime settings change", async () => {
    const providerSave = deferred<Response>();
    const secret = "sk-stale-save-secret";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(apiKeyInput(), secret);
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers") {
        return providerSave.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
    });
    expect(apiKeyInput().value).toBe("");
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    providerSave.resolve(jsonResponse({ error: "stale save failed Bearer verysecrettokenvalue123456789" }, 500));
    await flushAsync();

    expect(container?.textContent).not.toContain("stale save failed");
    expect(container?.textContent).not.toContain("verysecrettokenvalue");
    expect(apiKeyInput().value).toBe("");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("clears manual authorization code and working state when settings change during exchange", async () => {
    const exchange = deferred<Response>();
    const code = "manual-code-stale";
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/exchange") {
        return exchange.promise;
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [], cloudRequired: false, providerAccess: "direct" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setInputValue(authCodeInput(), code);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    expect(findButton("Exchanging…").disabled).toBe(true);

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    exchange.resolve(jsonResponse({ ...connectedExperimentalAuthResponse(), message: "stale connected" }));
    await flushAsync();

    expect(authCodeInputOptional()?.value ?? "").toBe("");
    expect(container?.textContent).not.toContain("Exchanging…");
    expect(container?.textContent).not.toContain(code);
    expect(container?.textContent).not.toContain("stale connected");
    expect(browserStorageDump()).not.toContain(code);
  });

  it("sanitizes provider metadata before visible rendering", async () => {
    const rawSecret = "access_token=" + "p".repeat(64);
    mockRuntimeResponses({
      providers: [{
        ...enabledProvider(),
        id: `provider-${rawSecret}`,
        displayName: `Provider ${rawSecret}`,
        baseUrl: `http://127.0.0.1:9000/v1?api_key=short-secret`,
        models: [readyModel({ id: "model-1", displayName: `Model refresh_token=${"r".repeat(64)}` })],
      }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Provider [redacted]");
    expect(container?.textContent).toContain("Models: Model [redacted]");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("api_key");
    expect(container?.textContent).not.toContain("short-secret");
    expect(container?.textContent).not.toContain("p".repeat(64));
    expect(container?.textContent).not.toContain("r".repeat(64));
  });

  it("sanitizes provider auth redacted values before visible rendering", async () => {
    mockRuntimeResponses({
      providers: [{
        ...enabledProvider(),
        kind: "openai-compatible Authorization: Bearer provider-kind-secret",
        auth: {
          type: "api_key",
          configured: true,
          redacted: "Authorization: Bearer provider-secret Cookie: session=cookie-secret; refresh=also-secret http://127.0.0.1:8080/v1?api_key=query-secret /Users/Alice Smith/.codex/auth.json",
        },
      }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Secret configured: true ([redacted]");
    expect(container?.textContent).not.toContain("provider-secret");
    expect(container?.textContent).not.toContain("provider-kind-secret");
    expect(container?.textContent).not.toContain("cookie-secret");
    expect(container?.textContent).not.toContain("query-secret");
    expect(container?.textContent).not.toContain("Alice Smith");
    expect(container?.textContent).not.toContain("auth.json");
  });

  it("tests a saved provider through the local runtime and renders success", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });

    const testCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/providers/openai-api/test") && init?.method === "POST");
    expect(testCall).toBeDefined();
    expect(String(testCall?.[0])).toBe("http://127.0.0.1:8001/v1/providers/openai-api/test");
    expect(container?.textContent).toContain("Provider test succeeded");
    expect(container?.textContent).toContain("reachable: Provider is reachable and accepted the configured credentials. Model: gpt-4o-mini.");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("api.openai.com"))).toBe(true);
  });

  it("renders sanitized actionable provider test failures and keeps browser storage secret-free", async () => {
    const secret = "sk-provider-test-visible-secret";
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      providerTestResponse: {
        ok: false,
        providerId: "openai-api",
        status: "unauthorized",
        message: `Provider authentication failed Authorization: Bearer ${secret} cookie=session-secret`,
        modelId: "gpt-4o-mini",
        cloudRequired: false,
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Provider test failed");
    expect(container?.textContent).toContain("unauthorized: Provider authentication failed [redacted]");
    expect(container?.textContent).toContain("Provider rejected the saved credential");
    expect(container?.textContent).toContain("do not paste the runtime Session token here");
    expect(container?.textContent).not.toContain(secret);
    expect(container?.textContent).not.toContain("session-secret");
    expect(browserStorageDump()).not.toContain(secret);
  });

  it.each([
    [429, "Provider rate limit or quota reached."],
    [404, "Model unavailable. Check the saved model id"],
    ["missing_model", "pull/install it locally for Ollama/local servers"],
    ["unreachable", "for Ollama, start the local service at the saved loopback URL"],
  ] as Array<[number | string, string]>)("renders actionable provider test failure copy for %s", async (status, actionCopy) => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      providerTestResponse: {
        ok: false,
        providerId: "openai-api",
        status: typeof status === "string" ? status : "upstream_error",
        message: `Provider test failed with HTTP ${status} api_key=sk-common-secret`,
        cloudRequired: false,
      },
      providerTestStatus: typeof status === "number" ? status : 200,
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Provider test failed");
    expect(container?.textContent).toContain(actionCopy);
    expect(container?.textContent).not.toContain("sk-common-secret");
    expect(container?.textContent).not.toContain("api_key");
    expect(container?.textContent).not.toContain("hosted Yet AI is required");
  });

  it("clears and ignores stale provider test results after runtime settings change", async () => {
    const providerTest = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers/openai-api/test") {
        return providerTest.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("Provider test running");

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    expect(container?.textContent).not.toContain("Provider test running");

    providerTest.resolve(jsonResponse({
      ok: true,
      providerId: "openai-api",
      status: "reachable",
      message: "stale provider test success",
      cloudRequired: false,
    }));
    await flushAsync();

    expect(container?.textContent).not.toContain("Provider test succeeded");
    expect(container?.textContent).not.toContain("stale provider test success");
    expect(browserStorageDump()).not.toContain("stale provider test success");
  });

  it("clears and ignores stale provider test results when provider mutation starts", async () => {
    const providerTest = deferred<Response>();
    const providerSave = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers/openai-api/test") {
        return providerTest.promise;
      }
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/providers") {
        return providerSave.promise;
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("Provider test running");

    await act(async () => {
      findButton("Create provider").click();
      await Promise.resolve();
    });
    expect(container?.textContent).not.toContain("Provider test running");

    providerTest.resolve(jsonResponse({
      ok: true,
      providerId: "openai-api",
      status: "reachable",
      message: "stale provider mutation test success",
      cloudRequired: false,
    }));
    await flushAsync();

    expect(container?.textContent).not.toContain("Provider test succeeded");
    expect(container?.textContent).not.toContain("stale provider mutation test success");
    providerSave.resolve(jsonResponse(enabledProvider()));
  });
});

describe("runtime debug redaction", () => {
  it("sanitizes unexpected /v1/ping secret-like fields before rendering", async () => {
    mockRuntimeResponses({
      pingResponse: {
        productId: "yet-ai",
        displayName: "Yet AI",
        version: "0.0.0",
        ready: true,
        serverTime: "2026-05-24T00:00:00Z",
        access_token: "ping-secret",
        header: "Authorization: Bearer ping-bearer-secret",
        path: "/Users/Alice Smith/auth.json",
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain('"[redacted]": "[redacted]"');
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("ping-secret");
    expect(container?.textContent).not.toContain("ping-bearer-secret");
    expect(container?.textContent).not.toContain("Alice Smith");
    expect(container?.textContent).not.toContain("auth.json");
  });

  it("sanitizes unexpected /v1/caps secret-like fields before rendering", async () => {
    mockRuntimeResponses({
      capsResponse: {
        productId: "yet-ai",
        protocolVersion: "2026-05-15",
        runtime: { mode: "local", cloudRequired: false, providerAccess: "direct", cookie: "session=caps-secret" },
        capabilities: ["chat Authorization: Bearer caps-bearer-secret"],
        features: {},
        providers: [{ id: "provider", accessToken: "caps-token-secret", path: "C:\\Users\\Alice Smith\\.codex\\auth.json" }],
        ide: { bridge: true, lsp: false },
      },
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain('"[redacted]": "[redacted]"');
    expect(container?.textContent).not.toContain("accessToken");
    expect(container?.textContent).not.toContain("caps-token-secret");
    expect(container?.textContent).not.toContain("caps-bearer-secret");
    expect(container?.textContent).not.toContain("caps-secret");
    expect(container?.textContent).not.toContain("Alice Smith");
    expect(container?.textContent).not.toContain("auth.json");
  });
});

describe("agent progress panel", () => {
  it("empty list renders no agent runs", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse() });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Agent progress");
    expect(container?.textContent).toContain("No local agent runs");
    expect(container?.textContent).toContain("The local progress source is reachable but currently has no runs to display.");
    expect(container?.textContent).toContain("Generated at: 2026-05-29T15:00:00Z");
  });

  it("populated live writer progress renders snapshot and heartbeat freshness as read-only state", async () => {
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        message: "Running local endpoint verification",
        ageMs: 2500,
        lastHeartbeatAt: "2026-05-29T14:00:55Z",
        heartbeatAgeMs: 1200,
        lastToolOutputAt: "2026-05-29T14:00:50Z",
        toolOutputAgeMs: 6400,
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Populated local progress");
    expect(text).toContain("1 local agent run returned by the read-only runtime endpoint.");
    expect(text).toContain("Generated at: 2026-05-29T15:00:00Z");
    expect(text).toContain("Read-only local observability; refresh only re-reads local progress.");
    expect(text).toContain("Running local endpoint verification");
    expect(text).toContain("Snapshot age: 3 s");
    expect(text).toContain("Last heartbeat: 2026-05-29T14:00:55Z");
    expect(text).toContain("Heartbeat age: 1 s");
    expect(text).toContain("Last tool output: 2026-05-29T14:00:50Z");
    expect(text).toContain("Tool output age: 6 s");
    expect(text).not.toContain("Snapshot age: unknown");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Stop agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });

  it("renders inert manual runner plan proposals without posting actions", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = manualRunnerPlanProposal();
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ planProposal: proposal })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const card = manualRunnerProposalCard();
    expect(card.textContent).toContain("Plan proposal · Review only");
    expect(card.textContent).toContain("inert");
    expect(card.textContent).toContain("Review local provider readiness");
    expect(card.textContent).toContain("Inspect readiness state");
    expect(card.textContent).toContain("Confirm local model labels");
    expect(card.textContent).toContain("Suggested next user step: Ask the user to review the proposal");
    expect(card.textContent).toContain("It cannot attach context, send chat, apply edits, run verification, call providers, execute tools, or mutate the workspace.");
    fetchMock.mockClear();

    await act(async () => {
      buttonWithin(card, "Use proposal as local draft").click();
    });

    expect(manualRunnerDraftTextarea().value).toContain("Review local provider readiness");
    expect(manualRunnerDraftTextarea().value).toContain("1. Inspect readiness state");
    expect(manualRunnerDraftTextarea().value).toContain("Next user step: Ask the user to review the proposal");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Review local provider readiness");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Run proposal");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply proposal");
  });

  it("rejects unsafe manual runner plan proposals before rendering", async () => {
    const rawSecret = "access_token=" + "p".repeat(64);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        planProposal: {
          ...manualRunnerPlanProposal(),
          steps: ["Run shell command npm run check"],
          rationale: `Do not show ${rawSecret}`,
        },
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Plan proposal · Review only");
    expect(text).not.toContain("Run shell command");
    expect(text).not.toContain("npm run check");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("p".repeat(64));
    expect(manualRunnerProposalCardOptional()).toBeUndefined();
    expect(browserStorageDump()).not.toContain("npm run check");
  });

  it("malformed live writer freshness falls back safely without raw marker leaks", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "h".repeat(64);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        lastHeartbeatAt: `provider response: RAW_HEARTBEAT_BODY ${rawSecret}`,
        heartbeatAgeMs: "fresh",
        lastToolOutputAt: 12345,
        toolOutputAgeMs: null,
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Snapshot age: 1 s");
    expect(text).toContain("Last heartbeat: [redacted]");
    expect(text).toContain("Heartbeat age: unknown");
    expect(text).toContain("Last tool output: unknown");
    expect(text).toContain("Tool output age: unknown");
    expect(text).not.toContain("RAW_HEARTBEAT_BODY");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("h".repeat(64));
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("RAW_HEARTBEAT_BODY");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Stop agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });


  it("defensively renders malformed agent-progress snapshots without leaking raw markers", async () => {
    mockRuntimeResponses({
      agentProgress: {
        cloudRequired: false,
        providerAccess: "direct",
        generatedAt: 42,
        snapshots: [
          {
            cardId: 123,
            runId: null,
            phase: { invalid: true },
            status: "invalid_status",
            message: ["provider response: RAW_MESSAGE_BODY"],
            elapsedMs: "slow",
            ageMs: null,
            currentTool: { kind: "mystery", label: "provider response: RAW_TOOL_LABEL" },
            outputTail: "provider response: RAW_OUTPUT_BODY Authorization: Bearer progress-secret",
            recentEvents: "not an array",
          },
        ],
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Populated local progress");
    expect(text).toContain("unknown-card-1 / unknown-run-1");
    expect(text).toContain("Phase: started");
    expect(text).toContain("Status: running");
    expect(text).toContain("Elapsed: unknown");
    expect(text).toContain("Snapshot age: unknown");
    expect(text).toContain("Heartbeat age: unknown");
    expect(text).toContain("Last heartbeat: unknown");
    expect(text).toContain("Last tool output: unknown");
    expect(text).toContain("Tool output age: unknown");
    expect(text).toContain("No progress message reported.");
    expect(text).toContain("No recent summaries.");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("RAW_MESSAGE_BODY");
    expect(text).not.toContain("RAW_TOOL_LABEL");
    expect(text).not.toContain("RAW_OUTPUT_BODY");
    expect(text).not.toContain("progress-secret");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });
  it("sanitizes generatedAt before rendering", async () => {
    const rawSecret = "access_token=" + "g".repeat(64);
    mockRuntimeResponses({ agentProgress: { ...agentProgressResponse([agentProgressSnapshot()]), generatedAt: `2026-05-29T15:00:00Z ${rawSecret} /Users/Alice/.codex/auth.json` } });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Generated at: 2026-05-29T15:00:00Z [redacted]");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("Alice");
    expect(text).not.toContain("auth.json");
    expect(text).not.toContain("g".repeat(64));
  });

  it("running long-running snapshot renders as not stuck", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ status: "long_running", message: "Verification is still running", elapsedMs: 900000 })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("T-277 / run-001");
    expect(container?.textContent).toContain("long-running, not stuck");
    expect(container?.textContent).toContain("Tool: test · npm test");
    expect(container?.textContent).not.toContain("Stuck reason");
  });

  it("stuck snapshot renders stuck reason", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ phase: "stuck", status: "stuck", stuckReason: "heartbeat_timeout", message: "No heartbeat observed" })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("stuck: heartbeat_timeout");
    expect(container?.textContent).toContain("Stuck reason: heartbeat_timeout");
  });

  it("failed snapshot with secret-like output is redacted", async () => {
    const rawSecret = "access_token=" + "f".repeat(64);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: `Failed ${rawSecret}`,
        outputTail: `Command failed Authorization: Bearer agent-secret Cookie: session=progress-cookie /Users/Alice/.codex/auth.json ${rawSecret}`,
        recentEvents: [{ eventId: "event-secret", timestamp: "2026-05-29T14:00:30Z", phase: "failed", status: "failed", message: `Failed event ${rawSecret}` }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("failed");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("agent-secret");
    expect(text).not.toContain("progress-cookie");
    expect(text).not.toContain("Alice");
    expect(text).not.toContain("auth.json");
    expect(text).not.toContain("f".repeat(64));
  });

  it("failed overflow snapshot renders safe recovery guidance without raw oversized output or mutating controls", async () => {
    const rawSecret = "access_token=" + "o".repeat(64);
    const hugeOutput = "RAW_TASK_BOARD_DUMP_".repeat(300);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: "Planner context failed with context_length_exceeded.",
        stuckReason: "explicit_failure",
        outputTail: `task board output too large. task_board_get dumped too much. Authorization: Bearer planner-secret Cookie: session=planner-cookie /Users/Alice/.codex/auth.json raw prompt: ${hugeOutput} ${rawSecret}`,
        overflowRecovery: {
          kind: "task_board_output_too_large",
          message: `Use task_ready_cards or task_board_get(card_id), not raw prompt: ${hugeOutput} ${rawSecret}`,
          retryable: true,
        },
        recentEvents: [{ eventId: "event-overflow", timestamp: "2026-05-29T14:00:30Z", phase: "failed", status: "failed", message: `maximum context length exceeded provider response: ${hugeOutput} ${rawSecret}` }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Task-board output was too large.");
    expect(text).toContain("Use a specific card id, ready cards, or scoped search instead of a full task-board dump.");
    expect(text).toContain("task_board_get(card_id)");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("planner-secret");
    expect(text).not.toContain("planner-cookie");
    expect(text).not.toContain("Alice");
    expect(text).not.toContain("auth.json");
    expect(text).not.toContain("RAW_TASK_BOARD_DUMP_");
    expect(text).not.toContain("o".repeat(64));
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Stop agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });

  it("explicit stuck snapshot renders contract stuck reason", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ phase: "stuck", status: "stuck", stuckReason: "explicit_stuck", message: "Agent explicitly reported stuck" })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("stuck: explicit_stuck");
    expect(container?.textContent).toContain("Stuck reason: explicit_stuck");
  });

  it("does not render stale overflow recovery for done snapshots", async () => {
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "done",
        status: "done",
        message: "Completed after earlier context_length_exceeded recovery",
        outputTail: "Previous task board output too large event was resolved.",
        overflowRecovery: {
          kind: "task_board_output_too_large",
          message: "Retry with task_ready_cards or task_board_get(card_id).",
          retryable: true,
        },
        recentEvents: [{ eventId: "event-done", timestamp: "2026-05-29T14:00:30Z", phase: "done", status: "done", message: "Done after overflow" }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("done");
    expect(text).not.toContain("Task-board output was too large.");
    expect(text).not.toContain("Use a specific card id, ready cards, or scoped search instead of a full task-board dump.");
  });

  it("redacts raw-content label bodies and bounds oversized noisy output", async () => {
    const noisyChunk = "SAFE_NOISY_AGENT_OUTPUT_";
    const hugeOutput = noisyChunk.repeat(1200);
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: "Failed after raw prompt: SECRET_PROMPT_BODY",
        outputTail: `raw prompt SECRET_PROMPT_BODY\nprovider response: SECRET_PROVIDER_BODY\nfile content=SECRET_FILE_BODY\nworkspace contents: SECRET_WORKSPACE_BODY\nchain of thought SECRET_THOUGHT_BODY\n${hugeOutput}`,
        recentEvents: [{ eventId: "event-raw-body", timestamp: "2026-05-29T14:00:30Z", phase: "failed", status: "failed", message: `tool output too large ${hugeOutput}` }],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Agent output was too large.");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("SECRET_PROMPT_BODY");
    expect(text).not.toContain("SECRET_PROVIDER_BODY");
    expect(text).not.toContain("SECRET_FILE_BODY");
    expect(text).not.toContain("SECRET_WORKSPACE_BODY");
    expect(text).not.toContain("SECRET_THOUGHT_BODY");
    expect((text.match(/SAFE_NOISY_AGENT_OUTPUT_/g) ?? []).length).toBeLessThan(220);
    expect(text.length).toBeLessThan(18100);
  });

  it("detects fallback overflow before raw-content redaction", async () => {
    mockRuntimeResponses({
      agentProgress: agentProgressResponse([agentProgressSnapshot({
        phase: "failed",
        status: "failed",
        message: "Provider request failed",
        outputTail: "provider response: context_length_exceeded FALLBACK_RAW_SENTINEL",
        recentEvents: [],
      })]),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Planner context was too large.");
    expect(text).toContain("Retry with scoped context");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("FALLBACK_RAW_SENTINEL");
  });

  it("bounds oversized agent-progress lists and recent summaries", async () => {
    const snapshots = Array.from({ length: 25 }, (_, index) => agentProgressSnapshot({
      cardId: `T-BOUND-${index}`,
      runId: `run-${index}`,
      recentEvents: Array.from({ length: 18 }, (_, eventIndex) => ({
        eventId: `event-${index}-${eventIndex}`,
        timestamp: "2026-05-29T14:00:30Z",
        phase: "running_command",
        status: "healthy_running",
        message: `safe recent summary ${eventIndex}`,
      })),
    }));
    mockRuntimeResponses({ agentProgress: agentProgressResponse(snapshots) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("T-BOUND-0 / run-0");
    expect(text).toContain("T-BOUND-17 / run-17");
    expect(text).toContain("7 more agent runs hidden.");
    expect(text).toContain("7 more summaries hidden.");
    expect(text).not.toContain("T-BOUND-18 / run-18");
    expect(text).not.toContain("safe recent summary 16");

    expect(text.length).toBeLessThan(38250);
  });

  it("endpoint unavailable or corrupt runtime error is sanitized and non-fatal", async () => {
    mockRuntimeResponses({ agentProgressStatus: 503, agentProgressError: "agent progress unavailable provider response: RAW_CORRUPT_BODY Authorization: Bearer progress-secret" });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Agent progress unavailable");
    expect(container?.textContent).toContain("The local progress source is unavailable, corrupt, oversized, or unsafe. Runtime 503: agent progress unavailable [redacted]");
    expect(container?.textContent).toContain("Chat readiness");
    expect(container?.textContent).not.toContain("RAW_CORRUPT_BODY");
    expect(container?.textContent).not.toContain("progress-secret");
  });

  it("browser storage remains free of raw secret markers", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "sk-agent-progress-secret";
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot({ outputTail: `failed ${rawSecret}` })]) });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
    expect(container?.textContent).not.toContain(rawSecret);
  });

  it("stale response after settings change is ignored", async () => {
    const oldProgress = deferred<Response>();
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:8001/v1/agent-progress") {
        return oldProgress.promise;
      }
      return mockRuntimeResponse(input, init);
    });

    await act(async () => {
      findButton("Refresh agent progress").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    oldProgress.resolve(jsonResponse(agentProgressResponse([agentProgressSnapshot({ cardId: "T-OLD", message: "stale progress secret" })])));
    await flushAsync();

    expect(container?.textContent).toContain("Agent progress not checked");
    expect(container?.textContent).toContain("Refresh to read the local runtime agent-progress source.");
    expect(container?.textContent).not.toContain("T-OLD");
    expect(container?.textContent).not.toContain("stale progress secret");
  });

  it("does not expose mutating agent controls", async () => {
    mockRuntimeResponses({ agentProgress: agentProgressResponse([agentProgressSnapshot()]) });
    renderApp();

    await flushAsync();

    expect(findButton("Refresh agent progress")).toBeDefined();
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Start agent");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Merge");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply");
  });
});

describe("host.ready runtime bootstrap", () => {
  it("VS Code hosted startup waits for host.ready before runtime requests", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp({ autoHostReady: false });
    await flushAsync();

    expect(container?.textContent).toContain("bridge vscode");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/models"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/caps"))).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.runtimeRefresh")).toHaveLength(0);
  });

  it("VS Code hosted host.ready refresh sends Authorization", async () => {
    const postMessage = vi.fn();
    const token = "vscodeHostReadyAuthLocalValue";
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();

    expect(container?.textContent).toContain("bridge vscode");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });
    await flushAsync();
    await flushAsync();

    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).toContain("Runtime connected");
    expect(browserStorageDump()).not.toContain(token);
  });

  it("JetBrains hosted startup waits for host.ready before runtime requests", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp({ autoHostReady: false });
    await flushAsync();

    expect(container?.textContent).toContain("bridge jetbrains");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/models"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/caps"))).toHaveLength(0);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.runtimeRefresh")).toHaveLength(0);
  });

  it("JetBrains packaged bootstrap uses initial same-origin proxy config before host.ready", async () => {
    const postIntellijMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.postIntellijMessage = postIntellijMessage;
    window.__yetAiInitialRuntimeConfig = {
      runtimeAccess: "same_origin_proxy",
      runtimeBaseUrl: "/panel/panel-bootstrap",
      runtimeProxyBaseUrl: "/panel/panel-bootstrap",
    };
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();
    await flushAsync();

    const proxyCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/panel/panel-bootstrap/v1/"));
    expect(proxyCalls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8001/"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8765/"))).toBe(false);
    expect(proxyCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === null)).toBe(true);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.runtimeRefresh")).toHaveLength(0);
    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).toContain("Runtime connection is IDE-managed");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("panel-bootstrap");
  });

  it("engine-served Web UI bootstrap uses same-origin root before any host.ready on loopback origin", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.__yetAiInitialRuntimeConfig = {
      runtimeAccess: "same_origin_proxy",
      runtimeBaseUrl: "/",
    };
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();
    await flushAsync();

    const sameOriginCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/v1/"));
    expect(sameOriginCalls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8001/"))).toBe(false);
    expect(sameOriginCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === null)).toBe(true);
    expect(container?.textContent).toContain("Runtime connected");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("engine-session-token");
  });

  it("rejects non-loopback root same-origin bootstrap before tokenless runtime requests", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    vi.stubGlobal("location", new URL("https://malicious.example/ui"));
    window.__yetAiInitialRuntimeConfig = {
      runtimeAccess: "same_origin_proxy",
      runtimeBaseUrl: "/",
    };
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp({ autoHostReady: false });
    await flushAsync();
    await flushAsync();

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/v1/"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8001/"))).toBe(true);
    expect(container?.textContent).toContain("Runtime unavailable");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("same_origin_proxy");
  });

  it("JetBrains packaged proxy mode ignores later raw direct host.ready URL", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    window.__yetAiInitialRuntimeConfig = {
      runtimeAccess: "same_origin_proxy",
      runtimeBaseUrl: "/panel/panel-stable",
      runtimeProxyBaseUrl: "/panel/panel-stable",
    };
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();
    fetchMock.mockClear();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: "rawDirectToken" });
    await flushAsync();
    await flushAsync();

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8765/"))).toBe(false);
    expect(findInputValue("/panel/panel-stable")).toBeDefined();
    expect(container?.textContent).not.toContain("rawDirectToken");
    expect(browserStorageDump()).not.toContain("rawDirectToken");
  });

  it("JetBrains packaged proxy mode fails closed for malformed host.ready and accepts a later valid proxy payload", async () => {
    const postIntellijMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const malformedToken = "malformedProxyHostReadyToken";
    const directToken = "directHostReadyTokenShouldNotStick";
    const validProxyToken = "validProxyServerSideOnlyToken";
    window.postIntellijMessage = postIntellijMessage;
    window.__yetAiInitialRuntimeConfig = {
      runtimeAccess: "same_origin_proxy",
      runtimeBaseUrl: "/panel/panel-stable",
      runtimeProxyBaseUrl: "/panel/panel-stable",
    };
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();
    await flushAsync();

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/panel/panel-stable/v1/"))).toBe(true);
    fetchMock.mockClear();

    await dispatchHostMessage({ version: bridgeVersion, type: "host.ready", payload: undefined });
    await dispatchHostMessage({
      version: bridgeVersion,
      type: "host.ready",
      payload: { runtimeProxyBaseUrl: "/panel", sessionToken: malformedToken },
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: directToken });
    await flushAsync();
    await flushAsync();

    expect(fetchMock.mock.calls).toHaveLength(0);
    expect(findInputValue("/panel/panel-stable")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(container?.textContent).not.toContain(malformedToken);
    expect(container?.textContent).not.toContain(directToken);
    expect(browserStorageDump()).not.toContain(malformedToken);
    expect(browserStorageDump()).not.toContain(directToken);

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", runtimeProxyBaseUrl: "/panel/panel-next", sessionToken: validProxyToken });
    await flushAsync();
    await flushAsync();

    const validProxyCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/panel/panel-next/v1/"));
    expect(validProxyCalls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8765/"))).toBe(false);
    expect(validProxyCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === null)).toBe(true);
    expect(findInputValue("/panel/panel-next")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).not.toContain(validProxyToken);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(validProxyToken);
  });

  it("JetBrains packaged proxy host.ready provides same-origin runtime config before first refresh", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const hostToken = "packagedProxyServerSideToken";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/"))).toHaveLength(0);

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", runtimeProxyBaseUrl: "/panel/panel-abc", sessionToken: hostToken });
    await flushAsync();
    await flushAsync();

    const proxyCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/panel/panel-abc/v1/"));
    expect(proxyCalls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://127.0.0.1:8765/"))).toBe(false);
    expect(proxyCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === null)).toBe(true);
    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).not.toContain(hostToken);
    expect(browserStorageDump()).not.toContain(hostToken);
  });

  it("JetBrains pre-host.ready Refresh runtime requests host redelivery and recovers after host.ready", async () => {
    const postIntellijMessage = vi.fn();
    const token = "jetbrainsPreHostRecoveryValue";
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();

    expect(container?.textContent).toContain("bridge jetbrains");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.runtimeRefresh")).toHaveLength(0);

    await act(async () => {
      findButton("Refresh runtime").click();
    });
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    const refreshRequests = postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.runtimeRefresh").map(([message]) => message);
    expect(refreshRequests).toEqual([{
      version: bridgeVersion,
      type: "gui.runtimeRefresh",
      requestId: "gui-runtime-refresh-1",
      payload: {},
    }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/models"))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/caps"))).toHaveLength(0);

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });
    await flushAsync();
    await flushAsync();

    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).not.toContain("State: Runtime unavailable");
    expect(container?.textContent).not.toContain(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("JetBrains pre-host.ready Refresh runtime allows a later retry when host.ready is lost", async () => {
    const postIntellijMessage = vi.fn();
    const now = vi.spyOn(Date, "now");
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();

    now.mockReturnValue(10_000);
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    now.mockReturnValue(10_100);
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.runtimeRefresh").map(([message]) => message)).toEqual([{
      version: bridgeVersion,
      type: "gui.runtimeRefresh",
      requestId: "gui-runtime-refresh-1",
      payload: {},
    }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);

    now.mockReturnValue(11_600);
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.runtimeRefresh").map(([message]) => message)).toEqual([
      {
        version: bridgeVersion,
        type: "gui.runtimeRefresh",
        requestId: "gui-runtime-refresh-1",
        payload: {},
      },
      {
        version: bridgeVersion,
        type: "gui.runtimeRefresh",
        requestId: "gui-runtime-refresh-2",
        payload: {},
      },
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);
  });

  it("JetBrains pre-host.ready Refresh runtime does not burn retry guard when the bridge post path is unusable", async () => {
    const acceptedMessages: unknown[] = [];
    let runtimeRefreshBridgeUsable = false;
    const postIntellijMessage = vi.fn((message) => {
      if (message.type === "gui.runtimeRefresh" && !runtimeRefreshBridgeUsable) {
        throw new Error("post bridge unavailable");
      }
      acceptedMessages.push(message);
    });
    const now = vi.spyOn(Date, "now");
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp({ autoHostReady: false });
    await flushAsync();

    now.mockReturnValue(20_000);
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(acceptedMessages.filter((message) => (message as { type?: string }).type === "gui.runtimeRefresh")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);

    runtimeRefreshBridgeUsable = true;
    now.mockReturnValue(20_100);
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(acceptedMessages.filter((message) => (message as { type?: string }).type === "gui.runtimeRefresh")).toEqual([{
      version: bridgeVersion,
      type: "gui.runtimeRefresh",
      requestId: "gui-runtime-refresh-1",
      payload: {},
    }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);
  });

  it("host.ready refresh sends Authorization and clears stale pre-host 401 state", async () => {
    const postIntellijMessage = vi.fn();
    const token = "hostReadyAuthLocalValue";
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses({ authStatusCode: 401, modelsFailure: true });
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("bridge jetbrains");
    expect(container?.textContent).not.toContain("Unauthorized local runtime request");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(0);

    mockRuntimeResponses(readyRuntimeOptions());
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });
    await flushAsync();
    await flushAsync();

    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).toContain("Runtime connected");
    expect(container?.textContent).not.toContain("Unauthorized local runtime request");
    expect(browserStorageDump()).not.toContain(token);
  });

  it("host.ready auth handoff trace proves settings source and Authorization presence", async () => {
    const postIntellijMessage = vi.fn();
    const token = "hostReadyTraceLocalValue";
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });
    await flushAsync();
    await flushAsync();
    await act(async () => {
      const details = findDetails("coding-session-trace-details");
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const trace = findDetails("coding-session-trace-details").textContent ?? "";
    expect(trace).toContain("runtime.settings.applied");
    expect(trace).toContain("runtime.fetch.start");
    expect(trace).toContain("connectionSource");
    expect(trace).toContain("host.ready");
    expect(trace).toContain("authHeaderPresent");
    expect(trace).toContain("true");
    expect(trace).toContain("/v1/ping");
    expect(trace).not.toContain(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("same host runtime URL with a new token updates subsequent Authorization", async () => {
    const postIntellijMessage = vi.fn();
    const initialToken = "initialHostReadyAuthValue";
    const updatedToken = "updatedHostReadyAuthValue";
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: initialToken });
    await flushAsync();
    fetchMock.mockClear();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: updatedToken });
    await flushAsync();
    await flushAsync();

    const refreshedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(refreshedCalls.length).toBeGreaterThan(0);
    expect(refreshedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${updatedToken}`)).toBe(true);
    expect(browserStorageDump()).not.toContain(initialToken);
    expect(browserStorageDump()).not.toContain(updatedToken);
  });

  it("browser standalone still refreshes immediately", async () => {
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("bridge browser");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/ping"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/models"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/caps"))).toBe(true);
  });

  it("updates runtime settings from host.ready without persisting the token", async () => {
    const token = "hostSessionLocalValue";
    mockRuntimeResponses();
    renderApp();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });

    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(container?.textContent).toContain("Host runtime settings received");
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("http://127.0.0.1:8765/") && new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).not.toContain(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("JetBrains host.ready uses host runtime settings without storing token in browser storage", async () => {
    const postIntellijMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const token = "jetbrainsHostReadyLocalValue";
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: token });
    await flushAsync();

    expect(postIntellijMessage.mock.calls.some(([message]) => message?.type === "gui.ready" && message?.version === bridgeVersion)).toBe(true);
    expect(container?.textContent).toContain("bridge jetbrains");
    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(container?.textContent).toContain("Host runtime settings received");
    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).not.toContain(token);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(token);
  });

  it("JetBrains runtime unavailable first-message state points to Refresh runtime and runtime status commands", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("bridge jetbrains");
    expect(text).toContain("State: Runtime unavailable");
    expect(text).toContain("Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send.");
    expect(text).toContain("Start here: connect the local runtime.");
    expect(text).toContain("Runtime needs refresh");
    expect(text).toContain("Runtimerefresh local runtime");
    expect(text).toContain("Demo Modeno-key local canned trial");
    expect(text).toContain("Real providerlocal Ollama or API-key fallback");
    expect(text).toContain("Account loginexperimental non-default");
    expect(text).toContain("Next safest action: Use Refresh runtime from this chat page; the IDE host will re-deliver trusted runtime settings automatically. If it still fails, use the IDE runtime status/restart command instead of copying a token. In JetBrains installed mode, also use Tools → Yet AI: Show Runtime Status or Restart Runtime if Refresh runtime keeps failing.");
    expect(findButton("Refresh runtime")).toBeDefined();
    expect(findButton("Send").disabled).toBe(true);
  });

  it("provider-required first-message state keeps provider setup visible with API-key and local-provider actions", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses();
    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("bridge jetbrains");
    expect(text).toContain("Runtime connected — choose the first-message path");
    expect(text).toContain("Provider setup");
    expect(text).toContain("State: Provider required");
    expect(text).toContain("Provider required: choose Demo Mode for a no-key local canned trial, or configure a BYOK provider/model such as local Ollama or OpenAI-compatible for real answers. No production account login is required.");
    expect(text).toContain("Choose how this first chat should answer.");
    expect(text).toContain("Provider or Demo Mode needed");
    expect(text).toContain("Runtimeconnected");
    expect(text).toContain("Demo Modeno-key local canned trial");
    expect(text).toContain("Real providerlocal Ollama or API-key fallback");
    expect(text).toContain("First messagechoose Demo Mode or BYOK provider");
    expect(text).toContain("Account loginexperimental non-default");
    expect(text).toContain("Next safest action: For local answers without a provider key, choose Ollama local, confirm http://127.0.0.1:11434 and a pulled model id, save, test provider, refresh runtime/model readiness, then send. For hosted OpenAI-compatible answers, use the API-key fallback. Choose Demo Mode only to try the chat flow without provider calls.");
    expect(findButton("Use OpenAI API key fallback")).toBeDefined();
    expect(findButton("Send").disabled).toBe(true);
  });

  it("labels enabled Demo Mode as disable and keeps provider setup open when no chat-ready provider/model exists", async () => {
    mockRuntimeResponses({ demoMode: demoModeResponse(true), providers: [], models: [] });
    renderApp();

    await flushAsync();

    expect(findButton("Disable Demo Mode")).toBeDefined();
    expect(buttonsNamed("Try Demo Mode")).toHaveLength(0);
    expect(findButton("Send").disabled).toBe(true);
    expect(findDetails("provider-setup-details").open).toBe(true);

    fetchMock.mockClear();
    await act(async () => {
      findButton("Disable Demo Mode").click();
      await Promise.resolve();
    });

    const setCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/demo-mode") && init?.method === "POST");
    expect(setCall?.[1]?.body).toBe(JSON.stringify({ enabled: false }));
  });

  it("offers runtime-owned Demo Mode and keeps it out of browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("Try Demo Mode");
    expect(findButton("Send").disabled).toBe(true);

    fetchMock.mockClear();
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [demoProvider()],
      models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" })],
    });
    await act(async () => {
      findButton("Try Demo Mode").click();
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    const demoModePostCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/demo-mode") && init?.method === "POST");
    expect(demoModePostCalls).toHaveLength(1);
    expect(demoModePostCalls[0]?.[1]?.body).toBe(JSON.stringify({ enabled: true }));
    expect(container?.textContent).toContain("Demo Mode is active in the local runtime");
    expect(container?.textContent).toContain("no provider calls");
    expect(container?.textContent).toContain("not model quality");
    expect(container?.textContent).toContain("Demo Mode is ready for a no-key first message.");
    expect(container?.textContent).toContain("Send a prompt to verify chat UX with runtime-owned canned responses.");
    expect(container?.textContent).toContain("State: Yet AI Demo Chat (yet-demo)");
    expect(chatLifecycleText()).toBe("Demo Mode ready — local canned responses, no provider calls. Ready to send.");
    expect(findButton("Send").disabled).toBe(false);
    expect(container?.textContent).toContain("Demo Modelocal canned trial ready");
    expect(container?.textContent).toContain("First messageSend available");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("yet-demo-chat");
  });

  it("installed host Demo Mode enables a no-key first message without browser storage persistence", async () => {
    const postIntellijMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const runtimeToken = "installedHostDemoRuntimeToken";
    const prompt = "Installed host Demo Mode first prompt";
    const cannedResponse = "Installed host Demo Mode canned response.";
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: runtimeToken });
    await flushAsync();

    expect(postIntellijMessage.mock.calls.some(([message]) => message?.type === "gui.ready" && message?.version === bridgeVersion)).toBe(true);
    expect(container?.textContent).toContain("bridge jetbrains");
    expect(container?.textContent).toContain("State: Provider required");
    expect(findButton("Try Demo Mode")).toBeDefined();
    expect(findButton("Send").disabled).toBe(true);
    expect(browserStorageDump()).not.toContain(runtimeToken);

    fetchMock.mockClear();
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [demoProvider()],
      models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" })],
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        { seq: 2, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-demo-installed-1", "assistant", cannedResponse) } },
        { seq: 3, type: "stream_finished", chatId: "chat-001", payload: { finishReason: "stop" } },
      ],
    });
    await act(async () => {
      findButton("Try Demo Mode").click();
      await Promise.resolve();
    });
    await flushAsync();
    await flushAsync();

    const demoModePostCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/demo-mode") && init?.method === "POST");
    expect(demoModePostCalls).toHaveLength(1);
    expect(demoModePostCalls[0]?.[1]?.body).toBe(JSON.stringify({ enabled: true }));
    expect(container?.textContent).toContain("Demo Mode is active in the local runtime");
    expect(container?.textContent).toContain("Demo Mode is ready for a no-key first message.");
    expect(container?.textContent).toContain("State: Yet AI Demo Chat (yet-demo)");
    expect(chatLifecycleText()).toBe("Demo Mode ready — local canned responses, no provider calls. Ready to send.");
    expect(findButton("Send").disabled).toBe(false);
    expect(container?.textContent).toContain("Demo Modelocal canned trial ready");
    expect(container?.textContent).toContain("First messageSend available");

    await act(async () => {
      setTextareaValue(chatInput(), prompt);
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAsync();

    const commandCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST");
    expect(commandCalls).toHaveLength(1);
    expect(new Headers(commandCalls[0]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${runtimeToken}`);
    const commandBody = JSON.parse(String(commandCalls[0]?.[1]?.body)) as { type?: string; payload?: { content?: unknown } };
    expect(commandBody.type).toBe("user_message");
    expect(commandBody.payload?.content).toBe(prompt);
    const providerMutations = fetchMock.mock.calls.filter(([url, init]) => {
      const pathname = new URL(String(url)).pathname;
      return init?.method !== undefined && init.method !== "GET" && (/^\/v1\/providers(?:\/|$)/.test(pathname) || /^\/v1\/provider-auth\//.test(pathname));
    });
    expect(providerMutations).toHaveLength(0);

    const bubbles = Array.from(container?.querySelectorAll(".chat-bubble") ?? []).map((bubble) => bubble.textContent ?? "");
    expect(bubbles).toEqual(expect.arrayContaining([expect.stringContaining(prompt), expect.stringContaining(cannedResponse)]));
    expect(bubbles.filter((text) => text.includes(cannedResponse))).toHaveLength(1);
    expect(chatLifecycleText()).toBe("Demo Mode ready — local canned responses, no provider calls. Ready to send.");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(runtimeToken);
    expect(browserStorageDump()).not.toContain("yet-demo");
    expect(browserStorageDump()).not.toContain(prompt);
    expect(browserStorageDump()).not.toContain(cannedResponse);
  });

  it("keeps the lifecycle ready label real-provider-specific when Demo Mode is enabled but a real provider/model is active", async () => {
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [enabledProvider(), demoProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Demo Mode is enabled in the local runtime, but the current ready chat path uses");
    expect(container?.textContent).toContain("GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Sends may use that configured provider");
    expect(container?.textContent).not.toContain("Demo Mode is enabled in the local runtime. It uses canned responses only, makes no provider calls");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(findButton("Send").disabled).toBe(false);
    expect(chatLifecycleText()).toBe("Ready to send.");
    expect(chatLifecycleText()).not.toContain("local canned responses");
    expect(chatLifecycleText()).not.toContain("no provider calls");
  });

  it("shows contextual Demo Mode ready status after the assistant response and hides stale waiting copy", async () => {
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [demoProvider()],
      models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" })],
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        { seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Hello from Demo Mode." } } },
        { seq: 3, type: "stream_finished", chatId: "chat-001", payload: { finishReason: "stop" } },
      ],
    });
    renderApp();
    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "demo status prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(container?.textContent).toContain("Hello from Demo Mode.");
    expect(chatLifecycleText()).toBe("Demo Mode ready — local canned responses, no provider calls. Ready to send.");
    expect(chatLifecycleText()).not.toContain("Ready when the local runtime and provider model are ready");
    expect(chatLifecycleText()).not.toContain("Waiting for engine");
  });

  it("collapses installed-host advanced controls while Demo Mode is ready", async () => {
    window.postIntellijMessage = vi.fn();
    mockRuntimeResponses({
      demoMode: demoModeResponse(true),
      providers: [demoProvider()],
      models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat", providerId: "yet-demo" })],
    });
    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    expect(findDetails("runtime-connection-details").open).toBe(false);
    expect(findDetails("provider-setup-details").open).toBe(false);
    expect(findDetails("agent-progress-details").open).toBe(false);
    expect(findDetails("chat-advanced-controls").open).toBe(false);
    expect(findDetails("first-message-local-first-notes").open).toBe(false);
    expect(container?.textContent).not.toContain("Use Demo Mode");
    expect(findButton("Disable Demo Mode")).toBeDefined();
    expect(findButton("Send").disabled).toBe(false);
  });

  it("keeps browser runtime connection details open and usable before the runtime connects", async () => {
    delete window.postIntellijMessage;
    delete window.acquireVsCodeApi;
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();

    const runtimeDetails = findDetails("runtime-connection-details");
    expect(runtimeDetails.open).toBe(true);
    expect(sessionTokenInput()).toBeDefined();

    await act(async () => {
      setInputValue(sessionTokenInput(), "manual-browser-token");
    });
    expect(sessionTokenInput().value).toBe("manual-browser-token");
  });

  it("ignores stale Demo Mode toggle responses after runtime settings change", async () => {
    const demoSet = deferred<Response>();
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/demo-mode") {
        return demoSet.promise;
      }
      return mockRuntimeResponse(input, init);
    });

    await act(async () => {
      findButton("Try Demo Mode").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    demoSet.resolve(jsonResponse(demoModeResponse(true)));
    await flushAsync();

    expect(container?.textContent).not.toContain("Demo Mode enabled in local runtime");
    expect(container?.textContent).not.toContain("State: Yet AI Demo Chat (yet-demo)");
    expect(findButton("Send").disabled).toBe(true);
    expect(browserStorageDump()).not.toContain("yet-demo-chat");
  });

  it("first-message readiness distinguishes runtime unavailable provider required and ready to send", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();
    await flushAsync();
    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(findButton("Send").disabled).toBe(true);

    act(() => root?.unmount());
    root = undefined;
    (container as HTMLDivElement | undefined)?.remove();
    container = undefined;
    fetchMock.mockReset();

    mockRuntimeResponses();
    renderApp();
    await flushAsync();
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("State: Provider required");
    expect(findButton("Send").disabled).toBe(true);

    act(() => root?.unmount());
    root = undefined;
    (container as HTMLDivElement | undefined)?.remove();
    container = undefined;
    fetchMock.mockReset();

    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("Ready for your first message");
    expect((container as HTMLDivElement | undefined)?.textContent).toContain("Provider send ready");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("keeps an existing token when URL-only host.ready repeats the same runtime URL", async () => {
    const token = "sameUrlLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });

    expect(findInputValue("http://127.0.0.1:8001")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).startsWith("http://127.0.0.1:8001/") && new Headers(init?.headers).get("Authorization") === `Bearer ${token}`)).toBe(true);
    expect(container?.textContent).not.toContain(token);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("clears an existing token when URL-only host.ready changes runtime URL", async () => {
    const token = "retargetLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765" });
    await flushAsync();

    expect(findInputValue("http://127.0.0.1:8765")).toBeDefined();
    expect(runtimeSessionTokenInputOptional()).toBeUndefined();
    const retargetedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://127.0.0.1:8765/"));
    expect(retargetedCalls.length).toBeGreaterThan(0);
    expect(retargetedCalls.every(([, init]) => !new Headers(init?.headers).get("Authorization")?.includes(token))).toBe(true);
    expect(browserStorageDump()).not.toContain(token);
  });

  it("ignores invalid non-loopback URL-only host.ready", async () => {
    const token = "invalidHostLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "https://example.test:8765" });

    expect(findInputValue("http://127.0.0.1:8001")).toBeDefined();
    expect(sessionTokenInput().value).toBe(token);
    expect(container?.textContent).not.toContain("https://example.test:8765");
  });

  it("ignores empty host.ready sessionToken instead of treating it as a token clear", async () => {
    const token = "emptyClearLocalValue";
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), token);
    });
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001", sessionToken: "" });

    expect(sessionTokenInput().value).toBe(token);
    expect(browserStorageDump()).not.toContain(token);
  });


  it("does not recreate the bridge adapter when runtime URL input changes", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    expect(postIntellijMessage.mock.calls.length).toBeGreaterThan(0);
    expect(container?.textContent).toContain("bridge jetbrains");
    const initialReadyMessages = postIntellijMessage.mock.calls.filter(([message]) => message?.type === "gui.ready").length;

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await flushAsync();

    expect(postIntellijMessage.mock.calls.filter(([message]) => message?.type === "gui.ready")).toHaveLength(initialReadyMessages);
    const bridgeHostEntries = Array.from(container?.querySelectorAll(".timeline-entry") ?? []).filter((entry) => entry.textContent === "Bridge host jetbrains");
    expect(bridgeHostEntries).toHaveLength(1);
  });

  it("host.ready with changed URL and token aborts the old stream once", async () => {
    const stream = mockStreamingReadyRuntime();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), "old-host-ready-token");
    });
    await act(async () => {
      setTextareaValue(chatInput(), "stream before atomic host ready");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: "newHostReadyLocalValue" });
    await flushAsync();

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(new Headers(abortCalls[0][1]?.headers).get("Authorization")).toBe("Bearer old-host-ready-token");
    expect(abortCalls.some(([url]) => String(url).startsWith("http://127.0.0.1:8765/"))).toBe(false);
    stream.close();
  });
});

describe("active editor attached context", () => {
  it("integrates the collapsed read-only manual timeline near Agent Run surfaces", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    const details = findDetails("multi-step-task-timeline-details");
    expect(details.open).toBe(false);
    expect(container?.textContent).toContain("Manual timeline");
    expect(container?.textContent).toContain("metadata only");
    expect(container?.textContent).toContain("no automatic execution");
    expect(container?.textContent).toContain("4 steps");
    expect(container?.textContent).toContain("latest succeeded");
    expect(container?.textContent).not.toContain("Manual timeline metadata groups");

    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const panelText = container?.querySelector("[data-testid='multi-step-task-timeline-panel']")?.textContent ?? "";
    expect(panelText).toContain("Read-only manual timeline");
    expect(panelText).toContain("Task goal not selected");
    expect(panelText).toContain("Explicit context omitted");
    expect(panelText).toContain("Task memory skipped");
    expect(panelText).toContain("Proposal detected");
    expect(panelText).toContain("Policy: metadata_only");
    expect(panelText).toContain("auto send false");
    expect(panelText).toContain("auto apply false");
    expect(panelText).toContain("auto verification false");
    expect(Array.from(container?.querySelectorAll("[data-testid='multi-step-task-timeline-panel'] button") ?? [])).toHaveLength(0);
    expect(findButton("Manually apply reviewed patch")).toBeDefined();
    expect(findButton("Manually apply reviewed patch").disabled).toBe(true);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Manual timeline");
  });

  it("renders task memory suggestions as explicit attach-only guidance", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "s".repeat(64);
    const suggested = projectMemoryNote({ id: "mem-suggested", title: "Agent memory setup", text: "Suggested body must only send after click.", tags: ["agent", "memory"] });
    const stale = projectMemoryNote({ id: "mem-stale", title: "Superseded agent memory", text: "Stale body must not leak.", tags: ["agent"], sessionLabel: "older-session" });
    const unsafe = projectMemoryNote({ id: "mem-unsafe", title: `Provider payload ${rawSecret}`, text: "raw prompt file body /Users/alice/private.ts", tags: ["tool-call"] });
    mockRuntimeResponses({ ...readyRuntimeOptions(), projectMemoryNotes: [suggested, stale, unsafe] });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Agent memory setup");
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Task memory suggestions");
    expect(text).toContain("attach-only guidance");
    expect(text).toContain("suggested 1");
    expect(text).toContain("stale 1");
    expect(text).toContain("unsafe 1");
    expect(text).toContain("Memory suggestions: suggested 1 · stale 1 · unsafe 1 · already attached 0");
    expect(text).toContain("memory suggestion · suggested · Agent memory setup");
    expect(text).toContain("stale · review");
    expect(text).toContain("unsafe · warning only");
    expect(text).toContain("Unsafe memory cannot be attached from suggestions.");
    expect(text).not.toContain(rawSecret);
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("/Users/alice");
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(browserStorageDump()).not.toContain("Suggested body must only send after click.");
    expect(localSetItem).not.toHaveBeenCalled();

    await act(async () => {
      findButton("Attach suggested memory to next message").click();
    });
    expect(container?.textContent).toContain("Attached task-linked local memory note Agent memory setup to the next message context.");
    await act(async () => {
      const details = findDetails("coding-session-trace-details");
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const trace = findDetails("coding-session-trace-details").textContent ?? "";
    expect(trace).toContain("suggestionStatus");
    expect(trace).toContain("suggested");
    expect(trace).not.toContain("Suggested body must only send after click.");
    expect(container?.textContent).toContain("already attached");
    expect(container?.textContent).toContain("already attached");
    expect(buttonsNamed("Attach suggested memory to next message")).toHaveLength(0);
    expect(findButton("Detach memory from next message")).toBeDefined();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
  });

  it("creates searches attaches clears and deletes local project memory without browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "m".repeat(64);
    const traceDetailsText = () => findDetails("coding-session-trace-details").textContent ?? "";
    const note = projectMemoryNote({ title: "Architecture decision " + rawSecret, text: "Use engine-owned local memory only. " + rawSecret, tags: ["architecture", rawSecret], updatedAt: "2026-06-17T12:00:00Z " + rawSecret });
    let notes: unknown[] = [];
    mockRuntimeResponses({ ...readyRuntimeOptions(), projectMemoryNotes: notes });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/project-memory") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ protocolVersion: "2026-06-17", title: "Architecture decision", text: "Use engine-owned local memory only.", tags: ["architecture"], source: "manual" });
        notes = [note];
        return Promise.resolve(jsonResponse(note));
      }
      if (url.endsWith("/v1/project-memory/search") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ protocolVersion: "2026-06-17", query: "engine" });
        return Promise.resolve(jsonResponse({ matches: notes.map((memoryNote) => ({ note: memoryNote, scoreLabel: "text" })), cloudRequired: false, providerAccess: "direct", queryLabel: "engine" }));
      }
      if (url.endsWith("/v1/project-memory/mem-001") && init?.method === "DELETE") {
        notes = [];
        return Promise.resolve(jsonResponse({ deleted: true, noteId: "mem-001" }));
      }
      return mockRuntimeResponse(input, init, { ...readyRuntimeOptions(), projectMemoryNotes: notes });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("Local project memory");
    expect(container?.textContent).toContain("ready");
    expect(container?.textContent).toContain("No memory notes listed");
    expect(container?.textContent).toContain("No local memory notes are listed");

    await act(async () => {
      setInputValue(findInputByPlaceholder("Short note title"), "Architecture decision");
      setTextareaByPlaceholder("Manual local note", "Use engine-owned local memory only.");
      setInputValue(findInputByPlaceholder("architecture, decision"), "architecture");
    });
    await act(async () => {
      findButton("Create memory note").click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(container?.textContent).toContain("Saved local memory note Architecture decision [redacted].");
    expect(container?.textContent).toContain("Use engine-owned local memory only.");
    expect(container?.textContent).toContain("Sanitized bounded preview");
    expect(container?.textContent).toContain("source manual");
    expect(container?.textContent).toContain("tags architecture, [redacted]");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("m".repeat(64));
    expect(findInputByPlaceholder("Short note title").value).toBe("");
    expect(findTextareaByPlaceholder("Manual local note").value).toBe("");

    await act(async () => {
      setInputValue(findInputByPlaceholder("Literal memory query"), "engine");
    });
    await act(async () => {
      findButton("Search memory").click();
      await Promise.resolve();
    });
    await flushAsync();
    expect(container?.textContent).toContain("1 local memory note matched engine.");

    await act(async () => {
      findButton("Attach task-linked memory to next message").click();
    });
    expect(container?.textContent).toContain("Attached task-linked local memory note Architecture decision [redacted] to the next message context. Trace label: memory-attach-chat-001-mem-001.");
    expect(container?.textContent).toContain("task-linked attached to next message");
    expect(container?.textContent).toContain("Task link: Task-linked memory attach · Session: Chat chat-001 · Attach trace minted only after explicit click.");
    expect(findButton("Detach memory from next message")).toBeDefined();
    expect(container?.textContent).toContain("Project memory");
    expect(browserStorageDump()).not.toContain("Use engine-owned local memory only.");
    await act(async () => {
      const details = findDetails("coding-session-trace-details");
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(traceDetailsText()).toContain("Task-linked project memory attached");
    expect(traceDetailsText()).toContain("memory-attach-chat-001-mem-001");
    expect(traceDetailsText()).toContain("attachedMemoryCount");
    expect(traceDetailsText()).not.toContain("Use engine-owned local memory only");
    expect(traceDetailsText()).not.toContain("noteId");

    await act(async () => {
      findButton("Detach memory from next message").click();
    });

    expect(container?.textContent).toContain("Detached local memory note Architecture decision [redacted] from the next message context.");
    expect(findButton("Attach task-linked memory to next message")).toBeDefined();

    await act(async () => {
      findButton("Attach task-linked memory to next message").click();
    });
    await act(async () => {
      findButton("Clear bundle").click();
    });
    expect(container?.textContent).toContain("Cleared the one-shot explicit context bundle.");
    expect(container?.textContent).toContain("empty");

    await act(async () => {
      findButton("Attach task-linked memory to next message").click();
    });
    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "Use attached memory once");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "Use attached memory once",
      context: {
        kind: "explicit_context_bundle",
        items: [{ kind: "project_memory", noteId: "mem-001", title: "Architecture decision " + rawSecret, text: "Use engine-owned local memory only. " + rawSecret, tags: ["architecture", rawSecret] }],
      },
    });
    expect(container?.textContent).toContain("One-shot explicit context bundle attached to the last accepted message and cleared.");
    expect(container?.textContent).toContain("empty");

    await act(async () => {
      findButton("Delete memory").click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(container?.textContent).toContain("Deleted local memory note Architecture decision [redacted].");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Use engine-owned local memory only.");
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("uses session helper labels for memory attach across chat changes without unsafe id leaks", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "n".repeat(64);
    const safeNote = projectMemoryNote({ id: "mem-safe", title: "Safe session note", text: "Remember manual label only.", taskLabel: "Roadmap S65", sessionLabel: "Session Alpha" });
    const unsafeNote = projectMemoryNote({ id: `mem/${rawSecret}`, title: "Unsafe id note", text: "Unsafe id body must stay out of labels.", taskLabel: `task ${rawSecret}`, sessionLabel: `/Users/alice/private/chat ${rawSecret}` });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Alpha", 0), chatSummary("chat-beta", "Beta", 0)], chatThreads: { "chat-001": chatThread("chat-001", "Alpha", []), "chat-beta": chatThread("chat-beta", "Beta", []) }, projectMemoryNotes: [safeNote, unsafeNote] });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Attach task-linked memory to next message").click();
    });
    expect(container?.textContent).toContain("Task link: Roadmap S65 · Session: Session Alpha · Attach trace minted only after explicit click.");
    expect(container?.textContent).toContain("Trace label: memory-attach-chat-001-mem-safe.");

    await act(async () => {
      findButton("Detach memory from next message").click();
    });
    await act(async () => {
      findConversationButton(/Open conversation: Beta/).click();
      await Promise.resolve();
    });
    await flushAsync();
    await act(async () => {
      buttonsNamed("Attach task-linked memory to next message")[1].click();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Trace label: memory-attach-chat-beta-memory.");
    expect(text).toContain("Task link: Task-linked memory attach · Session: Chat chat-beta · Attach trace minted only after explicit click.");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain("n".repeat(64));
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Unsafe id body");
  });

  it("renders manual runner panel as progress-only browser preview without auto actions or storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    fetchMock.mockClear();

    const panel = manualRunnerPanel();
    expect(panel.textContent).toContain("Manual runner · Coding loop");
    expect(panel.textContent).toContain("browser preview only");
    expect(panel.textContent).toContain("manual only");
    expect(panel.textContent).toContain("Current manual lifecycle step: 1. Goal");
    expect(panel.textContent).toContain("It never auto-sends, auto-attaches context, auto-applies edits, auto-runs verification");
    expect(panel.textContent).toContain("Browser preview can draft and chat with the runtime");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Manual runner");
  });

  it("renders coding task session panel with safe workflow summaries", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    expect(whatWillBeSentPanelOptional()).toBeUndefined();

    const panel = codingTaskSessionPanel();
    expect(panel.textContent).toContain("Coding task session");
    expect(panel.textContent).toContain("local draft");
    expect(panel.textContent).toContain("inert workflow");
    expect(panel.textContent).toContain("Buttons only focus the prompt or write local draft text");
    expect(panel.textContent).toContain("they never auto-attach, send, apply, verify, save memory, call providers, read files, or write browser storage");
    expect(panel.textContent).toContain("Session: draft not started");
    expect(panel.textContent).toContain("Goal: not written");
    expect(panel.textContent).toContain("Context selected: none");
    expect(panel.textContent).toContain("Explicit context bundle: empty · add context manually if needed");
    expect(panel.textContent).toContain("Prompt drafted: ready");
    expect(panel.textContent).toContain("Response lifecycle: Ready to send.");
    expect(panel.textContent).toContain("Proposal lifecycle: detected");
    expect(panel.textContent).toContain("Apply lifecycle: not_requested");
    expect(panel.textContent).toContain("Edit lifecycle: none");
    expect(panel.textContent).toContain("Verification lifecycle: not requested · draft or attach manually");
    expect(panel.textContent).toContain("Provider/model readiness: ready · GPT-4o mini (openai-api)");
    expect(panel.textContent).toContain("Memory attachments: 0");
    expect(panel.textContent).toContain("One-step model proposal");
    expect(panel.textContent).toContain("Goal summary: No local goal selected");
    expect(panel.textContent).toContain("Next safe manual step");
    expect(panel.textContent).toContain("Write the task goal, choose a template, review any explicit context, then click Send yourself when ready.");
    expect(panel.textContent).toContain("One-shot context is not browser-stored or auto-attached; selected explicit context clears only after an accepted Send and remains available if Send fails.");
    expect(panel.textContent).toContain("Explicit context bundle summary");
    expect(panel.textContent).toContain("Task templates");
    expect(panel.textContent).toContain("Ask");
    expect(panel.textContent).toContain("Explain");
    expect(panel.textContent).toContain("Find bug");
    expect(panel.textContent).toContain("Suggest tests");
    expect(panel.textContent).toContain(`Re${"factor safely"}`);
    expect(panel.textContent).toContain("Safe edit/proposal");
    expect(panel.textContent).toContain("Implementation plan");
    expect(panel.textContent).toContain("Follow-up");
    expect(panel.textContent).toContain("No explicit bundle items selected");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Coding task session");
    expect(browserStorageDump()).not.toContain("What will be sent");
  });

  it("renders what-will-be-sent labels and budget status without raw body or storage leaks", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSnippetBody = "function previewBodyMarker() { return 'do not show'; }";
    const verificationBody = "failed assertion output sentinel";
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Fix context budget UX");
      setTextareaValue(chatInput(), "Please review selected context.");
    });
    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: rawSnippetBody }));
    await flushAsync();
    await act(async () => {
      findButton("GUI app tests").click();
    });
    await dispatchHostIdeActionResult("gui-verification-command-2", { status: "failed", message: "GUI tests failed.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 1, durationMs: 12, outputTail: verificationBody, truncated: false });
    await act(async () => {
      findButton("Attach verification result to next message").click();
    });

    const sentPanel = whatWillBeSentPanel();
    expect(sentPanel.textContent).toContain("What will be sent");
    expect(sentPanel.textContent).toContain("Draft prompt: 31 chars");
    expect(sentPanel.textContent).toContain("Included context: 2 items");
    expect(sentPanel.textContent).toContain("Omitted: 1");
    expect(sentPanel.textContent).toContain("Task goal");
    expect(sentPanel.textContent).toContain("Explicit context bundle: included · 1 item");
    expect(sentPanel.textContent).toContain("vscode src/editor.ts");
    expect(sentPanel.textContent).toContain("gui-app-tests");
    expect(sentPanel.textContent).toContain("One-shot next-Send preview");
    expect(sentPanel.textContent).not.toContain(rawSnippetBody);
    expect(sentPanel.textContent).not.toContain(verificationBody);
    expect(sentPanel.textContent).not.toContain("Please review selected context.");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSnippetBody);
    expect(browserStorageDump()).not.toContain(verificationBody);
    expect(browserStorageDump()).not.toContain("Fix context budget UX");
    expect(browserStorageDump()).not.toContain("Please review selected context.");
  });

  it("previews explicit bundle precedence over standalone active excerpt before send", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Fix context precedence");
      setTextareaValue(chatInput(), "Send the selected bundle.");
    });
    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ path: "src/standalone.ts", text: "standalone excerpt body" }));
    await act(async () => {
      findButton("GUI app tests").click();
    });
    await dispatchHostIdeActionResult("gui-verification-command-2", { status: "failed", message: "GUI tests failed.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 1, durationMs: 12, outputTail: "verification output body", truncated: false });
    await act(async () => {
      findButton("Attach verification result to next message").click();
    });

    const sentPanel = whatWillBeSentPanel();
    expect(sentPanel.textContent).toContain("vscode src/standalone.ts");
    expect(sentPanel.textContent).toContain("omitted · 1 item");
    expect(sentPanel.textContent).toContain("Explicit context bundle: included · 1 item");
    expect(sentPanel.textContent).toContain("verification output · gui-app-tests");
    expect(sentPanel.textContent).not.toContain("What will be sent item labelssrc/standalone.ts");

    fetchMock.mockClear();
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload?.context).toMatchObject({ kind: "explicit_context_bundle", items: [{ kind: "verification_output", commandId: "gui-app-tests" }] });
  });

  it("shows coding task recovery copy when provider is not ready", async () => {
    mockRuntimeResponses({ providers: [enabledProvider()], models: [readyModel({ providerId: "missing-provider" })] });
    renderApp();
    await flushAsync();

    const panel = codingTaskSessionPanel();
    expect(panel.textContent).toContain("Prompt recovery");
    expect(panel.textContent).toContain("Model/provider mismatch is visible. Test the saved provider, fix the model id mapping locally, refresh runtime, then draft/send again.");
    expect(panel.textContent).toContain("Next safe manual step");
    expect(panel.textContent).toContain("Connect runtime and choose Demo Mode or a local/BYOK provider before sending; templates can still draft locally.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("coding task session template buttons only draft local text and focus existing controls", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    fetchMock.mockClear();
    postMessage.mockClear();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Add a guided panel");
    });
    await dispatchHostIdeActionResult("not-pending", activeFileExcerptResultPayload({ text: "export const panel = true;" }));
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);

    const templateExpectations: Array<[string, string, string]> = [
      ["Draft Ask prompt", "Ask prompt", "answer the task question"],
      ["Draft Explain prompt", "Explain request", "explain the selected code or task"],
      ["Draft Find bug prompt", "Bug-finding request", "identify likely bugs"],
      ["Draft Suggest tests prompt", "Test-suggestion request", "suggest focused tests"],
      [`Draft Re${"factor safely"} prompt`, "Safe rework request", "smallest bounded safe rework"],
      ["Draft Safe edit/proposal prompt", "Safe-edit request", "propose the smallest bounded manual edit"],
      ["Draft Implementation plan prompt", "Implementation plan request", "draft a concise implementation plan"],
      ["Draft Follow-up prompt", "Follow-up prompt", "suggest the next safe manual step"],
    ];

    for (const [buttonLabel, title, instruction] of templateExpectations) {
      await act(async () => {
        findButton(buttonLabel).click();
      });
      expect(chatInput().value).toContain(title);
      expect(chatInput().value).toContain(instruction);
      expect(chatInput().value).toContain("Goal\nAdd a guided panel");
      expect(chatInput().value).toContain("Explicit context summary");
      expect(chatInput().value).toContain("Provider readiness\nGPT-4o mini (openai-api)");
      expect(chatInput().value).toContain("Use only the attached explicit context");
      expect(document.activeElement).toBe(chatInput());
    }

    await act(async () => {
      findButton("Copy plan prompt to manual draft").click();
    });
    expect(manualRunnerDraftTextarea().value).toContain("Implementation plan request");
    expect(manualRunnerDraftTextarea().value).toContain("Goal\nAdd a guided panel");

    await act(async () => {
      findButton("Focus chat prompt").click();
    });
    expect(document.activeElement).toBe(chatInput());
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Add a guided panel");
  });

  it("advances manual runner through context and prompt drafting without posting actions", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    fetchMock.mockClear();
    postMessage.mockClear();

    const panel = manualRunnerPanel();
    await act(async () => {
      setTextareaValue(manualRunnerDraftTextarea(), "Inspect context, ask model, then verify.");
    });
    expect(panel.textContent).toContain("Current manual lifecycle step: 2. Context selected");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);

    await dispatchHostContextSnapshot({ selection: { text: "selected runner context" } });
    expect(panel.textContent).toContain("Current manual lifecycle step: 3. Prompt drafted");

    await act(async () => {
      setTextareaValue(chatInput(), "Ask model from the manual runner loop.");
    });
    expect(panel.textContent).toContain("Prompt is drafted; click Send when ready.");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("selected runner context");
    expect(browserStorageDump()).not.toContain("Ask model from the manual runner loop.");
  });

  it("shows manual runner edit apply verification phases while user actions stay explicit", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Manual runner proposal", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Manual runner proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const panel = manualRunnerPanel();
    expect(panel.textContent).toContain("Current manual lifecycle step: 5. Edit proposed/applied");
    expect(panel.textContent).toContain("Review the latest proposal card before applying.");
    await act(async () => {
      setTextareaValue(manualRunnerDraftTextarea(), "Review proposal, apply after confirmation, verify.");
    });
    expect(panel.textContent).toContain("Current manual lifecycle step: 5. Edit proposed/applied");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    expect(applyCall).toBeDefined();
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Manual runner apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });
    expect(panel.textContent).toContain("Current manual lifecycle step: 6. Verification");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);

    await act(async () => {
      findButton("Repository check").click();
    });
    const verificationCall = postMessage.mock.calls.find(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")?.[0];
    expect(verificationCall).toMatchObject({ payload: { action: "runVerificationCommand", commandId: "repository-check" } });
    await dispatchHostIdeActionResult(verificationCall.requestId, { status: "succeeded", message: "Repository check passed.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 0, durationMs: 10, outputTail: "passed", truncated: false });
    expect(panel.textContent).toContain("Current manual lifecycle step: 7. Follow-up");

    await act(async () => {
      findButton("Attach verification result to next message").click();
    });
    expect(panel.textContent).toContain("Verification output is attached as explicit one-shot context.");
    expect(browserStorageDump()).not.toContain("passed");
  });

  it("keeps no-context coding actions visible but disabled while Send is enabled", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Coding Actions");
    expect(container?.textContent).toContain("Attach active editor context first");
    expect(findButton("Explain selection").disabled).toBe(true);
    expect(findButton("Improve safely").disabled).toBe(true);
    expect(findButton("Safe edit").disabled).toBe(true);
    expect(findButton("Send").disabled).toBe(false);
  });

  it("enables Explain selection after valid selected context and fills the prompt without storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/example.ts", workspaceRelativePath: "src/example.ts", languageId: "typescript" },
      selection: { startLine: 10, startCharacter: 2, endLine: 12, endCharacter: 4, text: "function demo() { return 1; }" },
    });

    expect(findButton("Explain selection").disabled).toBe(false);
    await act(async () => {
      findButton("Explain selection").click();
    });

    expect(chatInput().value).toContain("Explain the selected code clearly");
    expect(chatInput().value).toContain("Coding action: explain_selection");
    expect(chatInput().value).toContain("Use only the attached one-shot editor context for src/example.ts (typescript), selection range 10:2-12:4.");
    expect(attachedContextToggle().checked).toBe(true);
    expect(document.activeElement).toBe(chatInput());
    expect(localSetItem).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
  });

  it("fills the safe edit prompt, sets context include, and keeps attached context one-shot after send", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/edit.ts", workspaceRelativePath: "src/edit.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 3, endCharacter: 1, text: "const value = 1;" },
    });

    await act(async () => {
      findButton("Safe edit").click();
    });

    expect(chatInput().value).toContain("Propose a safe edit for the selected code");
    expect(chatInput().value).toContain("Coding action: propose_safe_edit");
    expect(chatInput().value).toContain("Nothing is applied automatically");
    expect(chatInput().value).toContain("explicit user confirmation");
    expect(attachedContextToggle().checked).toBe(true);

    await act(async () => {
      findButton("Send").click();
    });
    await flushAsync();

    const body = lastUserMessageBody();
    expect(body.payload?.context).toMatchObject({ file: { workspaceRelativePath: "src/edit.ts" } });
    expect(container?.textContent).toContain("Context attached to the last accepted message from vscode src/edit.ts.");
    expect(attachedContextToggleOptional()).toBeUndefined();
  });

  it("fills stable coding action markers for issue, improve, and tests prompts", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/example.ts", workspaceRelativePath: "src/example.ts", languageId: "typescript" },
      selection: { startLine: 10, startCharacter: 2, endLine: 12, endCharacter: 4, text: "function demo() { return 1; }" },
    });

    await act(async () => {
      findButton("Find issue").click();
    });
    expect(chatInput().value).toContain("Coding action: find_issue");
    expect(chatInput().value).toContain("Review the selected code for likely bugs");

    await act(async () => {
      findButton("Improve safely").click();
    });
    expect(chatInput().value).toContain("Coding action: improve_selection");
    expect(chatInput().value).toContain("Suggest a focused improvement for the selected code");

    await act(async () => {
      findButton("Generate tests").click();
    });
    expect(chatInput().value).toContain("Coding action: generate_tests");
    expect(chatInput().value).toContain("Generate focused tests for the selected code");
  });

  it("renders Agent activity IDE actions panel in browser mode without privileged posting", async () => {
    const postMessage = vi.fn();
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Agent activity · IDE actions");
    expect(container?.textContent).toContain("browser unsupported");
    expect(container?.textContent).toContain("idle");
    expect(findDetails("ide-actions-compact-details").open).toBe(false);
    findDetails("ide-actions-compact-details").open = true;
    expect(container?.textContent).toContain("No controlled IDE action requested yet.");
    expect(container?.textContent).toContain("Safe local navigation/context actions only.");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Get IDE context");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("shows browser active-file excerpt host-required copy without posting host action", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Active file excerpt");
    expect(container?.textContent).toContain("IDE host required");
    expect(container?.textContent).toContain("Standalone browser cannot read your editor, attach active files, search snippets, apply edits, or run IDE verification. Use VS Code/JetBrains for excerpts; include only chosen prompt text.");
    expect(buttonsNamed("Attach active file excerpt")).toHaveLength(0);
    expect(browserStorageDump()).not.toContain("Active file excerpt");
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("requests a VS Code active-file excerpt only after explicit click and blocks pending duplicates", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await act(async () => {
      findButton("Active file excerpt pending…").click();
    });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-active-file-excerpt-1", payload: { action: "getActiveFileExcerpt" } });
  });

  it("fills an ask-about-active-file prompt without auto-sending or storing excerpt text", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: "export const answer = 42;" }));
    fetchMock.mockClear();

    await act(async () => {
      findButton("Ask about active file").click();
    });

    expect(chatInput().value).toContain("Coding action: ask_about_active_file");
    expect(chatInput().value).toContain("Use only the attached one-shot active-file excerpt for vscode src/editor.ts (typescript), excerpt range 10:0-24:1.");
    expect(chatInput().value).toContain("Do not read hidden files, run tools, or apply changes automatically.");
    expect(activeFileExcerptToggle().checked).toBe(true);
    expect(document.activeElement).toBe(chatInput());
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("export const answer");
  });

  it("keeps selection coding actions disabled for excerpt-only context", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: "export const answer = 42;" }));

    expect(findButton("Ask about active file").disabled).toBe(false);
    expect(findButton("Explain selection").disabled).toBe(true);
    expect(findButton("Improve safely").disabled).toBe(true);
    expect(findButton("Safe edit").disabled).toBe(true);
    expect(findButton("Send").disabled).toBe(false);
  });

  it("renders active-file excerpt preview, respects omit toggle, sends once, and clears after accepted send", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: "export const answer = 42;" }));

    expect(container?.textContent).toContain("Active file excerpt");
    expect(container?.textContent).toContain("File: src/editor.ts");
    expect(container?.textContent).toContain("Excerpt range: 10:0-24:1");
    expect(container?.textContent).toContain("Excerpt characters: 25");
    expect(container?.textContent).toContain("Bounded redacted previewexport const answer = 42;");
    expect(activeFileExcerptToggle().checked).toBe(true);
    expect(container?.textContent).toContain("Real-provider active-file chat path");
    expect(container?.textContent).toContain("Use this after provider readiness says OpenAI-compatible BYOK is ready.");
    expect(findButton("Ask about active file")).toBeDefined();

    await act(async () => {
      activeFileExcerptToggle().click();
    });
    expect(activeFileExcerptToggle().checked).toBe(false);
    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "send without excerpt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    expect(lastUserMessageBody().payload).toEqual({ content: "send without excerpt" });
    expect(container?.textContent).toContain("Active file excerpt");

    await act(async () => {
      activeFileExcerptToggle().click();
    });
    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "send with excerpt once");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "send with excerpt once",
      context: {
        kind: "active_editor",
        source: "vscode",
        file: { displayPath: "src/editor.ts", workspaceRelativePath: "src/editor.ts", languageId: "typescript" },
        selection: { startLine: 10, startCharacter: 0, endLine: 24, endCharacter: 1, text: "export const answer = 42;" },
      },
    });
    expect(container?.textContent).toContain("Context attached to the last accepted message from vscode src/editor.ts.");
    expect(activeFileExcerptToggleOptional()).toBeUndefined();

    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "second message no excerpt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    expect(lastUserMessageBody().payload).toEqual({ content: "second message no excerpt" });
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("export const answer");
  });

  it("builds removes omits dedupes and clears a multi-file active excerpt bundle", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    for (let index = 0; index < 4; index += 1) {
      await act(async () => { findButton("Attach active file excerpt").click(); });
      await dispatchHostIdeActionResult(`gui-active-file-excerpt-${index + 1}`, activeFileExcerptResultPayload({ path: `src/bundle-${index}.ts`, startLine: index + 1, text: `export const bundle${index} = ${index};` }));
      await act(async () => { findButton("Add to multi-file context bundle").click(); });
    }

    expect(container?.textContent).toContain("Multi-file context bundle");
    expect(container?.textContent).toContain("4/4 excerpts");
    expect(findButton("Bundle full (4 max)").disabled).toBe(true);
    expect(codingTaskSessionPanel().textContent).toContain("active file excerpt · src/bundle-0.ts · vscode · typescript · range 1:0-15:1 · 25 chars · preview complete · redacted no");
    expect(container?.textContent).toContain("Range 1:0-15:1 · 25 chars");

    await act(async () => { findButton("Remove excerpt").click(); });
    expect(container?.textContent).toContain("Removed one excerpt from the one-shot bundle.");

    await act(async () => { findButton("Add to multi-file context bundle").click(); });
    await act(async () => { findButton("Add to multi-file context bundle").click(); });
    expect(container?.textContent).toContain("This excerpt is already in the one-shot bundle.");

    const includeToggle = Array.from(container?.querySelectorAll<HTMLInputElement>(".explicit-context-bundle-card input[type='checkbox']") ?? [])[0];
    expect(includeToggle.checked).toBe(true);
    await act(async () => { includeToggle.click(); });
    fetchMock.mockClear();
    await act(async () => { setTextareaValue(chatInput(), "send without bundle"); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });
    const omittedBody = lastUserMessageBody() as { payload?: { context?: { kind?: string } } };
    expect(omittedBody.payload?.context?.kind).toBe("active_editor");
    expect(container?.textContent).toContain("3/4 excerpts");

    const freshIncludeToggle = Array.from(container?.querySelectorAll<HTMLInputElement>(".explicit-context-bundle-card input[type='checkbox']") ?? [])[0];
    await act(async () => { freshIncludeToggle.click(); });
    fetchMock.mockClear();
    await act(async () => { setTextareaValue(chatInput(), "send with explicit bundle"); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });

    const body = lastUserMessageBody() as { payload?: { context?: { kind?: string; items?: unknown[] } } };
    expect(body.payload?.context).toMatchObject({ kind: "explicit_context_bundle" });
    expect(body.payload?.context?.items).toHaveLength(3);
    expect(container?.textContent).toContain("One-shot explicit context bundle attached to the last accepted message and cleared.");
    expect(container?.textContent).toContain("empty");
    expect(codingTaskSessionPanel().textContent).toContain("No explicit bundle items selected");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("export const bundle");
  });

  it("keeps a bundle after failed send for retry and clears it when chat changes", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandStatus: 500, commandError: "failed safely" });
    renderApp();
    await flushAsync();

    await act(async () => { findButton("Attach active file excerpt").click(); });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: "export const retryBundle = 1;" }));
    await act(async () => { findButton("Add to multi-file context bundle").click(); });
    fetchMock.mockClear();
    await act(async () => { setTextareaValue(chatInput(), "message that fails with bundle"); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });

    expect(container?.textContent).toContain("1/4 excerpts");
    expect(chatInput().value).toBe("message that fails with bundle");
    expect(codingTaskSessionPanel().textContent).toContain("active file excerpt · src/editor.ts · vscode · typescript · range 10:0-24:1 · 29 chars · preview complete · redacted no");

    await act(async () => { findButton("Clear bundle").click(); });
    expect(container?.textContent).toContain("Cleared the one-shot explicit context bundle.");
    expect(container?.textContent).toContain("empty");
    await act(async () => { findButton("Add to multi-file context bundle").click(); });
    expect(container?.textContent).toContain("1/4 excerpts");

    await act(async () => { setInputValue(chatIdInput(), "chat-002"); });
    expect(container?.textContent).toContain("Multi-file context bundle");
    expect(container?.textContent).toContain("empty");
    expect(browserStorageDump()).not.toContain("retryBundle");
  });

  it("ignores stale active-file excerpt results after chat switch", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: "stale excerpt should not render" }));

    expect(container?.textContent).not.toContain("stale excerpt should not render");
    expect(activeFileExcerptToggleOptional()).toBeUndefined();
  });

  it("rejects unsafe active-file excerpt host results before rendering or storing raw text", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "q".repeat(64);
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: `const token = "${rawSecret}";` }));

    expect(container?.textContent).toContain("Attach active file excerpt: pending");
    expect(container?.textContent).toContain("Rejected invalid host bridge message");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("q".repeat(64));
    expect(activeFileExcerptToggleOptional()).toBeUndefined();
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("lets users clear pending active-file excerpt state after an invalid host result and retry", async () => {
    const postMessage = vi.fn();
    const rawSecret = "access_token=" + "r".repeat(64);
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Attach active file excerpt").click();
    });
    await dispatchHostIdeActionResult("gui-active-file-excerpt-1", activeFileExcerptResultPayload({ text: `const token = "${rawSecret}";` }));

    expect(findButton("Active file excerpt pending…").disabled).toBe(true);
    expect(findButton("Clear pending active-file excerpt")).toBeDefined();
    expect(container?.textContent).not.toContain("access_token");

    await act(async () => {
      findButton("Clear pending active-file excerpt").click();
    });

    expect(container?.textContent).toContain("Cleared pending IDE action state in the GUI only. No host-side cancellation was requested.");
    expect(findButton("Attach active file excerpt").disabled).toBe(false);

    await act(async () => {
      findButton("Attach active file excerpt").click();
    });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(2);
    expect(ideActionMessages[1]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-active-file-excerpt-2", payload: { action: "getActiveFileExcerpt" } });
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("sends unique bounded JetBrains IDE action requests and blocks pending duplicate clicks", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("bridge jetbrains");
    expect(container?.textContent).toContain("JetBrains controlled actions");
    expect(findButton("Get IDE context")).toBeTruthy();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await act(async () => {
      findButton("IDE action pending…").click();
    });

    const ideActionMessages = postIntellijMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-ide-action-1", payload: { action: "getContextSnapshot" } });
    expect(ideActionMessages[0].requestId.length).toBeLessThanOrEqual(128);
    expect(postIntellijMessage.mock.calls.some(([message]) => message?.type === "gui.applyWorkspaceEditRequest")).toBe(false);
  });

  it("sends unique bounded VS Code IDE action requests and blocks pending duplicate clicks", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await act(async () => {
      findButton("IDE action pending…").click();
    });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-ide-action-1", payload: { action: "getContextSnapshot" } });
    expect(ideActionMessages[0].requestId.length).toBeLessThanOrEqual(128);
    expect(container?.textContent).toContain("Get IDE context: pending");
  });

  it("correlates VS Code IDE action progress and result while ignoring stale results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 2, startCharacter: 1, endLine: 2, endCharacter: 5, text: "main" },
    });
    await act(async () => {
      findButton("Reveal range").click();
    });
    await dispatchHostIdeActionProgress("gui-ide-action-1", { phase: "running", status: "inProgress", summary: "Revealing workspace range.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts" });
    await dispatchHostIdeActionResult("stale-ide-action", { status: "failed", message: "Stale result ignored.", cloudRequired: false, action: "revealWorkspaceRange" });
    expect(container?.textContent).toContain("Ignored stale IDE action result.");
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Revealed workspace range.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 2, character: 1 }, end: { line: 2, character: 5 } } });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages[0].payload).toEqual({ action: "revealWorkspaceRange", workspaceRelativePath: "src/main.ts", range: { start: { line: 2, character: 1 }, end: { line: 2, character: 5 } } });
    expect(container?.textContent).toContain("Reveal range: succeeded");
    expect(container?.textContent).toContain("Revealed workspace range.");
    expect(container?.textContent).not.toContain("Ignored stale IDE action result.");
    expect(container?.textContent).not.toContain("Stale result ignored.");
  });

  it("renders JetBrains IDE action progress and context result metadata", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await dispatchHostIdeActionProgress("gui-ide-action-1", { phase: "running", status: "inProgress", summary: "Reading IDE context.", cloudRequired: false, action: "getContextSnapshot" });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot", context: { source: "jetbrains", hasActiveEditor: true, workspaceFolderCount: 1 } });

    expect(container?.textContent).toContain("Get IDE context: succeeded");
    expect(container?.textContent).toContain("Result context: source jetbrains · active editor present yes · workspace folders 1");
  });

  it("redacts secret-like active editor preview text from the DOM", async () => {
    const postMessage = vi.fn();
    const rawSecret = "sk-proj-1234567890abcdef";
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 2, startCharacter: 1, endLine: 2, endCharacter: 5, text: `const apiKey = "${rawSecret}";` },
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Bounded preview");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain(rawSecret);
  });

  it("renders browser read-only IDE action proposal without posting a request", async () => {
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/example.ts", summary: "Open the example file." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Browser proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Browser proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("Read-only IDE action proposal");
    expect(container?.textContent).toContain("Open the example file.");
    expect(container?.textContent).toContain("Proposal id: gui-ide-proposal-");
    expect(container?.querySelector(".ide-action-proposal-card")?.textContent ?? "").not.toContain("Request:");
    expect(container?.textContent).toContain("Browser preview only. No IDE action will be posted.");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Run read-only IDE action");
  });

  it("runs JetBrains read-only IDE action proposal only after click", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "JetBrains proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "JetBrains proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    expect(container?.textContent).toContain("Read-only IDE action proposal");
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });

    const ideActionMessages = postIntellijMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-ide-proposal-action-1", payload: { action: "getContextSnapshot" } });
    expect(postIntellijMessage.mock.calls.some(([message]) => message?.type === "gui.applyWorkspaceEditRequest")).toBe(false);
  });

  it("renders VS Code read-only IDE action proposal and does not auto-post", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "revealWorkspaceRange", workspaceRelativePath: "src/example.ts", range: testRange(), summary: "Reveal the example range." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "VS Code proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "VS Code proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
  });

  it("rejects assistant active-file excerpt proposals as not runnable and posts no request", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "getActiveFileExcerpt", summary: "Attach active file excerpt." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Unsafe excerpt proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Unsafe excerpt proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Read-only IDE action proposal");
    expect(buttonsNamed("Run read-only IDE action")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
  });

  it("renders read-only coding session trace entries without browser storage", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "t".repeat(64);
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await dispatchRuntimeStatus(runtimeStatusPayload({ diagnosis: `connected ${rawSecret}` }));
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/trace.ts", workspaceRelativePath: "src/trace.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5, text: "trace" },
    });
    await act(async () => {
      findButton("Get IDE context").click();
    });
    await dispatchHostIdeActionProgress("gui-ide-action-1", { phase: "running", status: "inProgress", summary: `Reading context ${rawSecret}`, cloudRequired: false, action: "getContextSnapshot" });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Context ready.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });
    await act(async () => {
      findButton("Repository check").click();
    });
    await dispatchHostIdeActionProgress("gui-verification-command-2", { phase: "running", status: "inProgress", summary: "Running repository check.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check" });
    await dispatchHostIdeActionResult("gui-verification-command-2", { status: "succeeded", message: "Repository check passed.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 0, durationMs: 10, outputTail: "passed", truncated: false });

    await act(async () => {
      const details = findDetails("coding-session-trace-details");
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const trace = findDetails("coding-session-trace-details").textContent ?? "";
    expect(trace).toContain("Coding session trace");
    expect(trace).toContain("read-only");
    expect(trace).toContain("Active editor context received");
    expect(trace).toContain("IDE action requested");
    expect(trace).toContain("IDE action result received");
    expect(trace).toContain("Verification command requested");
    expect(trace).toContain("Verification result received");
    expect(trace).not.toContain("t".repeat(64));
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("repository-check");
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("renders rejected proposal and lifecycle diagnostics as sanitized bounded trace summaries", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "z".repeat(64);
    const unsafeIdeProposal = ideActionProposal({ action: "shell", summary: "Run local shell safely.", command: `npm test ${rawSecret}`, requestId: rawSecret });
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Unsafe trace", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Unsafe trace", [chatMessage("chat-001", "assistant-unsafe-ide", "assistant", JSON.stringify(unsafeIdeProposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "auth_mismatch", tokenState: "mismatch", diagnosis: `runtime rejected `, nextAction: `Refresh without ` }));
    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "auth_mismatch", tokenState: "mismatch", diagnosis: "runtime rejected current local credentials", nextAction: "Refresh runtime after mismatch." }));
    await act(async () => {
      const details = findDetails("coding-session-trace-details");
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    const text = container?.textContent ?? "";
    const trace = findDetails("coding-session-trace-details").textContent ?? "";
    expect(text).toContain("IDE action proposal rejected");
    expect(text).not.toContain("npm test");
    expect(text).not.toContain(rawSecret);
    expect(trace).toContain("IDE action proposal rejected");
    expect(trace).toContain("The assistant must not supply an IDE action request id.");
    expect(trace).toContain("Runtime lifecycle status received");
    expect(trace).not.toContain("npm test");
    expect(trace).not.toContain("access_token");
    expect(trace).not.toContain("z".repeat(64));
    expect(trace.length).toBeLessThan(9000);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("renders browser verification commands as preview-only without posting", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent).toContain("Verification commands");
    expect(container?.textContent).toContain("browser preview only");
    expect(container?.textContent).toContain("Browser preview only. Open Yet AI in VS Code or JetBrains to request allowlisted verification commands.");
    expect(findButton("Repository check").disabled).toBe(true);
    expect(findButton("GUI app tests").disabled).toBe(true);
    expect(findButton("Engine chat tests").disabled).toBe(true);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("verification output");
  });

  it("requests a VS Code verification command only after explicit click and blocks pending duplicates", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
    await act(async () => {
      findButton("Repository check").click();
    });
    await act(async () => {
      findButton("Repository check").click();
    });

    const messages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-verification-command-1", payload: { action: "runVerificationCommand", commandId: "repository-check" } });
    expect(container?.textContent).toContain("Run verification command: pending");
  });

  it("renders sanitized verification command results and ignores stale duplicate results", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("GUI app tests").click();
    });
    await dispatchHostIdeActionProgress("gui-verification-command-1", { phase: "running", status: "inProgress", summary: "Running GUI tests.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests" });
    await dispatchHostIdeActionResult("stale-verification", { status: "failed", message: "Stale verification should not render.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 1, durationMs: 1, outputTail: "stale output", truncated: false });
    expect(container?.textContent).toContain("Ignored stale IDE action result.");
    await dispatchHostIdeActionResult("gui-verification-command-1", { status: "succeeded", message: "GUI tests passed.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 0, durationMs: 1234, outputTail: "vitest passed\nall cozy", truncated: false });
    await dispatchHostIdeActionResult("gui-verification-command-1", { status: "failed", message: "Duplicate verification should not render.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 1, durationMs: 2, outputTail: "duplicate output", truncated: false });

    const text = container?.textContent ?? "";
    expect(text).toContain("Run verification command: succeeded");
    expect(text).toContain("GUI tests passed.");
    expect(text).toContain("Command id: gui-app-tests");
    expect(text).toContain("Exit code: 0");
    expect(text).toContain("Duration: 1234 ms");
    expect(text).toContain("vitest passed");
    expect(text).toContain("Output truncated: no");
    expect(text).toContain("Ignored duplicate IDE action result.");
    expect(text).not.toContain("Stale verification should not render.");
    expect(text).not.toContain("Duplicate verification should not render.");
    expect(text).not.toContain("duplicate output");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("vitest passed");
  });

  it("drafts verification follow-up and fix prompts inertly without auto-send run apply attach or storage", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Repository check").click();
    });
    await dispatchHostIdeActionResult("gui-verification-command-1", { status: "failed", message: "Repository check failed.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 1, durationMs: 42, outputTail: "test failure summary\nexpected true to be false", truncated: false });
    fetchMock.mockClear();
    postMessage.mockClear();

    await act(async () => {
      findButton("Draft verification follow-up prompt").click();
    });

    expect(chatInput().value).toContain("Verification follow-up prompt");
    expect(chatInput().value).toContain("Command id: repository-check");
    expect(chatInput().value).toContain("Status: failed");
    expect(chatInput().value).toContain("Exit code: 1");
    expect(chatInput().value).toContain("test failure summary");
    expect(chatInput().value).toContain("Do not apply edits, run commands, attach context, save memory, or send anything automatically.");
    expect(document.activeElement).toBe(chatInput());
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(container?.textContent).not.toContain("Verification output is attached as explicit one-shot context.");
    expect(browserStorageDump()).not.toContain("test failure summary");

    await act(async () => {
      findButton("Draft verification fix prompt").click();
    });

    expect(chatInput().value).toContain("Verification fix prompt");
    expect(chatInput().value).toContain("Propose a safe edit only");
    expect(chatInput().value).toContain("Raw command output is intentionally omitted from this fix draft.");
    expect(chatInput().value).not.toContain("test failure summary");
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" || message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("test failure summary");

    await act(async () => {
      findButton("Attach verification result to next message").click();
    });
    expect(container?.textContent).toContain("Verification output is attached as explicit one-shot context.");
    expect(codingTaskSessionPanel().textContent).toContain("Context budget summary");
    expect(codingTaskSessionPanel().textContent).toContain("Explicit context bundle: included · 1 item");
    expect(codingTaskSessionPanel().textContent).toContain("Included: 1 item");
  });

  it("rejects unsafe verification output before rendering or storing it", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "v".repeat(64);
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Engine chat tests").click();
    });
    await dispatchHostIdeActionResult("gui-verification-command-1", { status: "failed", message: "Engine tests failed.", cloudRequired: false, action: "runVerificationCommand", commandId: "engine-chat-tests", exitCode: 1, durationMs: 10, outputTail: `failed ${rawSecret}`, truncated: false });

    const text = container?.textContent ?? "";
    expect(text).toContain("Run verification command: pending");
    expect(text).toContain("Rejected invalid host bridge message");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("v".repeat(64));
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("rejects assistant verification command proposals as not runnable and posts no request", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "runVerificationCommand", commandId: "repository-check", summary: "Run checks." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Unsafe verification proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Unsafe verification proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Read-only IDE action proposal");
    expect(buttonsNamed("Run read-only IDE action")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
  });

  it("lets users clear a stuck VS Code proposal IDE action locally and ignores stale first host updates", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange(), summary: "Reveal the retry proposal range." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "VS Code retry proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "VS Code retry proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });

    let ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0].requestId).toBe("gui-ide-proposal-action-1");
    expect(findButton("IDE action pending…").disabled).toBe(true);
    expect(container?.textContent).toContain("Clear pending IDE action state");
    expect(buttonsNamed("Clear pending IDE action state")).toHaveLength(1);

    await act(async () => {
      findButton("Clear pending IDE action state").click();
    });

    ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(container?.textContent).toContain("Cleared pending IDE action state in the GUI only. No host-side cancellation was requested.");

    await dispatchHostIdeActionProgress("gui-ide-proposal-action-1", { phase: "running", status: "inProgress", summary: "Stale first progress should not render.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts" });
    await dispatchHostIdeActionResult("gui-ide-proposal-action-1", { status: "failed", message: "Stale first result should not render.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange() });
    expect(container?.textContent).not.toContain("Stale first progress should not render.");
    expect(container?.textContent).not.toContain("Stale first result should not render.");

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });
    ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(2);
    expect(ideActionMessages[1].requestId).toBe("gui-ide-proposal-action-2");
    expect(ideActionMessages[1].requestId).not.toBe(ideActionMessages[0].requestId);

    await dispatchHostIdeActionResult("gui-ide-proposal-action-1", { status: "failed", message: "Late stale first result should not overwrite retry.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange() });
    expect(container?.textContent).toContain("Ignored stale IDE action result.");
    await dispatchHostIdeActionResult("gui-ide-proposal-action-2", { status: "succeeded", message: "Retry result rendered.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/retry-proposal.ts", range: testRange() });

    expect(container?.textContent).toContain("Reveal range: succeeded");
    expect(container?.textContent).toContain("Retry result rendered.");
    expect(container?.textContent).not.toContain("Ignored stale IDE action result.");
    expect(container?.textContent).not.toContain("Late stale first result should not overwrite retry.");
    expect(browserStorageDump()).not.toContain("src/retry-proposal.ts");
    expect(browserStorageDump()).not.toContain("Reveal the retry proposal range.");
    expect(localSetItem.mock.calls.some((call) => call.some((value) => String(value).includes("src/retry-proposal.ts") || String(value).includes("Reveal the retry proposal range.")))).toBe(false);
  });

  it("renders valid assistant IDE proposal as review-only card without raw JSON or auto-posting", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/compact-proposal.ts", summary: "Open compact proposal file." });
    const rawJson = JSON.stringify(proposal);
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Compact proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Compact proposal", [chatMessage("chat-001", "assistant-1", "assistant", rawJson)]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const initialText = container?.textContent ?? "";
    expect(initialText).not.toContain(rawJson);
    expect(initialText).not.toContain('"type":"assistant.ideActionProposal"');
    expect(initialText).toContain("Read-only IDE action proposal");
    expect(initialText).toContain("Open compact proposal file.");
    expect(initialText).toContain("Review this assistant-proposed read-only navigation/context action before running.");
    expect(initialText).toContain("Edit proposal detected but rejected");
    expect(buttonsNamed("Inspect proposal JSON")).toHaveLength(0);
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("compact-proposal");
  });

  it("renders review-only proposal card for persisted assistant proposal with missing status", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/statusless-proposal.ts", summary: "Open statusless proposal file." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Statusless proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Statusless proposal", [chatMessageWithoutStatus("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Read-only IDE action proposal");
    expect(text).toContain("Open statusless proposal file.");
    expect(text).toContain("Review this assistant-proposed read-only navigation/context action before running.");
    expect(text).toContain("Edit proposal detected but rejected");
    expect(buttonsNamed("Inspect proposal JSON")).toHaveLength(0);
    expect(findButton("Run read-only IDE action").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
  });

  it.each([
    [ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." }), { action: "getContextSnapshot" }],
    [ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/example.ts", summary: "Open the example file." }), { action: "openWorkspaceFile", workspaceRelativePath: "src/example.ts" }],
    [ideActionProposal({ action: "revealWorkspaceRange", workspaceRelativePath: "src/example.ts", range: testRange(), summary: "Reveal the example range." }), { action: "revealWorkspaceRange", workspaceRelativePath: "src/example.ts", range: testRange() }],
  ])("posts one GUI-owned VS Code request for proposal variant %#", async (proposal, expectedPayload) => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Variant proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Variant proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Run read-only IDE action").click();
    });

    const ideActionMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest");
    expect(ideActionMessages).toHaveLength(1);
    expect(ideActionMessages[0].requestId).toMatch(/^gui-ide-proposal-action-\d+$/);
    expect(ideActionMessages[0].requestId.length).toBeLessThanOrEqual(128);
    expect(ideActionMessages[0].payload).toEqual(expectedPayload);
  });

  it("blocks duplicate proposal clicks while pending", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Duplicate proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Duplicate proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const runButton = findButton("Run read-only IDE action");
    await act(async () => {
      runButton.click();
      runButton.click();
    });

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(1);
    expect(findButton("IDE action pending…").disabled).toBe(true);
  });

  it("renders older proposal as rejected edit-like compact copy and no runnable card when followed by normal assistant message", async () => {
    const valid = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Normal latest", 2)], chatThreads: {
      "chat-001": chatThread("chat-001", "Normal latest", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(valid)), chatMessage("chat-001", "assistant-2", "assistant", "Normal assistant response.")]),
    } });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Edit proposal detected but rejected. Review the rejection card below; no apply action is available.");
    expect(text).toContain("Normal assistant response.");
    expect(container?.querySelector(".ide-action-proposal-card")?.textContent ?? "").toBe("");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Run read-only IDE action");
  });

  it("clears stale read-only proposal card when latest assistant message is invalid", async () => {
    const valid = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    const invalid = { ...valid, requestId: "assistant-supplied" };
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Stale proposal", 2)], chatThreads: {
      "chat-001": chatThread("chat-001", "Stale proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(valid)), chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(invalid))]),
    } });
    renderApp();
    await flushAsync();
    await flushAsync();
    expect(container?.textContent ?? "").toContain("Edit proposal detected but rejected. Review the rejection card below; no apply action is available.");
    expect(container?.textContent ?? "").not.toContain("Read-only IDE action proposal");
  });

  it("updates the review-only proposal card when the same message receives changed proposal content", async () => {
    const first = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/first.ts", summary: "Open first file." });
    const second = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/second.ts", summary: "Open second file." });
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, { ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Changed proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Changed proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(first))]) } });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent ?? "").toContain("Open first file.");
    expect(container?.textContent ?? "").not.toContain('"workspaceRelativePath": "src/first.ts"');
    expect(buttonsNamed("Inspect proposal JSON")).toHaveLength(0);

    await act(async () => {
      setTextareaValue(chatInput(), "trigger sse for proposal update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();
    expect(sseController).toBeDefined();

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: "chat-001", payload: { messages: [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(second))] } })}\n\n`));
      await Promise.resolve();
    });
    await flushAsync();

    const changedText = container?.textContent ?? "";
    expect(changedText).toContain("Read-only IDE action proposal");
    expect(changedText).toContain("Open second file.");
    expect(changedText).not.toContain("Open first file.");
    expect(changedText).not.toContain('"workspaceRelativePath": "src/first.ts"');
    expect(changedText).not.toContain('"workspaceRelativePath": "src/second.ts"');
    expect(buttonsNamed("Inspect proposal JSON")).toHaveLength(0);
  });

  it("correlates proposal action host progress and result in Agent activity", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Correlated action", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Correlated action", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();
    await act(async () => { findButton("Run read-only IDE action").click(); });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.ideActionRequest")?.[0].requestId;

    await dispatchHostIdeActionProgress(requestId, { phase: "running", status: "inProgress", summary: "Reading active editor context.", cloudRequired: false, action: "getContextSnapshot" });
    expect(container?.textContent ?? "").toContain("Get IDE context: inProgress");
    expect(container?.textContent ?? "").toContain("Reading active editor context.");
    await dispatchHostIdeActionResult(requestId, { status: "succeeded", message: "Context snapshot ready.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });
    expect(container?.textContent ?? "").toContain("Get IDE context: succeeded");
    expect(container?.textContent ?? "").toContain("Context snapshot ready.");
    expect(container?.textContent ?? "").toContain("Result context: source vscode · active editor present yes · workspace folders 1");
  });

  it("renders safe successful openWorkspaceFile result metadata", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/open-target.ts", workspaceRelativePath: "src/open-target.ts", languageId: "typescript" },
    });
    await act(async () => { findButton("Open file").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Opened workspace file.", cloudRequired: false, action: "openWorkspaceFile", workspaceRelativePath: "src/open-target.ts" });

    const text = container?.textContent ?? "";
    expect(text).toContain("Open file: succeeded");
    expect(text).toContain("Result path: src/open-target.ts");
  });

  it("renders safe successful revealWorkspaceRange result metadata", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/reveal-target.ts", workspaceRelativePath: "src/reveal-target.ts", languageId: "typescript" },
      selection: { startLine: 4, startCharacter: 2, endLine: 4, endCharacter: 9, text: "target" },
    });
    await act(async () => { findButton("Reveal range").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Revealed workspace range.", cloudRequired: false, action: "revealWorkspaceRange", workspaceRelativePath: "src/reveal-target.ts", range: { start: { line: 4, character: 2 }, end: { line: 4, character: 9 } } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Reveal range: succeeded");
    expect(text).toContain("Result path: src/reveal-target.ts · result range: 4:2-4:9");
  });

  it("does not render forbidden IDE action result metadata rejected by bridge validation", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/rejected-open.ts", workspaceRelativePath: "src/rejected-open.ts", languageId: "typescript" },
    });
    await act(async () => { findButton("Open file").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "rejected", message: "Open rejected.", cloudRequired: false, action: "openWorkspaceFile", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Open file: pending");
    expect(text).toContain("Rejected invalid host bridge message");
    expect(text).not.toContain("Result context:");
    expect(text).not.toContain("Open rejected.");
  });

  it("notes duplicate result for the current completed IDE action request without re-rendering payload", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => { findButton("Get IDE context").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "First context result rendered.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "failed", message: "Duplicate result should not render.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Get IDE context: succeeded");
    expect(text).toContain("First context result rendered.");
    expect(text).toContain("Ignored duplicate IDE action result.");
    expect(text).not.toContain("Duplicate result should not render.");
  });

  it("does not render old-chat IDE action progress or results after direct chat id change", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Check current IDE context." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Chat A", 1), chatSummary("chat-002", "Chat B", 0)], chatThreads: {
      "chat-001": chatThread("chat-001", "Chat A", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
      "chat-002": chatThread("chat-002", "Chat B", []),
    } });
    renderApp();
    await flushAsync();
    await flushAsync();
    await act(async () => { findButton("Run read-only IDE action").click(); });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.ideActionRequest")?.[0].requestId;

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await flushAsync();
    expect(container?.textContent ?? "").toContain("Agent activity · IDE actions");
    expect(findDetails("ide-actions-compact-details").open).toBe(false);
    findDetails("ide-actions-compact-details").open = true;
    expect(container?.textContent ?? "").toContain("No controlled IDE action requested yet.");

    await dispatchHostIdeActionProgress(requestId, { phase: "running", status: "inProgress", summary: "Old chat progress should not show.", cloudRequired: false, action: "getContextSnapshot" });
    await dispatchHostIdeActionResult(requestId, { status: "succeeded", message: "Old chat result should not show.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    const text = container?.textContent ?? "";
    expect(text).toContain("Agent activity · IDE actions");
    expect(text).toContain("No controlled IDE action requested yet.");
    expect(text).not.toContain("Old chat progress should not show.");
    expect(text).not.toContain("Old chat result should not show.");
    expect(text).not.toContain("Get IDE context: succeeded");
    expect(text).not.toContain("Ignored stale IDE action");
  });

  it("does not render old-chat duplicate IDE action results after direct chat id change", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Chat A", 0), chatSummary("chat-002", "Chat B", 0)], chatThreads: { "chat-001": chatThread("chat-001", "Chat A", []), "chat-002": chatThread("chat-002", "Chat B", []) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => { findButton("Get IDE context").click(); });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: "Original chat result rendered.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });
    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await flushAsync();
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "failed", message: "Old chat duplicate should not render.", cloudRequired: false, action: "getContextSnapshot", context: { source: "vscode", hasActiveEditor: true, workspaceFolderCount: 1 } });

    expect(container?.textContent ?? "").toContain("Agent activity · IDE actions");
    expect(findDetails("ide-actions-compact-details").open).toBe(false);
    findDetails("ide-actions-compact-details").open = true;
    const text = container?.textContent ?? "";
    expect(text).toContain("No controlled IDE action requested yet.");
    expect(text).not.toContain("Old chat duplicate should not render.");
    expect(text).not.toContain("Ignored duplicate IDE action result.");
  });

  it("bounds completed IDE action request tracking to a fixed small limit", () => {
    const completed = new Map<string, string>();
    for (let index = 0; index < completedIdeActionRequestChatsLimit + 5; index += 1) {
      rememberCompletedIdeActionRequest(completed, `request-${index}`, "chat-001");
    }

    expect(completed.size).toBe(completedIdeActionRequestChatsLimit);
    expect(completed.has("request-0")).toBe(false);
    expect(completed.has(`request-${completedIdeActionRequestChatsLimit + 4}`)).toBe(true);
  });

  it("does not write proposal data to browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = ideActionProposal({ action: "openWorkspaceFile", workspaceRelativePath: "src/no-storage.ts", summary: "Open no storage file." });
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Storage proposal", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Storage proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Open no storage file.");
    expect(browserStorageDump()).not.toContain("src/no-storage.ts");
  });

  it("rejects secret-like IDE action results before App renders unsafe payload or stores it", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "i".repeat(64);
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Get IDE context").click();
    });
    await dispatchHostIdeActionResult("gui-ide-action-1", { status: "succeeded", message: `Opened /Users/alice/private/file.ts ${rawSecret}`, cloudRequired: false, action: "getContextSnapshot", privatePath: "/Users/alice/private/file.ts", token: rawSecret });

    expect(container?.textContent).toContain("Get IDE context: pending");
    expect(container?.textContent).toContain("Rejected invalid host bridge message");
    expect(container?.textContent).not.toContain("/Users/alice");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("i".repeat(64));
    expect(localSetItem.mock.calls.some((call) => call.some((value) => String(value).includes(rawSecret)))).toBe(false);
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("renders valid host.contextSnapshot preview with default include toggle", async () => {
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 10, startCharacter: 2, endLine: 12, endCharacter: 8, text: "function greet() {\n  return \"hello\";\n}" },
    });

    expect(container?.textContent).toContain("Active editor context");
    expect(container?.textContent).toContain("src/main.ts · 10:2-12:8 · 38 chars");
    expect(container?.textContent).toContain("Attach to next message");
    const details = findDetails("attached-context-active-details");
    expect(details.open).toBe(false);
    details.open = true;
    expect(container?.textContent).toContain("Source host: vscode");
    expect(container?.textContent).toContain("File: src/main.ts");
    expect(container?.textContent).toContain("Language: typescript");
    expect(container?.textContent).toContain("Selection range: 10:2-12:8");
    expect(container?.textContent).toContain("Bounded previewfunction greet()");
    expect(container?.textContent).toContain("Selected characters: 38");
    expect(container?.textContent).toContain("one-shot and is attached only to the next accepted message while enabled");
    expect(attachedContextToggle().checked).toBe(true);
  });

  it("renders chat-first empty state for attached editor context", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { text: "const answer = 42;" },
    });

    expect(container?.textContent).toContain("Ready to ask about src/main.ts.");
    expect(container?.textContent).toContain("Send through GPT-4o mini (openai-api), or turn off attached context before sending.");
  });


  it("lets the user turn off attached context inclusion", async () => {
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({ selection: { text: "selected safe text" } });

    expect(attachedContextToggle().checked).toBe(true);
    await act(async () => {
      attachedContextToggle().click();
    });

    expect(attachedContextToggle().checked).toBe(false);
    expect(container?.textContent).toContain("Do not attach");
  });

  it("shows safe no-context status for missing or invalid context", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    expect(findDetails("attached-context-compact-details").open).toBe(false);
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          version: bridgeVersion,
          type: "host.contextSnapshot",
          payload: {
            kind: "active_editor",
            source: "vscode",
            file: { workspaceRelativePath: "/Users/alice/project/src/secret.ts" },
            edit: { replaceRange: true },
          },
        },
      }));
    });

    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(container?.textContent).toContain("Rejected invalid host bridge message");
    expect(container?.textContent).not.toContain("replaceRange");
    expect(container?.textContent).not.toContain("/Users/alice");
    expect(attachedContextToggleOptional()).toBeUndefined();
  });

  it("redacts secret-like context preview and bridge logs", async () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/session.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 10, text: `const token = "${rawSecret}"; Cookie: session=context-secret` },
    });

    expect(container?.textContent).toContain("Bounded previewconst token = \"[redacted]");
    expect(container?.textContent).toContain("Host message host.contextSnapshot");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("s".repeat(64));
    expect(container?.textContent).not.toContain("context-secret");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("does not send secret-like selected text context without acknowledgement", async () => {
    const rawSecret = "access_token=" + "s".repeat(64);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: `const token = "${rawSecret}";` } });

    expect(container?.textContent).toContain("Context preview requires acknowledgement");
    expect(container?.textContent).toContain("Selected text preview was redacted");
    expect(attachedContextToggle().checked).toBe(false);
    expect(attachedContextToggle().disabled).toBe(true);
    expect(container?.textContent).not.toContain(rawSecret);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "send without secret context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "send without secret context" });
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("sends gated selected text context only after explicit acknowledgement and attach on user Send", async () => {
    const rawSecret = "access_token=" + "a".repeat(64);
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: `const token = "${rawSecret}";` } });
    fetchMock.mockClear();

    await act(async () => {
      attachedContextAcknowledgementToggle().click();
    });
    expect(attachedContextToggle().disabled).toBe(false);
    await act(async () => {
      attachedContextToggle().click();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      setTextareaValue(chatInput(), "send acknowledged context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "send acknowledged context",
      context: {
        kind: "active_editor",
        source: "vscode",
        selection: { text: `const token = "${rawSecret}";` },
      },
    });
  });

  it("bounds huge attached context previews", async () => {
    const repeated = "safe context preview ";
    const hugeSelection = repeated.repeat(350);
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      file: { displayPath: "src/huge.ts", workspaceRelativePath: "src/huge.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 200, endCharacter: 0, text: hugeSelection },
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Selected characters: 7350");
    expect((text.match(/safe context preview/g) ?? []).length).toBeLessThan(30);
    expect(text.length).toBeLessThan(20000);
    expect(text).toContain("Selected text preview was shortened");
    expect(attachedContextToggle().checked).toBe(false);
  });

  it("keeps acknowledgement-required selected context from enabling coding actions", async () => {
    const rawSecret = "access_token=" + "u".repeat(64);
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: `const token = "${rawSecret}";` } });

    expect(container?.textContent).toContain("Context preview requires acknowledgement");
    expect(findButton("Explain selection").disabled).toBe(true);
    await act(async () => {
      attachedContextAcknowledgementToggle().click();
    });
    expect(attachedContextToggle().disabled).toBe(false);
    expect(findButton("Explain selection").disabled).toBe(false);
  });

  it("resets gated context acknowledgement when context payload changes", async () => {
    const firstSecret = "access_token=" + "f".repeat(64);
    const secondSecret = "access_token=" + "g".repeat(64);
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: `first ${firstSecret}` } });
    await act(async () => {
      attachedContextAcknowledgementToggle().click();
    });
    await act(async () => {
      attachedContextToggle().click();
    });
    expect(attachedContextAcknowledgementToggle().checked).toBe(true);
    expect(attachedContextToggle().checked).toBe(true);

    await dispatchHostContextSnapshot({ selection: { text: `second ${secondSecret}` } });

    expect(attachedContextAcknowledgementToggle().checked).toBe(false);
    expect(attachedContextToggle().checked).toBe(false);
    expect(attachedContextToggle().disabled).toBe(true);
  });

  it("sends attached context when valid and included", async () => {
    const contextText = "selected safe context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({
      file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
      selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 21, text: contextText },
    });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello with included context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.type).toBe("user_message");
    expect(body.payload).toEqual({
      content: "hello with included context",
      context: {
        kind: "active_editor",
        source: "vscode",
        file: { displayPath: "src/main.ts", workspaceRelativePath: "src/main.ts", languageId: "typescript" },
        selection: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 21, text: contextText },
      },
    });
    expect(body.payload).not.toHaveProperty("providerId");
    expect(body.payload).not.toHaveProperty("modelId");
  });

  it("renders and sends valid JetBrains attached context once when included", async () => {
    const contextText = "val greeting = \"hello\"";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({
      source: "jetbrains",
      file: { displayPath: "src/Main.kt", workspaceRelativePath: "src/Main.kt", languageId: "kotlin" },
      selection: { startLine: 7, startCharacter: 4, endLine: 7, endCharacter: 26, text: contextText },
    });

    expect(container?.textContent).toContain("Active editor context");
    expect(container?.textContent).toContain("jetbrains");
    expect(container?.textContent).toContain("File: src/Main.kt");
    expect(container?.textContent).toContain("Language: kotlin");
    expect(container?.textContent).toContain("Selection range: 7:4-7:26");
    expect(container?.textContent).toContain("Bounded previewval greeting");
    expect(attachedContextToggle().checked).toBe(true);
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello with JetBrains context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "hello with JetBrains context",
      context: {
        kind: "active_editor",
        source: "jetbrains",
        file: { displayPath: "src/Main.kt", workspaceRelativePath: "src/Main.kt", languageId: "kotlin" },
        selection: { startLine: 7, startCharacter: 4, endLine: 7, endCharacter: 26, text: contextText },
      },
    });
    expect(container?.textContent).toContain("Context attached to the last accepted message from jetbrains src/Main.kt.");
    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();

    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "second JetBrains message without old context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "second JetBrains message without old context" });
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("does not send JetBrains attached context when the include toggle is disabled", async () => {
    const contextText = "disabled JetBrains context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ source: "jetbrains", selection: { text: contextText } });
    await act(async () => {
      attachedContextToggle().click();
    });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "send without JetBrains context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "send without JetBrains context" });
    expect(container?.textContent).toContain("Active editor context");
    expect(attachedContextToggleOptional()).toBeDefined();
    expect(attachedContextToggle().checked).toBe(false);
    expect(container?.textContent).not.toContain("Context attached to the last accepted message");
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("redacts secret-like JetBrains selection text from preview logs and storage", async () => {
    const rawSecret = "access_token=" + "j".repeat(64);
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses();
    renderApp();

    await dispatchHostContextSnapshot({
      source: "jetbrains",
      file: { displayPath: "src/Main.kt", languageId: "kotlin" },
      selection: { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 12, text: `val token = "${rawSecret}" Cookie: session=jetbrains-secret` },
    });

    expect(container?.textContent).toContain("jetbrains");
    expect(container?.textContent).toContain("Bounded previewval token = \"[redacted]");
    expect(container?.textContent).toContain("Host message host.contextSnapshot");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("j".repeat(64));
    expect(container?.textContent).not.toContain("jetbrains-secret");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("sends valid attached context once and clears preview for the next message", async () => {
    const contextText = "one shot selected context";
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "first message with context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const firstBody = lastUserMessageBody();
    expect(firstBody.payload).toEqual({
      content: "first message with context",
      context: {
        kind: "active_editor",
        source: "vscode",
        selection: { text: contextText },
      },
    });
    expect(container?.textContent).toContain("Context attached to the last accepted message from vscode active editor.");
    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();

    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "second message without old context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: "second message without old context" });
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("does not send attached context when the include toggle is disabled", async () => {
    const contextText = "attached text disabled";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    await act(async () => {
      attachedContextToggle().click();
    });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello without context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.type).toBe("user_message");
    expect(body.payload).toEqual({ content: "hello without context" });
    expect(container?.textContent).toContain("Active editor context");
    expect(attachedContextToggleOptional()).toBeDefined();
    expect(attachedContextToggle().checked).toBe(false);
    expect(container?.textContent).not.toContain("Context attached to the last accepted message");
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("keeps attached context and include toggle after a failed command for retry", async () => {
    const contextText = "retry selected context";
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandStatus: 500, commandError: "command failed safely" });
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "message that fails");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Bounded previewretry selected context");
    expect(attachedContextToggle().checked).toBe(true);

    mockRuntimeResponses(readyRuntimeOptions());
    fetchMock.mockClear();
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({
      content: "message that fails",
      context: {
        kind: "active_editor",
        source: "vscode",
        selection: { text: contextText },
      },
    });
  });

  it("does not let stale chat command success clear newer attached context after chat change", async () => {
    const oldCommand = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: "old in-flight context" } });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/chats/chat-001/commands") {
        return oldCommand.promise;
      }
      return mockRuntimeResponse(input, init, readyRuntimeOptions());
    });

    await act(async () => {
      setTextareaValue(chatInput(), "old in-flight message");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
      await Promise.resolve();
    });
    await dispatchHostContextSnapshot({ selection: { text: "new chat context" } });

    oldCommand.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "old-request", type: "user_message" }));
    await flushAsync();

    expect(container?.textContent).toContain("Bounded previewnew chat context");
    expect(attachedContextToggle().checked).toBe(true);
    expect(container?.textContent).not.toContain("Command accepted old-request");
  });

  it("clears attached context on runtime settings changes so stale context is not sent", async () => {
    const contextText = "old runtime selected context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    expect(attachedContextToggleOptional()).toBeDefined();

    await act(async () => {
      setInputValue(sessionTokenInput(), "new-runtime-token");
    });
    await flushAsync();

    expect(container?.textContent).toContain("Attached context");
    expect(container?.textContent).toContain("not attached");
    findDetails("attached-context-compact-details").open = true;
    expect(container?.textContent).toContain("No valid active editor context is attached. Nothing will be included with the next message.");
    expect(attachedContextToggleOptional()).toBeUndefined();
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello after settings change");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.payload).toEqual({ content: "hello after settings change" });
    expect(browserStorageDump()).not.toContain(contextText);
  });

  it("clears attached context on chat changes so stale context is not sent", async () => {
    const contextText = "old chat selected context";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    await dispatchHostContextSnapshot({ selection: { text: contextText } });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
    });

    expect(attachedContextToggleOptional()).toBeUndefined();
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "hello in new chat");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody();
    expect(body.payload).toEqual({ content: "hello in new chat" });
  });
});

describe("chat panel", () => {
  it("uses adaptive chat workbench structure with composer pinned outside the scroll region", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = ideActionProposal({ action: "getContextSnapshot", summary: "Inspect context." });
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-alpha", "Alpha thread", 2), chatSummary("chat-beta", "Beta thread", 1)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [
          chatMessage("chat-alpha", "msg-1", "user", "Hello layout"),
          chatMessage("chat-alpha", "msg-2", "assistant", JSON.stringify(proposal)),
        ]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    const workbench = container?.querySelector(".chat-workbench");
    const threadPane = container?.querySelector(".chat-thread-pane");
    const scrollRegion = container?.querySelector(".chat-scroll-region");
    const composer = container?.querySelector(".chat-composer");
    const composers = container?.querySelectorAll(".chat-composer");
    const list = container?.querySelector(".conversation-list");
    expect(workbench).toBeTruthy();
    expect(threadPane).toBeTruthy();
    expect(scrollRegion).toBeTruthy();
    expect(composer).toBeTruthy();
    expect(composers).toHaveLength(1);
    expect(list).toBeTruthy();
    expect(scrollRegion?.contains(composer ?? null)).toBe(false);
    expect(Array.from(threadPane?.children ?? []).map((child) => child.className)).toEqual([
      "chat-title-card chat-compact-header row",
      "debug-details",
      "chat-scroll-region",
      "chat-composer",
      "debug-details chat-secondary-debug",
    ]);
    expect(threadPane?.classList.contains("chat-thread-pane")).toBe(true);
    expect(getComputedStyle(composer as Element).position).not.toBe("sticky");
    expect(scrollRegion?.textContent).toContain("Hello layout");
    expect(scrollRegion?.querySelector(".ide-action-proposal-card")?.textContent).toContain("Inspect context.");
    expect(list?.querySelectorAll(".conversation-item")).toHaveLength(2);
    expect(container?.querySelectorAll("#delete-current-conversation-help-rail")).toHaveLength(1);
    expect(container?.querySelectorAll("#delete-current-conversation-help-drawer")).toHaveLength(1);
    expect(container?.querySelector("[aria-describedby='delete-current-conversation-help-rail']")).toBeTruthy();
    expect(composer?.textContent).toContain("Coding Actions");
    expect(composer?.textContent).toContain("Attached context");
    expect(composer?.querySelector(".composer-tools")?.textContent).toContain("Coding Actions");
    expect(composer?.querySelector(".composer-input-area textarea")).toBeTruthy();
    expect(composer?.querySelector(".composer-input-area")?.textContent).toContain("Send");
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("opens the compact chats drawer and closes it after selecting a chat", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-1", "user", "Alpha message")]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-2", "assistant", "Beta answer")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    const drawer = () => container?.querySelector<HTMLElement>(".conversations-drawer");
    expect(drawer()?.classList.contains("open")).toBe(false);
    expect(drawer()?.hidden).toBe(true);
    await act(async () => {
      findButton("Chats").click();
    });
    expect(drawer()?.classList.contains("open")).toBe(true);
    expect(drawer()?.hidden).toBe(false);
    expect(drawer()?.querySelector("[aria-describedby='delete-current-conversation-help-drawer']")).toBeTruthy();

    const betaInDrawer = Array.from(drawer()?.querySelectorAll<HTMLButtonElement>("button.conversation-select") ?? []).find((button) => /Open conversation: Beta thread/.test(button.getAttribute("aria-label") ?? ""));
    expect(betaInDrawer).toBeTruthy();
    await act(async () => {
      betaInDrawer?.click();
      await Promise.resolve();
    });
    await flushAsync();

    expect(drawer()?.classList.contains("open")).toBe(false);
    expect(drawer()?.hidden).toBe(true);
    expect(container?.textContent).toContain("Beta answer");
  });

  it("loads conversation list after runtime refresh", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 2), chatSummary("chat-beta", "Beta thread", 2)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-1", "user", "Persisted alpha")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("Conversations");
    expect(container?.textContent).toContain("Alpha thread");
    expect(container?.textContent).toContain("Beta thread");
    expect(container?.textContent).toContain("2 local runtime conversations returned.");
    expect(container?.textContent).toContain("Updated 2026-05-29T07:16:30Z");
    expect(container?.textContent).toContain("2 persisted messages");
    expect(container?.textContent).toContain("active conversation");
    expectConversationRowParts("Alpha thread", {
      updated: "Updated 2026-05-29T07:16:30Z",
      messages: "1 persisted message",
      position: "Conversation 1 of 2",
    });
    expectConversationRowParts("Beta thread", {
      updated: "Updated 2026-05-29T07:16:30Z",
      messages: "2 persisted messages",
      position: "Conversation 2 of 2",
    });
  });

  it("renders conversation empty and loading states", async () => {
    const chats = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        return chats.promise;
      }
      return mockRuntimeResponse(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Loading local runtime conversations…");
    expect(container?.textContent).toContain("Loading saved conversations from the local runtime…");

    chats.resolve(jsonResponse({ chats: [] }));
    await flushAsync();

    expect(container?.textContent).toContain("No local runtime conversations returned.");
    expect(container?.textContent).toContain("No saved conversations remain. The prompt is ready for a fresh local chat, and nothing is written to browser storage.");
    expect(chatInput().value).toBe("");
  });

  it("ignores stale chat list after settings change and clears loading state", async () => {
    const oldChats = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        if (url.startsWith("http://127.0.0.1:8001")) {
          return oldChats.promise;
        }
        return Promise.resolve(jsonResponse({ chats: [] }));
      }
      return mockRuntimeResponse(input, init, readyRuntimeOptions());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("Loading local runtime conversations…");

    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    oldChats.resolve(jsonResponse({ chats: [chatSummary("chat-stale", "Stale old list title", 1)] }));
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).not.toContain("Stale old list title");
    expect(container?.textContent).toContain("No local runtime conversations returned.");
    expect(container?.textContent).not.toContain("Loading local runtime conversations…");
  });

  it("ignores stale chat lists after create and delete attempts", async () => {
    const staleInitialList = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        return staleInitialList.promise;
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        createChatThread: chatThread("chat-created", "Created current", []),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("Loading…").click();
      await Promise.resolve();
    });
    staleInitialList.resolve(jsonResponse({ chats: [chatSummary("chat-stale-list", "Stale list after create", 1)] }));
    await flushAsync();

    expect(container?.textContent).toContain("chat-created");
    expect(container?.textContent).not.toContain("Stale list after create");

    const staleDeleteList = deferred<Response>();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats") && init?.method !== "POST") {
        return staleDeleteList.promise;
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-created", "Created current", 0)],
      });
    });
    await act(async () => {
      findButton("Refresh runtime").click();
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });
    staleDeleteList.resolve(jsonResponse({ chats: [chatSummary("chat-deleted-stale", "Deleted stale sentinel", 1)] }));
    await flushAsync();

    expect(container?.textContent).toContain("Selected Deleted stale sentinel because the previous chat is not in this local runtime list.");
    expect(browserStorageDump()).not.toContain("Deleted stale sentinel");
  });

  it("creates a new chat and selects it", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-old", "Old thread", 1)],
      createChatThread: chatThread("chat-created", "Created thread", []),
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      findButton("New chat").click();
      await Promise.resolve();
    });

    expect(findInputValue("chat-created")).toBeDefined();
    expect(container?.textContent).toContain("chat-created");
    expect(container?.textContent).toContain("current");
    expect(container?.textContent).toContain("0 persisted messages");
    expect(chatInput().value).toBe("");
  });

  it("switches chats and renders persisted messages", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 2)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-a", "user", "Alpha persisted")]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-b1", "user", "Beta prompt"), chatMessage("chat-beta", "msg-b2", "assistant", "Beta answer")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();
    await act(async () => {
      findConversationButton(/Open conversation: Beta thread/).click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Beta prompt");
    expect(container?.textContent).toContain("Beta answer");
    expect(container?.textContent).not.toContain("Alpha persisted");
  });

  it("deletes a chat and safely selects a fallback", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-a", "user", "Alpha persisted")]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-b", "user", "Beta persisted")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => button.textContent === "Delete current")?.click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Deleted Alpha thread. Selected Beta thread.");
    expect(container?.textContent).toContain("Beta thread");
    expect(findInputValue("chat-beta")).toBeDefined();
  });

  it("resets to a fresh local state after deleting the last current chat", async () => {
    mockRuntimeResponses({
      chats: [chatSummary("chat-solo", "Solo thread", 1)],
      chatThreads: {
        "chat-solo": chatThread("chat-solo", "Solo thread", [chatMessage("chat-solo", "msg-solo", "user", "Solo persisted")]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });

    expect(findInputValue("chat-001")).toBeDefined();
    expect(container?.textContent).toContain("No local runtime conversations returned.");
    expect(container?.textContent).toContain("fresh local chat");
    expect(container?.textContent).not.toContain("Solo persisted");
  });

  it("hydrates current chat from SSE snapshot without duplicate optimistic messages", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: { messages: [chatMessage("chat-001", "msg-user", "user", "Snapshot prompt"), chatMessage("chat-001", "msg-assistant", "assistant", "Snapshot answer")] } },
      ],
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "Snapshot prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.querySelectorAll(".chat-bubble")[0]?.textContent).toContain("Snapshot prompt");
    expect((container?.querySelectorAll(".chat-bubble")[0]?.textContent?.match(/Snapshot prompt/g) ?? [])).toHaveLength(1);
    expect(container?.textContent).toContain("Snapshot answer");
  });

  it("does not persist chat history content or secret-like messages to browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const secret = "sk-chat-history-secret";
    mockRuntimeResponses({
      chats: [chatSummary("chat-secret", "Secret thread", 1)],
      chatThreads: {
        "chat-secret": chatThread("chat-secret", "Secret thread", [chatMessage("chat-secret", "msg-secret", "user", `secret ${secret}`)]),
      },
    });
    renderApp();

    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain(secret);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("browser storage remains free after create switch and delete", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const runtimeToken = "history-runtime-token-secret";
    const providerKey = "sk-history-provider-secret";
    const deletedSentinel = "deleted-chat-storage-sentinel";
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      createChatThread: chatThread("chat-created", "Created thread", [chatMessage("chat-created", "msg-created", "user", providerKey)]),
      chatThreads: {
        "chat-alpha": chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-alpha", "user", deletedSentinel)]),
        "chat-beta": chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-beta", "user", "Beta visible")]),
      },
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(findInputValue("")!, runtimeToken);
    });
    await act(async () => {
      findConversationButton(/Open conversation: Beta thread/).click();
      await Promise.resolve();
    });
    await act(async () => {
      findButton("New chat").click();
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(runtimeToken);
    expect(browserStorageDump()).not.toContain(providerKey);
    expect(browserStorageDump()).not.toContain(deletedSentinel);
  });

  it("ignores stale chat thread responses after chat selection changes", async () => {
    const alphaThread = deferred<Response>();
    mockRuntimeResponses({ chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)] });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats/chat-alpha")) {
        return alphaThread.promise;
      }
      if (url.endsWith("/v1/chats/chat-beta")) {
        return Promise.resolve(jsonResponse(chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-b", "user", "Beta current")] )));
      }
      return mockRuntimeResponse(input, init, { chats: [chatSummary("chat-alpha", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)] });
    });

    await act(async () => {
      setInputValue(chatIdInput(), "chat-alpha");
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(chatIdInput(), "chat-beta");
      await Promise.resolve();
    });
    alphaThread.resolve(jsonResponse(chatThread("chat-alpha", "Alpha thread", [chatMessage("chat-alpha", "msg-a", "user", "Alpha stale secret")] )));
    await flushAsync();

    expect(container?.textContent).toContain("Beta current");
    expect(container?.textContent).not.toContain("Alpha stale secret");
  });

  it("ignores in-flight thread load after deleting the current chat", async () => {
    const oldThread = deferred<Response>();
    mockRuntimeResponses({
      chats: [chatSummary("chat-old", "Old thread", 1), chatSummary("chat-next", "Next thread", 0)],
      chatThreads: {
        "chat-next": chatThread("chat-next", "Next thread", []),
      },
    });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/chats/chat-old") && init?.method !== "DELETE") {
        return oldThread.promise;
      }
      return mockRuntimeResponse(input, init, {
        chats: [chatSummary("chat-old", "Old thread", 1), chatSummary("chat-next", "Next thread", 0)],
        chatThreads: {
          "chat-next": chatThread("chat-next", "Next thread", []),
        },
      });
    });
    await act(async () => {
      setInputValue(chatIdInput(), "chat-old");
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });
    oldThread.resolve(jsonResponse(chatThread("chat-old", "Old thread", [chatMessage("chat-old", "msg-old", "user", "deleted stale thread secret")] )));
    await flushAsync();

    expect(findInputValue("chat-next")).toBeDefined();
    expect(container?.textContent).not.toContain("deleted stale thread secret");
    expect(container?.textContent).not.toContain("Old thread");
  });

  it("delete current active chat aborts old stream and ignores later SSE", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Current stream", 1), chatSummary("chat-next", "Next thread", 0)],
        chatThreads: {
          "chat-next": chatThread("chat-next", "Next thread", []),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream then delete");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      findButton("Delete current").click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 3, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "late deleted chat stream secret" } } })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain("late deleted chat stream secret");
    expect(container?.textContent).toContain("Next thread");
  });

  it("ignores active SSE events from an old chat after switching conversations", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/chats/chat-beta")) {
        return Promise.resolve(jsonResponse(chatThread("chat-beta", "Beta thread", [chatMessage("chat-beta", "msg-beta", "user", "Beta current")] )));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Alpha thread", 1), chatSummary("chat-beta", "Beta thread", 1)],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "old chat stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      findConversationButton(/Open conversation: Beta thread/).click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 1, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "stale old chat stream text" } } })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Beta current");
    expect(container?.textContent).not.toContain("stale old chat stream text");
  });

  it("shows guided OpenAI API fallback CTA when runtime is connected with no provider", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Chat readiness");
    expect(container?.textContent).toContain("0 enabled providers");
    expect(container?.textContent).toContain("Runtime connected — choose the first-message path");
    expect(container?.textContent).toContain("Browser standalone local model: choose Ollama local for a direct engine call to http://127.0.0.1:11434, confirm a pulled model id, save, test provider, refresh runtime/model readiness, then send.");
    expect(container?.textContent).toContain("No API key, hosted Yet AI service, account, managed gateway, product credits, or cloud workspace is required.");
    expect(container?.textContent).toContain("Hosted BYOK provider: use OpenAI API-key fallback or another OpenAI-compatible /v1 endpoint, paste a provider API key once when required, save, test provider, refresh runtime/model readiness, then send.");
    expect(container?.textContent).toContain("OpenAI API-key fallback is the current safe/default real-provider path for first-message GPT; provider setup stays local-first BYOK with no Yet AI hosted backend, account, cloud workspace, or credit balance required.");
    expect(container?.textContent).toContain("State: Provider required");
    expect(container?.textContent).toContain("Provider required: choose Demo Mode for a no-key local canned trial, or configure a BYOK provider/model such as local Ollama or OpenAI-compatible for real answers. No production account login is required.");
    expect(container?.textContent).toContain("For the quickest real-provider path, choose OpenAI API-key fallback, paste a provider API key once, save, test provider, refresh runtime/model readiness");
    expect(container?.textContent).toContain("Provider required for first message");
    expect(container?.textContent).toContain("Why: No enabled local Ollama, OpenAI-compatible, or custom provider/model is ready for chat streaming.");
    expect(container?.textContent).toContain("Next safest action: For local answers without a provider key, choose Ollama local, confirm http://127.0.0.1:11434 and a pulled model id, save, test provider, refresh runtime/model readiness, then send. For hosted OpenAI-compatible answers, use the API-key fallback. Choose Demo Mode only to try the chat flow without provider calls.");
    expect(container?.textContent).toContain("OpenAI API-key fallback is the current safe/default real-provider path for first-message GPT; provider setup stays local-first BYOK");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders chat-first empty state for provider setup", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Chat with Yet AI");
    expect(container?.textContent).toContain("Choose how this first chat should answer.");
    expect(container?.textContent).toContain("Provider credentials are sent only to the local runtime and are not stored by the GUI.");
    expect(container?.textContent).toContain("Browser standalone mode");
    expect(container?.textContent).toContain("Browser connects to a running loopback runtime, configures/tests providers, and chats with Demo Mode, Ollama, or OpenAI-compatible BYOK models.");
    expect(container?.textContent).toContain("IDE-only: editor context, excerpts, snippets, apply, and verification.");
    expect(container?.textContent).toContain("Browser uses explicit prompt/provider controls.");
    expect(container?.textContent).toContain("Browser standalone mode connects to a running loopback runtime. Enter its URL and optional Session token, then configure Demo Mode, Ollama, or OpenAI-compatible BYOK providers.");
  });


  it("connected experimental auth with no safer ready path enables experimental fallback send-ready copy", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("0 enabled providers");
    expect(text).toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
    expect(text).toContain("Experimental Codex-like OpenAI account chat is available as a fallback through the local runtime because no safer API-key, OpenAI-compatible, local, or Demo Mode path is ready.");
    expect(text).toContain("not official public OAuth support");
    expect(text).toContain("not default");
    expect(text).toContain("not production-ready");
    expect(text).toContain("Experimental fallback send ready");
    expect(text).toContain("Experimental account login can send");
    expect(text).toContain("Why: The account login fallback is connected only because no safer API-key/OpenAI-compatible, local, or Demo Mode chat path is ready; this private-endpoint path is not the safe/default provider setup.");
    expect(text).toContain("Next safest action: Prefer configuring an API-key or local provider. If you send through this experimental path and the first message fails, use the sanitized error to choose one manual action: retry login, reconnect runtime, disconnect, reduce context if the request is too large, or switch to the API-key fallback.");
    expect(text).toContain("If the first message fails through experimental account auth, review the sanitized error only: retry login, reconnect runtime, disconnect the account path, reduce attached context when the error says the request is too large, or switch to the API-key fallback.");
    expect(text).toContain("If the first message fails, use the sanitized error to retry login, reconnect runtime, disconnect, reduce context when relevant, or switch to the API-key fallback; no automatic retry or managed support is implied.");
    expect(text).not.toContain("Authorization: Bearer");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("Cookie:");
    expect(text).not.toContain("/Users/");
    expect(findButton("Send").disabled).toBe(false);
    expect(text).toContain("Account loginexperimental high-risk connected");
    expect(text).toContain("First messageSend available");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it.each(["pending", "expired", "revoked", "error"] satisfies ProviderAuthStatus[])("keeps Send disabled for non-connected experimental auth status %s", async (status) => {
    mockRuntimeResponses({ authResponse: providerAuthResponse(status) });
    renderApp();

    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain(status);
    expect(text).not.toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
    expect(text).not.toContain("Experimental account login can send");
    expect(findButton("Send").disabled).toBe(true);
    expect(browserStorageDump()).not.toContain("oauth");
  });

  it("disables Send during OAuth exchange when no API-key provider is ready", async () => {
    const exchange = deferred<Response>();
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/exchange")) {
        return exchange.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: pendingExperimentalAuthResponse() });
    });

    await act(async () => {
      setInputValue(authCodeInput(), "manual-code-mutating");
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    expect(findButton("Exchanging…").disabled).toBe(true);
    expect(container?.textContent).toContain("State: OpenAI account login changing");
    expect(findButton("Send").disabled).toBe(true);

    exchange.resolve(jsonResponse(connectedExperimentalAuthResponse()));
    await flushAsync();
  });

  it("disables Send immediately during OAuth disconnect without API-key provider readiness", async () => {
    const disconnect = deferred<Response>();
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();
    expect(findButton("Send").disabled).toBe(false);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/disconnect")) {
        return disconnect.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: providerAuthResponse("connected") });
    });

    await act(async () => {
      findButton("Disconnect login").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("State: OpenAI account login changing");
    expect(container?.textContent).not.toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
    expect(findButton("Send").disabled).toBe(true);

    disconnect.resolve(jsonResponse({ ...providerAuthResponse("not_configured"), success: true }));
    await flushAsync();
  });

  it("keeps Send enabled through API-key provider readiness while OAuth disconnects", async () => {
    const disconnect = deferred<Response>();
    mockRuntimeResponses({
      authResponse: providerAuthResponse("connected"),
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/disconnect")) {
        return disconnect.promise;
      }
      return mockRuntimeResponse(input, init, {
        authResponse: providerAuthResponse("connected"),
        providers: [enabledProvider()],
        models: [readyModel({ providerId: "openai-api" })],
      });
    });

    await act(async () => {
      findButton("Disconnect login").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(findButton("Send").disabled).toBe(false);

    disconnect.resolve(jsonResponse({ ...providerAuthResponse("api_key_configured"), success: true }));
    await flushAsync();
  });

  it("ignores stale disconnect responses after runtime settings change", async () => {
    const disconnect = deferred<Response>();
    mockRuntimeResponses({ authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/provider-auth/openai/disconnect") {
        return disconnect.promise;
      }
      return mockRuntimeResponse(input, init, { authResponse: providerAuthResponse("login_unavailable") });
    });

    await act(async () => {
      findButton("Disconnect login").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    disconnect.resolve(jsonResponse({ ...providerAuthResponse("connected"), success: true, message: "stale disconnect token response" }));
    await flushAsync();

    expect(container?.textContent).not.toContain("stale disconnect token response");
    expect(container?.textContent).not.toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
  });

  it("renders sanitized provider-auth mutation failures without raw code session token or cookie text", async () => {
    const rawCode = "manual-code-visible-secret";
    const rawToken = "access_token=" + "t".repeat(64);
    mockRuntimeResponses({ authResponse: pendingExperimentalAuthResponse() });
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/exchange")) {
        return Promise.resolve(jsonResponse({ error: `exchange failed ${rawToken} session_token=provider-login-session-001 Cookie: login-cookie-secret code=${rawCode}` }, 500));
      }
      return mockRuntimeResponse(input, init, { authResponse: pendingExperimentalAuthResponse() });
    });

    await act(async () => {
      setInputValue(authCodeInput(), rawCode);
    });
    await act(async () => {
      findButton("Exchange authorization code").click();
      await Promise.resolve();
    });

    expect(authCodeInputOptional()?.value ?? "").toBe("");
    expect(container?.textContent).toContain("exchange failed [redacted]");
    expect(container?.textContent).not.toContain(rawCode);
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("provider-login-session-001");
    expect(container?.textContent).not.toContain("login-cookie-secret");
    expect(container?.textContent).not.toContain("t".repeat(64));
    expect(browserStorageDump()).not.toContain(rawCode);
  });

  it("keeps API-key provider readiness preferred over connected experimental OAuth", async () => {
    mockRuntimeResponses({
      authResponse: providerAuthResponse("connected"),
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(container?.textContent).not.toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("disables Send when runtime model references a missing provider", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "missing-provider" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Test the saved provider, fix the provider/model id mapping locally, then Refresh runtime before sending.");
    expect(container?.textContent).toContain("Model and provider do not match");
    expect(container?.textContent).toContain("Next safest action: Test the saved provider, then refresh runtime after fixing the provider/model id.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("disables Send when runtime model references a disabled provider", async () => {
    mockRuntimeResponses({
      providers: [{ ...enabledProvider(), enabled: false }],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("0 enabled providers");
    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Test the saved provider, fix the provider/model id mapping locally, then Refresh runtime before sending.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("resolves a runtime model without provider id only when the enabled provider mapping is unambiguous", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel()],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("disables Send when a runtime model without provider id maps to multiple enabled providers", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider(), { ...enabledProvider(), id: "other-openai", displayName: "Other OpenAI" }],
      models: [readyModel()],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("2 enabled providers");
    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Test the saved provider, fix the provider/model id mapping locally, then Refresh runtime before sending.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("sanitizes secret-like provider and model labels in mismatch copy", async () => {
    const longModelSecret = "access_token=" + "m".repeat(64);
    const longProviderSecret = "refresh_token=" + "p".repeat(64);
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ id: longModelSecret, displayName: `Model ${longModelSecret}`, providerId: `provider-${longProviderSecret}` })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime model/provider mismatch");
    expect(container?.textContent).toContain("Runtime model/provider mismatch. Test the saved provider, fix the provider/model id mapping locally, then Refresh runtime before sending.");
    expect(container?.textContent).toContain("Model Model [redacted] is not available on enabled provider provider-[redacted].");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("refresh_token");
    expect(container?.textContent).not.toContain("m".repeat(64));
    expect(container?.textContent).not.toContain("p".repeat(64));
    expect(findButton("Send").disabled).toBe(true);
  });

  it.each(["pending", "expired", "revoked", "error"] satisfies ProviderAuthStatus[])("does not enable Send for %s OAuth status", async (status) => {
    mockRuntimeResponses({ authResponse: providerAuthResponse(status) });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Provider required");
    expect(container?.textContent).toContain("Provider required: choose Demo Mode for a no-key local canned trial, or configure a BYOK provider/model such as local Ollama or OpenAI-compatible for real answers. No production account login is required.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("transitions chat readiness from runtime unavailable to provider required to ready", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(container?.textContent).toContain("Connect the local runtime first");
    expect(container?.textContent).toContain("Next safest action: Use Refresh runtime from this chat page. If it still fails, fix the loopback URL or Session token in Local runtime connection.");
    expect(container?.textContent).toContain("Runtime Session token unlocks this GUI to the loopback runtime only; Provider API key unlocks the upstream model through the runtime. They are different secrets.");
    expect(container?.textContent).toContain("Browser standalone mode connects to a running loopback runtime.");
    expect(findButton("Send").disabled).toBe(true);

    mockRuntimeResponses();
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("State: Provider required");
    expect(container?.textContent).toContain("Provider required for first message");
    expect(findButton("Send").disabled).toBe(true);

    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(container?.textContent).toContain("Ready for your first message");
    expect(container?.textContent).toContain("Next safest action: Type a prompt and click Send through the local runtime.");
    expect(container?.textContent).toContain("Send available");
    expect(container?.textContent).toContain("Real providerBYOK API-key ready");
    expect(container?.textContent).toContain("First messageSend available");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("shows configured provider and first runtime model readiness", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: GPT-4o mini (openai-api)");
    expect(container?.textContent).toContain("Ready to send using GPT-4o mini through the local runtime.");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("shows native Ollama local provider readiness without browser secret storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const ollamaProvider = {
      ...enabledProvider(),
      id: "ollama-local",
      kind: "ollama",
      displayName: "Ollama Local",
      baseUrl: "http://127.0.0.1:11434",
      auth: { type: "none", configured: false },
      models: [readyModel({ id: "llama3.2", displayName: "llama3.2", providerId: "ollama-local" })],
    };
    mockRuntimeResponses({
      providers: [ollamaProvider],
      models: [readyModel({ id: "llama3.2", displayName: "llama3.2", providerId: "ollama-local" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: llama3.2 (ollama-local)");
    expect(container?.textContent).toContain("Ready to send using llama3.2 through the local runtime directly to your local provider.");
    expect(container?.textContent).toContain("Local provider ready through direct local runtime calls");
    expect(container?.textContent).toContain("Ollama Local");
    expect(container?.textContent).toContain("http://127.0.0.1:11434");
    expect(container?.textContent).toContain("Secret configured: false");
    expect(findButton("Send").disabled).toBe(false);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("ollama-local");
  });

  it("explains local provider unreachable and missing model states", async () => {
    const ollamaProvider = {
      ...enabledProvider(),
      id: "ollama-local",
      kind: "ollama",
      displayName: "Ollama Local",
      baseUrl: "http://127.0.0.1:11434",
      auth: { type: "none", configured: false },
      models: [readyModel({ id: "llama3.2", displayName: "llama3.2", providerId: "ollama-local" })],
    };
    mockRuntimeResponses({
      providers: [ollamaProvider],
      models: [readyModel({ id: "llama3.2", displayName: "llama3.2", providerId: "ollama-local", readiness: { status: "missing_model", reason: "Run ollama pull llama3.2 before sending." } })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Local Ollama model llama3.2 is not available yet. Start Ollama at the saved loopback URL, run ollama pull for this model or choose an installed local model, Test provider, then Refresh runtime. Runtime detail: Run ollama pull llama3.2 before sending.");
    expect(container?.textContent).toContain("Model is not ready yet");
    expect(findButton("Send").disabled).toBe(true);

    await act(async () => {
      findButton("Test provider").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Provider test succeeded");
    expect(container?.textContent).toContain("Local runtime reached the provider. For Ollama, missing model errors mean the model id was not pulled locally yet.");
  });

  it("requires ready chat streaming model metadata before enabling Send", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model status: GPT-4o mini (OpenAI API): ready; chat supported, streaming supported, tools unsupported, reasoning unsupported");
    expect(container?.textContent).toContain("Model readiness: GPT-4o mini (OpenAI API): ready; chat supported, streaming supported, tools unsupported, reasoning unsupported");
    expect(findButton("Send").disabled).toBe(false);
  });

  it("disables Send for unready models with sanitized visible status", async () => {
    const rawSecret = "access_token=" + "u".repeat(64);
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api", readiness: { status: "missing_credentials", reason: `Provider login failed ${rawSecret}` } })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Provider credentials are required before GPT-4o mini can send. Save the provider API key or local credential in the local runtime, then Test provider and Refresh runtime. If the provider rejected the key, replace the provider key there; do not use the runtime Session token. Runtime detail: Provider login failed [redacted]");
    expect(container?.textContent).toContain("Model status: GPT-4o mini (OpenAI API): missing credentials, Provider login failed [redacted]");
    expect(container?.textContent).toContain("Model is not ready yet");
    expect(container?.textContent).toContain("Next safest action: Test the provider, fix credentials/model readiness locally, then refresh runtime.");
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("u".repeat(64));
    expect(findButton("Send").disabled).toBe(true);
  });

  it("disables Send for models without chat or streaming capabilities", async () => {
    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api", capabilities: { chat: false, streaming: true, tools: false, reasoning: false } })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model GPT-4o mini cannot send chat because required capabilities are unavailable: chat unsupported, streaming supported, tools unsupported, reasoning unsupported.");
    expect(findButton("Send").disabled).toBe(true);

    mockRuntimeResponses({
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api", capabilities: { chat: true, streaming: false, tools: false, reasoning: false } })],
    });
    await act(async () => {
      findButton("Refresh runtime").click();
    });

    expect(container?.textContent).toContain("Model GPT-4o mini cannot send chat because required capabilities are unavailable: chat supported, streaming unsupported, tools unsupported, reasoning unsupported.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("does not treat older model responses without readiness metadata as send-ready", async () => {
    mockRuntimeResponses({
      providers: [{ ...enabledProvider(), models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini" }] }],
      models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini", providerId: "openai-api" }],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Model GPT-4o mini is missing readiness metadata from the local runtime. Refresh runtime after updating it; if this persists, test the provider before sending.");
    expect(container?.textContent).toContain("Model status: GPT-4o mini (OpenAI API): readiness metadata missing");
    expect(findButton("Send").disabled).toBe(true);
  });


  it("disables Send when provider and model data exists but runtime connectivity fails", async () => {
    mockRuntimeResponses({
      runtimeFailure: true,
      providers: [enabledProvider()],
      models: [readyModel({ providerId: "openai-api" })],
    });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("runtime error");
    expect(container?.textContent).toContain("1 enabled provider");
    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(container?.textContent).toContain("Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("renders chat-first empty state for runtime connection", async () => {
    mockRuntimeResponses({ runtimeFailure: true });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("Start here: connect the local runtime.");
    expect(container?.textContent).toContain("no hosted Yet AI backend, account, cloud workspace, or credit balance is required.");
  });


  it("disables experimental OAuth Send when runtime connectivity fails", async () => {
    mockRuntimeResponses({ runtimeFailure: true, authResponse: providerAuthResponse("connected") });
    renderApp();

    await flushAsync();

    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(container?.textContent).toContain("Runtime is not connected yet. Refresh runtime or start the IDE-managed local runtime, then return here to send.");
    expect(findButton("Send").disabled).toBe(true);
  });

  it("sending message renders user bubble and clears input after accepted command", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Hello Yet AI");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("You");
    expect(container?.textContent).toContain("Hello Yet AI");
    expect(chatInput().value).toBe("");
  });

  it("sends multiline coding action prompts unchanged without browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const prompt = "Coding action: propose_safe_edit\n\nPropose a safe edit for the selected code. Nothing is applied automatically.";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), prompt);
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(lastUserMessageBody().payload).toEqual({ content: prompt });
    expect(container?.textContent).toContain("Coding action: propose_safe_edit");
    expect(chatInput().value).toBe("");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(prompt);
  });

  it("ignores stale chat command success after runtime settings change", async () => {
    const oldCommand = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/chats/chat-001/commands") {
        return oldCommand.promise;
      }
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        return Promise.resolve(sseResponse([]));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setTextareaValue(chatInput(), "old runtime question");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });
    await act(async () => {
      setTextareaValue(chatInput(), "new runtime draft");
    });

    oldCommand.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "old-request", type: "user_message" }));
    await flushAsync();

    expect(container?.textContent).not.toContain("old runtime question");
    expect(container?.textContent).not.toContain("Command accepted old-request");
    expect(chatInput().value).toBe("new runtime draft");
  });

  it("ignores stale chat command failure after chat id change", async () => {
    const oldCommand = deferred<Response>();
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url === "http://127.0.0.1:8001/v1/chats/chat-001/commands") {
        return oldCommand.promise;
      }
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        return Promise.resolve(sseResponse([]));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await act(async () => {
      setTextareaValue(chatInput(), "old chat question");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
      await Promise.resolve();
    });

    oldCommand.resolve(jsonResponse({ error: "old chat failed Authorization: Bearer old-secret" }, 500));
    await flushAsync();

    expect(container?.textContent).not.toContain("old chat failed");
    expect(container?.textContent).not.toContain("Command error");
    expect(container?.textContent).not.toContain("old-secret");
    expect(container?.textContent).toContain("Ready for your first local conversation.");
  });

  it("blocks programmatic submit while Send is disabled without opening SSE or posting a command", async () => {
    mockRuntimeResponses();
    renderApp();

    await flushAsync();
    fetchMock.mockClear();

    await act(async () => {
      setTextareaValue(chatInput(), "Blocked message");
    });
    await act(async () => {
      chatInput().closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Chat is not ready for the current runtime settings. Refresh runtime and configure a provider/model before sending.");
    expect(container?.textContent).toContain("Recovery: configure and test a local BYOK provider/model, refresh runtime readiness, then send again.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/chats/subscribe"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/v1/chats/") && String(url).endsWith("/commands") && init?.method === "POST")).toBe(false);
    expect(chatInput().value).toBe("Blocked message");
  });

  it("renders assistant streaming text from SSE events", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        { seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Hello" } } },
        { seq: 3, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: " from Yet AI" } } },
        { seq: 4, type: "stream_finished", chatId: "chat-001", payload: {} },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Stream please");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Yet AI");
    expect(container?.textContent).toContain("Hello from Yet AI");
  });

  it("renders first assistant response from terminal message_added after one Send", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        {
          seq: 2,
          type: "message_added",
          chatId: "chat-001",
          payload: {
            message: chatMessage("chat-001", "assistant-terminal-1", "assistant", "Terminal message_added answer after first send."),
          },
        },
        { seq: 3, type: "stream_finished", chatId: "chat-001", payload: { finishReason: "stop" } },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Terminal event please");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Terminal event please");
    expect(container?.textContent).toContain("Terminal message_added answer after first send.");
    expect(chatLifecycleText()).toBe("Ready to send.");
    expect(chatLifecycleText()).not.toContain("waiting");
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(1);
  });

  it("renders consecutive identical terminal message_added assistant responses after their user prompts", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const commands = [deferred<Response>(), deferred<Response>()];
    let commandIndex = 0;
    let nextSeq = 0;
    const enqueueSseEvent = (type: string, payload: Record<string, unknown> = {}) => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: nextSeq, type, chatId: "chat-001", payload })}\n\n`));
      nextSeq += 1;
    };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (init?.method === "POST" && url.endsWith("/v1/chats/chat-001/commands")) {
        const body = JSON.parse(String(init.body)) as { type?: string };
        if (body.type === "user_message") {
          const command = commands[commandIndex];
          commandIndex += 1;
          return command.promise;
        }
        return mockRuntimeResponse(input, init, readyRuntimeOptions());
      }
      return mockRuntimeResponse(input, init, readyRuntimeOptions());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "First terminal prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/v1/chats/subscribe"))).toBe(false);
    await act(async () => {
      commands[0].resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: "user_message" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      enqueueSseEvent("snapshot");
      enqueueSseEvent("stream_started");
      enqueueSseEvent("message_added", { message: chatMessage("chat-001", "assistant-terminal-1", "assistant", "Demo Mode canned response.") });
      enqueueSseEvent("stream_finished", { finishReason: "stop" });
      await Promise.resolve();
    });
    expect(chatLifecycleText()).toBe("Ready to send.");

    await act(async () => {
      setTextareaValue(chatInput(), "Second terminal prompt");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      enqueueSseEvent("stream_started");
      enqueueSseEvent("message_added", { message: chatMessage("chat-001", "assistant-terminal-2", "assistant", "Demo Mode canned response.") });
      enqueueSseEvent("stream_finished", { finishReason: "stop" });
      await Promise.resolve();
    });

    let bubbles = Array.from(container?.querySelectorAll(".chat-bubble") ?? []).map((bubble) => bubble.textContent ?? "");
    expect(bubbles.filter((text) => text.includes("Demo Mode canned response."))).toHaveLength(2);
    const secondPromptIndexBeforeAck = bubbles.findIndex((text) => text.includes("Second terminal prompt"));
    let secondResponseIndexBeforeAck = -1;
    bubbles.forEach((text, index) => {
      if (text.includes("Demo Mode canned response.")) {
        secondResponseIndexBeforeAck = index;
      }
    });
    expect(secondPromptIndexBeforeAck).toBeGreaterThan(-1);
    expect(secondPromptIndexBeforeAck).toBeLessThan(secondResponseIndexBeforeAck);

    await act(async () => {
      commands[1].resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-002", type: "user_message" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    bubbles = Array.from(container?.querySelectorAll(".chat-bubble") ?? []).map((bubble) => bubble.textContent ?? "");
    expect(chatLifecycleText()).toBe("Ready to send.");
    expect(bubbles).toEqual(expect.arrayContaining([
      expect.stringContaining("First terminal prompt"),
      expect.stringContaining("Second terminal prompt"),
    ]));
    expect(bubbles.filter((text) => text.includes("Demo Mode canned response."))).toHaveLength(2);
    expect(bubbles.findIndex((text) => text.includes("First terminal prompt"))).toBeLessThan(bubbles.findIndex((text) => text.includes("Demo Mode canned response.")));
    const lastDemoResponseIndex = bubbles.reduce((lastIndex, text, index) => text.includes("Demo Mode canned response.") ? index : lastIndex, -1);
    expect(bubbles.findIndex((text) => text.includes("Second terminal prompt"))).toBeLessThan(lastDemoResponseIndex);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(2);
  });

  it("renders visible safe error bubbles for request and SSE errors", async () => {
    const rawToken = "Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandStatus: 500, commandError: `failed ${rawToken}` });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Fail please");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Error");
    expect(container?.textContent).toContain("failed [redacted]");
    expect(container?.textContent).toContain("Recovery: Refresh runtime and resend after the local command endpoint is healthy. No automatic retry was started.");
    expect(container?.textContent).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  });

  it("stale command acceptance after chat change does not clear the current draft", async () => {
    const command = deferred<Response>();
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandResponse: command.promise });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "do not clear stale command");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
    });
    await act(async () => {
      setTextareaValue(chatInput(), "new chat draft");
    });
    command.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "stale-command", type: "user_message" }));
    await flushAsync();

    expect(chatInput().value).toBe("new chat draft");
    expect(container?.textContent).not.toContain("do not clear stale command");
    expect(container?.textContent).not.toContain("stale-command");
  });

  it("stale command failure after runtime change is ignored and sanitized", async () => {
    const secret = "stale-command-secret-token";
    const command = deferred<Response>();
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandResponse: command.promise });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stale failure message");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await act(async () => {
      setTextareaValue(chatInput(), "new runtime draft");
    });
    command.resolve(jsonResponse({ error: `late command error Bearer ${secret}` }, 500));
    await flushAsync();

    expect(chatInput().value).toBe("new runtime draft");
    expect(container?.textContent).not.toContain("late command error");
    expect(container?.textContent).not.toContain(secret);
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("redacts terminal command runtime errors before rendering", async () => {
    const apiKey = "sk-test-command-placeholder";
    const opaqueToken = "Z".repeat(64);
    const jwt = `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}`;
    const rawFragments = [
      "test-runtime-token",
      apiKey,
      "command-cookie-secret",
      "command-set-cookie-secret",
      "command-query-secret",
      "command-oauth-secret",
      "auth.json",
      opaqueToken,
      jwt,
    ];
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      commandStatus: 500,
      commandError: [
        "terminal command failed",
        "Authorization: Bearer test-runtime-token",
        apiKey,
        "Cookie: session=command-cookie-secret",
        "setCookie=sid=command-set-cookie-secret",
        "https://callback.test/return?api_key=command-query-secret",
        "oauth_refresh_token=command-oauth-secret",
        "../.codex/auth.json",
        opaqueToken,
        jwt,
      ].join("\n"),
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Fail with terminal command error");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Error");
    expect(text).toContain("terminal command failed");
    expect(text).toContain("[redacted]");
    for (const fragment of rawFragments) {
      expect(text).not.toContain(fragment);
    }
  });

  it("redacts terminal SSE error events and stops assistant streaming", async () => {
    const opaqueToken = "Y".repeat(64);
    const jwt = `${"d".repeat(16)}.${"e".repeat(16)}.${"f".repeat(16)}`;
    const rawFragments = [
      "test-runtime-token",
      "sse-api-placeholder",
      "sse-cookie-secret",
      "sse-set-cookie-secret",
      "sse-query-secret",
      "sse-oauth-secret",
      "auth.json",
      opaqueToken,
      jwt,
    ];
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_started", chatId: "chat-001", payload: {} },
        { seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Partial safe answer" } } },
        {
          seq: 3,
          type: "error",
          chatId: "chat-001",
          payload: {
            message: [
              "terminal SSE failed",
              "Authorization: Bearer test-runtime-token",
              "OPENAI_API_KEY=sse-api-placeholder",
              "Cookie: session=sse-cookie-secret",
              "setCookie=sid=sse-set-cookie-secret",
              "https://callback.test/return?api_key=sse-query-secret",
              "oauth_refresh_token=sse-oauth-secret",
              "../.codex/auth.json",
              opaqueToken,
              jwt,
            ].join("\n"),
          },
        },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Stream then terminal error");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Partial safe answer");
    expect(text).toContain("Error");
    expect(text).toContain("terminal SSE failed");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("Assistant is streaming…");
    for (const fragment of rawFragments) {
      expect(text).not.toContain(fragment);
    }
  });

  it("renders actionable sanitized provider recovery guidance from SSE error codes", async () => {
    const rawToken = "access_token=" + "g".repeat(64);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        {
          seq: 1,
          type: "error",
          chatId: "chat-001",
          payload: {
            code: "provider_context_too_large",
            message: `The request is too large ${rawToken} Cookie: session=chat-cookie`,
          },
        },
      ],
    });
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "Prompt with too much context");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("The request is too large [redacted]");
    expect(text).toContain("Recovery: reduce the prompt or attached active-file excerpt, then send again.");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("chat-cookie");
    expect(text).not.toContain("g".repeat(64));
  });

  it("changing chat id clears messages for the new chat", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), "First chat message");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("First chat message");

    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
    });

    expect(container?.textContent).not.toContain("First chat message");
    expect(container?.textContent).toContain("Ready for your first local conversation.");
  });

  it("does not write chat messages or secrets to browser storage", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const secret = "sk-chat-secret-value";
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    await act(async () => {
      setTextareaValue(chatInput(), `message ${secret}`);
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(secret);
  });

  it("Stop response with no active stream sends no abort", async () => {
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();

    await flushAsync();

    expect(() => findButton("Stop SSE")).toThrow();
    await act(async () => {
      findButton("Stop response").click();
      await Promise.resolve();
    });

    const abortCall = fetchMock.mock.calls.find(([url, init]) => {
      if (!String(url).endsWith("/v1/chats/chat-001/commands") || init?.method !== "POST") {
        return false;
      }
      const body = JSON.parse(String(init.body)) as { type?: string };
      return body.type === "abort";
    });
    expect(abortCall).toBeUndefined();
    expect(container?.textContent).toContain("SSE stopped");
  });

  it("Stop response during active streaming sends abort and removes streaming indicator", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
        return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: JSON.parse(String(init.body)).type }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream then stop");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: "chat-001", payload: {} })}\n\n`));
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 1, type: "stream_started", chatId: "chat-001", payload: {} })}\n\n`));
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 2, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "Partial" } } })}\n\n`));
      await Promise.resolve();
    });
    fetchMock.mockClear();

    expect(container?.textContent).toContain("Assistant is streaming…");
    expect(() => findButton("Stop SSE")).toThrow();

    await act(async () => {
      findButton("Stop response").click();
      await Promise.resolve();
    });

    const abortCalls = fetchMock.mock.calls.filter(([url, init]) => {
      if (!String(url).endsWith("/v1/chats/chat-001/commands") || init?.method !== "POST") {
        return false;
      }
      return (JSON.parse(String(init.body)) as { type?: string }).type === "abort";
    });
    expect(abortCalls).toHaveLength(1);
    expect(container?.textContent).not.toContain("Assistant is streaming…");
  });

  it("ignores active SSE events from old runtime settings after settings change", async () => {
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
        return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: "user_message" }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "old runtime stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 1, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "stale old runtime token" } } })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain("stale old runtime token");
  });

  it("settings changes send abort to the active stream runtime settings instead of the new runtime", async () => {
    const oldToken = "old-runtime-token";
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      if (url.endsWith("/v1/ping")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
      }
      if (url.endsWith("/v1/caps")) {
        return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
      }
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
      }
      if (url.endsWith("/v1/providers")) {
        return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
      }
      if (url.endsWith("/v1/provider-auth/openai/status")) {
        return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
      }
      if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
        return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: JSON.parse(String(init.body)).type }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), oldToken);
    });
    await act(async () => {
      setTextareaValue(chatInput(), "stream before retarget");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      setInputValue(findInputValue("http://127.0.0.1:8001")!, "http://127.0.0.1:8765");
      await Promise.resolve();
    });

    const abortCalls = fetchMock.mock.calls.filter(([url, init]) => {
      if (!String(url).includes("/v1/chats/chat-001/commands") || init?.method !== "POST") {
        return false;
      }
      return (JSON.parse(String(init.body)) as { type?: string }).type === "abort";
    });
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(new Headers(abortCalls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${oldToken}`);
    sseController?.close();
  });

  it("token-only changes abort the active stream with the old token", async () => {
    const oldToken = "old-token-only-secret";
    const stream = mockStreamingReadyRuntime();
    renderApp();

    await flushAsync();
    await act(async () => {
      setInputValue(sessionTokenInput(), oldToken);
    });
    await act(async () => {
      setTextareaValue(chatInput(), "stream before token change");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await act(async () => {
      setInputValue(sessionTokenInput(), "new-token-only-secret");
      await Promise.resolve();
    });

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(new Headers(abortCalls[0][1]?.headers).get("Authorization")).toBe(`Bearer ${oldToken}`);
    stream.close();
  });

  it("chat id changes abort the old active chat and not the new chat", async () => {
    const stream = mockStreamingReadyRuntime();
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream before chat change");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await act(async () => {
      setInputValue(findInputValue("chat-001")!, "chat-002");
      await Promise.resolve();
    });

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(String(abortCalls[0][0])).not.toContain("chat-002");
    stream.close();
  });

  it("unmount cleanup aborts the active stream without state updates or async abort error reporting", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abortFailure = deferred<Response>();
    const stream = mockStreamingReadyRuntime({ abortResponse: abortFailure.promise });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "stream before unmount");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    fetchMock.mockClear();

    await act(async () => {
      root?.unmount();
      root = undefined;
      await Promise.resolve();
    });
    abortFailure.resolve(jsonResponse({ error: "Abort failed Authorization: Bearer post-unmount-secret" }, 500));
    await flushAsync();

    const abortCalls = abortCommandCalls();
    expect(abortCalls).toHaveLength(1);
    expect(String(abortCalls[0][0])).toBe("http://127.0.0.1:8001/v1/chats/chat-001/commands");
    expect(consoleError).not.toHaveBeenCalled();
    stream.close();
  });

  it("sanitizes SSE debug timeline payloads before rendering", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "stream_delta", chatId: "chat-001", payload: { delta: { content: "safe text", accessToken: "short" }, access_token: "s".repeat(64), nested: { clientSecret: "tiny" }, header: "Authorization: Bearer short-secret", cookie: "Cookie: session=secret; refresh=also-secret", path: "../.codex/auth.json" } },
      ],
    });
    renderApp();

    await flushAsync();
    await act(async () => {
      setTextareaValue(chatInput(), "secret stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("safe text");
    expect(container?.textContent).toContain('"[redacted]": "[redacted]"');
    expect(container?.textContent).not.toContain("access_token");
    expect(container?.textContent).not.toContain("accessToken");
    expect(container?.textContent).not.toContain("clientSecret");
    expect(container?.textContent).not.toContain("tiny");
    expect(container?.textContent).not.toContain("short-secret");
    expect(container?.textContent).not.toContain("session=secret");
    expect(container?.textContent).not.toContain("auth.json");
  });
});

describe("proposal history panel", () => {
  it("renders empty proposal history without bridge or storage side effects", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    expect(container?.textContent).not.toContain("Proposal history");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Proposal history");
  });

  it("renders detected rejected applied and verified proposal metadata without new authority", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Proposal history", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Proposal history", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    let panel = proposalHistoryPanel();
    expect(panel.textContent).toContain("Total: 1");
    expect(panel.textContent).toContain("Latest: detected");
    expect(panel.textContent).toContain("Replace one visible editor line after user review.");
    expect(panel.textContent).toContain("src/example.ts");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Proposal history apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["apps/gui/src/App.tsx"] });

    panel = proposalHistoryPanel();
    expect(panel.textContent).toContain("Applied: 1");
    expect(panel.textContent).toContain("Apply metadata: applied after explicit user action");
    expect(panel.textContent).toContain("Proposal history apply result.");

    await act(async () => {
      findButton("Repository check").click();
    });
    const verificationCall = postMessage.mock.calls.find(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")?.[0];
    await dispatchHostIdeActionResult(verificationCall.requestId, { status: "succeeded", message: "Repository check passed for history.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 0, durationMs: 12, outputTail: "passed", truncated: false });

    panel = proposalHistoryPanel();
    expect(panel.textContent).toContain("Verified: 1");
    expect(panel.textContent).toContain("Verification metadata: succeeded after explicit user action");
    expect(panel.textContent).toContain("Repository check passed for history.");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Proposal history apply result");
    expect(Array.from(panel.querySelectorAll("button"))).toHaveLength(0);
  });

  it("renders rejected proposal history metadata safely", async () => {
    const rawSecret = "access_token=" + "h".repeat(64);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Rejected proposal history", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Rejected proposal history", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify({ ...safeEditProposalPayload(), requestId: rawSecret }))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const panel = proposalHistoryPanel();
    const text = panel.textContent ?? "";
    expect(text).toContain("Rejected: 1");
    expect(text).toContain("The edit proposal payload is invalid or unsafe.");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("h".repeat(64));
    expect(browserStorageDump()).not.toContain(rawSecret);
  });
});

describe("edit proposal preview", () => {
  it("renders a bounded proposal in browser mode without auto-applying or writing browser storage", async () => {
    localStorage.setItem("sentinel", "keep");
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replace one visible editor line after user review.");
    expect(text).toContain("src/example.ts");
    expect(text).toContain("Files: 1");
    expect(text).toContain("Text edits: 1");
    expect(text).toContain("Quality summary");
    expect(text).toContain("1 files · 1 replacements · total chars 23 · max chars 23");
    expect(text).toContain("preview none");
    expect(text).toContain("status browser preview only");
    expect(text).toContain("single file");
    expect(text).toContain("browser preview only");
    expect(text).toContain("Apply disabled");
    expect(text).toContain("Browser preview cannot apply. Open VS Code or JetBrains for host confirmation.");
    expect(text).toContain("const label = \"Yet AI\";");
    expect(text).toContain("Preview only in this host. Browser cannot apply proposed edits");
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in VS Code after review")).toBe(false);
    expect(browserStorageDump()).toContain("sentinel");
    expect(browserStorageDump()).not.toContain("Replace one visible editor line");
  });

  it("marks proposal metadata as local review only without counting it as sent context", async () => {
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Display-only metadata", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Display-only metadata", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Review proposal metadata only");
      setTextareaValue(chatInput(), "Review the visible safe edit proposal.");
    });

    const sentPanel = whatWillBeSentPanel();
    expect(sentPanel.textContent).toContain("Included context: 1 item · 29 chars");
    expect(sentPanel.textContent).toContain("Edit proposal metadata · Replace one visible editor line after user review.: local review metadata only · not sent · 1 item · 50 chars");
    expect(sentPanel.textContent).not.toContain("Included context: 2 items");
    expect(sentPanel.textContent).not.toContain("omitted · 1 item");

    const sessionPanel = codingTaskSessionPanel();
    expect(sessionPanel.textContent).toContain("Included: 1 item · 29 chars");
    expect(sessionPanel.textContent).toContain("Edit proposal metadata · Replace one visible editor line after user review.: local review metadata only · not sent · 1 item · 50 chars");

    fetchMock.mockClear();
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    expect(lastUserMessageBody().payload).toEqual({ content: "Review the visible safe edit proposal." });
    expect(browserStorageDump()).not.toContain("Replace one visible editor line");
  });

  it("does not leak secret-like replacement text into DOM or storage, and shows redaction warning", async () => {
    localStorage.setItem("sentinel", "keep");
    const rawToken = "sk-" + "x".repeat(40);
    const longToken = "y".repeat(64);
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: `api_key=${longToken} Bearer ${rawToken}`,
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Redacted edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Redacted edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    expect(text).not.toContain(rawToken);
    expect(text).not.toContain(longToken);
    expect(text).not.toContain("api_key=");
    expect(text).not.toContain("Bearer");
    expect(browserStorageDump()).toContain("sentinel");
    expect(browserStorageDump()).not.toContain(rawToken);
    expect(browserStorageDump()).not.toContain(longToken);
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in VS Code after review")).toBe(false);
  });

  it("disables apply for redacted replacement preview until acknowledged, then emits gui.applyWorkspaceEditRequest on click in VS Code", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const longToken = "z".repeat(64);
    const rawToken = "sk-" + "a".repeat(40);
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: `api_key=${longToken} Bearer ${rawToken}`,
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Redacted apply gated", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Redacted apply gated", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    expect(text).toContain("I understand the raw replacement text may differ from the redacted preview.");
    expect(text).toContain("preview redacted/shortened");
    expect(text).toContain("preview redacted");
    expect(text).toContain("Apply disabled");
    expect(text).toContain("Acknowledge the redacted/shortened preview before IDE apply.");
    expect(text).not.toContain(rawToken);
    expect(text).not.toContain(longToken);
    expect(text).not.toContain("api_key=");
    expect(text).not.toContain("Bearer");
    expect(browserStorageDump()).not.toContain(rawToken);
    expect(browserStorageDump()).not.toContain(longToken);

    const applyButton = findButton("Apply in VS Code after review");
    expect(applyButton.disabled).toBe(true);

    // Even if the user tries to click while disabled, no apply is emitted.
    await act(async () => {
      applyButton.click();
    });
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);

    // Acknowledge the warning; the apply button becomes enabled.
    const ack = container?.querySelector<HTMLInputElement>("[data-testid='edit-proposal-acknowledge-redaction']");
    expect(ack).not.toBeNull();
    await act(async () => {
      ack!.click();
    });
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);

    // Clicking now emits the apply request with the raw proposal text.
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
    // The raw replacement is sent only after the explicit acknowledgement and apply click.
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
  });

  it("keeps non-redacted apply enabled without acknowledgement in VS Code", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Non-redacted apply", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Non-redacted apply", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Replacement preview was redacted or shortened");
    expect(text).not.toContain("I understand the raw replacement text may differ from the redacted preview.");
    expect(container?.querySelector("[data-testid='edit-proposal-acknowledge-redaction']")).toBeNull();
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);
    expect(text).toContain("status ready for manual apply request");
    expect(text).toContain("IDE confirmation required");
    expect(container?.querySelector("[data-testid='edit-proposal-disabled-reasons']")).toBeNull();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
  });

  it("renders Agent Run panel and posts no bridge messages before explicit click", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Agent Run proposal", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run proposal", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("Agent Run · dev-preview, not autonomy");
    expect(panel.textContent).toContain("no hidden model/provider calls; manual");
    expect(panel.textContent).toContain("Manual state: Ready for manual apply");
    expect(panel.textContent).toContain("Next manual step");
    expect(panel.textContent).toContain("Review the sanitized proposal summary; apply only if you choose to continue.");
    expect(panel.textContent).toContain("Goal summary: Review latest safe edit proposal");
    expect(panel.textContent).toContain("Touched files: 1");
    expect(panel.textContent).toContain("Edit count: 1");
    expect(buttonWithin(panel, "Manually apply reviewed patch").disabled).toBe(false);
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);
  });

  it("S96 one-step Start sequences read edit and controlled verification, while Stop ignores stale read", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata() }),
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("S96 useful one-step Agent Run");
    expect(buttonWithin(panel, "Start one-step Agent Run").disabled).toBe(false);
    await act(async () => {
      buttonWithin(panel, "Start one-step Agent Run").click();
    });

    const readRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentFileReadRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    expect(readRequest).toBeDefined();
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(0);

    const readResult = controlledReadHostMessage(readRequest.requestId, readRequest.payload);
    await dispatchHostControlledFileReadResult(readResult.requestId, readResult.payload);
    const editRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentEditRequest")?.[0] as { requestId: string; payload: Record<string, any> };
    expect(editRequest).toBeDefined();

    const editResult = controlledEditHostMessage(editRequest.requestId, editRequest.payload);
    await dispatchHostControlledEditResult(editResult.requestId, editResult.payload);
    const commandRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentCommandRunRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    expect(commandRequest).toBeDefined();
    expect(commandRequest.payload).toMatchObject({ commandId: "repository-check", userConfirmed: true, requestIdMintedBy: "gui" });
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);

    const commandResult = controlledCommandRunHostMessage(commandRequest.requestId, commandRequest.payload);
    await dispatchHostControlledCommandRunResult(commandResult.requestId, commandResult.payload);
    expect(agentRunPanel().textContent).toContain("Phase: completed");

    postMessage.mockClear();
    await act(async () => {
      buttonWithin(agentRunPanel(), "Start one-step Agent Run").click();
    });
    const stoppedReadRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentFileReadRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    await act(async () => {
      buttonWithin(agentRunPanel(), "Stop one-step Agent Run").click();
    });
    const staleRead = controlledReadHostMessage(stoppedReadRequest.requestId, stoppedReadRequest.payload);
    await dispatchHostControlledFileReadResult(staleRead.requestId, staleRead.payload);

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentFileReadRequest")).toHaveLength(1);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentEditRequest")).toHaveLength(0);
    expect(agentRunPanel().textContent).toContain("Phase: stopped");
  });

  it("S96 one-step Start stays visible but fail-closed for unsupported hosts", async () => {
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata() }),
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(agentRunPanel().textContent).toContain("S96 useful one-step Agent Run");
    expect(agentRunPanel().textContent).toContain("browser preview only");
    expect(agentRunPanel().textContent).toContain("One-step controlled run Start is disabled outside VS Code and posts no bridge request.");
    expect(buttonWithin(agentRunPanel(), "Start one-step Agent Run").disabled).toBe(true);

    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;

    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady, controlledAgentEditExecutor: controlledEditMetadata() }),
    });
    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    expect(agentRunPanel().textContent).toContain("S96 useful one-step Agent Run");
    expect(agentRunPanel().textContent).toContain("JetBrains partial/fail-closed");
    expect(buttonWithin(agentRunPanel(), "Start one-step Agent Run").disabled).toBe(true);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentFileReadRequest" || message.type === "gui.controlledAgentEditRequest" || message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(0);

    await dispatchRuntimeStatus(runtimeStatusPayload({ surface: "jetbrains" }));
    await flushAsync();
    expect(document.body.textContent ?? "").toContain("Controlled host matrix: unsupported_fail_closed · read unsupported_fail_closed · edit unsupported_fail_closed · verification unsupported_fail_closed.");
  });

  it("Agent Run apply can post then controlled verification uses S85 command-run path", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "Agent Run bridge", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run bridge", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    expect(applyCall).toBeDefined();
    expect(applyCall.payload).toEqual(proposal);

    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Agent Run apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });
    const panel = agentRunPanel();
    expect(panel.textContent).toContain("Manual state: Ready for controlled verification");
    expect(panel.textContent).toContain("no legacy IDE verification request is posted from Agent Run");
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually run allowlisted verification").click();
    });

    const commandRequests = postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentCommandRunRequest");
    expect(commandRequests).toHaveLength(1);
    expect(commandRequests[0][0]).toMatchObject({
      version: bridgeVersion,
      type: "gui.controlledAgentCommandRunRequest",
      payload: {
        requestIdMintedBy: "gui",
        source: "gui",
        assistantMinted: false,
        userConfirmed: true,
        commandId: "repository-check",
        controlledWorkspaceId: "workspace-s82-demo",
        runtimeSessionId: "session-s82-demo",
        workspaceReadinessId: "controlled-workspace-s73-c1",
      },
    });
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
  });

  it("keeps browser Agent Run controlled autonomy preview-only with no controlled command request", async () => {
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "Browser Agent Run availability", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Browser Agent Run availability", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("browser preview only");
    expect(panel.textContent).toContain("Browser preview stays preview-only");
    expect(panel.textContent).toContain("Browser preview stays inert and posts no privileged action.");
    expect(buttonWithin(panel, "Manually apply reviewed patch").disabled).toBe(true);
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
  });

  it("keeps JetBrains Agent Run controlled verification fail-closed after apply", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "JetBrains Agent Run availability", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "JetBrains Agent Run availability", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();
    postIntellijMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postIntellijMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    expect(applyCall).toBeDefined();
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "JetBrains apply result metadata.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("JetBrains partial/fail-closed");
    expect(panel.textContent).toContain("Manual state: Ready for controlled verification");
    expect(panel.textContent).toContain("S85 controlled verification unsupported here");
    expect(panel.textContent).toContain("VS Code-only in S85");
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(0);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
  });

  it("Agent Run apply failure is actionable and does not auto retry", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Agent Run apply failed", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run apply failed", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "failed", message: "Repository validation failed", cloudRequired: false, appliedEditCount: 0, affectedFiles: ["src/example.ts"] });

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("Manual state: Apply failed");
    expect(panel.textContent).toContain("Apply failed after an explicit request.");
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(buttonsNamed("Draft Agent Run fix prompt")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(browserStorageDump()).not.toContain("Repository validation failed");
  });

  it("Agent Run controlled verification result failure stops without auto repair", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "Agent Run failed verify", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run failed verify", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Agent Run apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });

    expect(agentRunPanel().textContent).toContain("Manual state: Ready for controlled verification");
    expect(buttonWithin(agentRunPanel(), "Manually run allowlisted verification").disabled).toBe(false);
    expect(buttonsNamed("Draft Agent Run fix prompt")).toHaveLength(0);

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually run allowlisted verification").click();
    });
    const commandRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentCommandRunRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    const failed = controlledCommandRunHostMessage(commandRequest.requestId, commandRequest.payload, { status: "failed", exitCode: 1, message: "Checks failed safely.", outputTail: "sanitized failure summary" });
    await dispatchHostControlledCommandRunResult(failed.requestId, failed.payload);
    await flushAsync();
    await flushAsync();
    await flushAsync();
    expect(agentRunPanel().textContent).toContain("Manual state: Verification failed");

    expect(agentRunPanel().textContent).toContain("Verification failed. Recovery: review the sanitized result, then manually draft a follow-up or review rollback; no automatic repair is started.");
    expect(agentRunPanel().textContent).toContain("sanitized result available");
    expect(buttonsNamed("Draft Agent Run fix prompt")).toHaveLength(1);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(browserStorageDump()).not.toContain("sanitized failure summary");
  });

  it("wires checkpoint decisions into session timeline and trace without automatic bridge messages", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Agent Run checkpoint decisions", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run checkpoint decisions", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "failed", message: "Patch could not apply cleanly.", cloudRequired: false, appliedEditCount: 0, affectedFiles: ["src/example.ts"] });

    expect(codingTaskSessionPanel().textContent).toContain("Checkpoint decision: rollback_review_available");
    expect(codingTaskSessionPanel().textContent).toContain("Recommended checkpoint step: review_rollback · Review rollback");
    const details = findDetails("multi-step-task-timeline-details");
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const timelineText = container?.querySelector("[data-testid='multi-step-task-timeline-panel']")?.textContent ?? "";
    expect(timelineText).toContain("Checkpoint decision: rollback review available");
    expect(timelineText).toContain("Recommended manual next step: Review rollback.");
    expect(timelineText).toContain("decision status rollback_review_available");
    await act(async () => {
      const traceDetails = findDetails("coding-session-trace-details");
      traceDetails.open = true;
      traceDetails.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    const traceText = findDetails("coding-session-trace-details").textContent ?? "";
    expect(traceText).toContain("Checkpoint decision rollback review metadata visible");
    expect(traceText).toContain("Decision status rollback_review_available; recommended manual next step Review rollback.");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
  });

  it("keeps post-apply checkpoint state controlled and does not auto-run verification", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Agent Run checkpoint continuation", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run checkpoint continuation", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Agent Run apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });

    expect(codingTaskSessionPanel().textContent).toContain("Session: ready_for_verification");
    expect(codingTaskSessionPanel().textContent).toContain("Verification lifecycle: not requested · draft or attach manually");
    expect(agentRunPanel().textContent).toContain("Ready for controlled verification");
    expect(container?.textContent).not.toContain("New run created");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
  });

  it("Agent Run stale chat change prevents controlled verification result from updating current run", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "Agent Run stale chat", 1), chatSummary("chat-002", "Other chat", 0)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Agent Run stale chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
        "chat-002": chatThread("chat-002", "Other chat", []),
      },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Agent Run apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });
    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually run allowlisted verification").click();
    });
    const commandRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentCommandRunRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    const accepted = controlledCommandRunHostMessage(commandRequest.requestId, commandRequest.payload);
    await dispatchHostControlledCommandRunResult(accepted.requestId, accepted.payload);

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(1);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
    expect(agentRunPanel().textContent).toContain("Manual state: idle");
    expect(agentRunPanel().textContent).not.toContain("Verification running");
    expect(agentRunPanel().textContent).not.toContain("Verified");
  });


  it("Agent Run stop clears pending controlled verification and ignores stale result", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "Agent Run stop stale", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run stop stale", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Agent Run apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });
    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually run allowlisted verification").click();
    });
    const commandRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentCommandRunRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    expect(agentRunPanel().textContent).toContain("Verification running");

    await act(async () => {
      findButton("Stop controlled run").click();
    });
    const stale = controlledCommandRunHostMessage(commandRequest.requestId, commandRequest.payload);
    await dispatchHostControlledCommandRunResult(stale.requestId, stale.payload);

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(1);
    expect(agentRunPanel().textContent).toContain("Manual state: Ready for controlled verification");
    expect(container?.querySelector("[data-testid='controlled-agent-run-panel']")?.textContent).toContain("Phase: stopped");
    expect(agentRunPanel().textContent).not.toContain("Verified");
  });

  it("Agent Run runtime disconnect stops pending controlled verification without retry", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "Agent Run disconnect", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run disconnect", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Agent Run apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });
    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually run allowlisted verification").click();
    });
    const commandRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentCommandRunRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };

    await dispatchRuntimeStatus(runtimeStatusPayload({ lifecycle: "disconnected", diagnosis: "runtime disconnected", nextAction: "Reconnect manually." }));
    const stale = controlledCommandRunHostMessage(commandRequest.requestId, commandRequest.payload);
    await dispatchHostControlledCommandRunResult(stale.requestId, stale.payload);

    expect(container?.textContent).toContain("State: Runtime unavailable");
    expect(buttonWithin(agentRunPanel(), "Manually run allowlisted verification").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(1);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
    expect(agentRunPanel().textContent).not.toContain("Verified");
  });

  it("Agent Run duplicate controlled verification result is ignored after first terminal result", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ controlledAgentWorkspaceReadiness: worktreeReadiness, controlledAgentRuntimeSession: runtimeSessionReady }),
      chats: [chatSummary("chat-001", "Agent Run duplicate verification", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Agent Run duplicate verification", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });
    const applyCall = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0];
    await dispatchHostApplyResult(applyCall.requestId, { status: "applied", message: "Agent Run apply result.", cloudRequired: false, appliedEditCount: 1, affectedFiles: ["src/example.ts"] });
    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually run allowlisted verification").click();
    });
    const commandRequest = postMessage.mock.calls.find(([message]) => message.type === "gui.controlledAgentCommandRunRequest")?.[0] as { requestId: string; payload: Record<string, unknown> };
    const accepted = controlledCommandRunHostMessage(commandRequest.requestId, commandRequest.payload);
    await dispatchHostControlledCommandRunResult(accepted.requestId, accepted.payload);
    const duplicate = controlledCommandRunHostMessage(commandRequest.requestId, commandRequest.payload, { status: "failed", exitCode: 1, message: "Duplicate should not render.", outputTail: "duplicate output" });
    await dispatchHostControlledCommandRunResult(duplicate.requestId, duplicate.payload);

    expect(agentRunPanel().textContent).toContain("Manual state: Ready for follow-up");
    expect(agentRunPanel().textContent).toContain("Verification status/result: Verified");
    expect(container?.textContent).not.toContain("Duplicate should not render.");
    expect(container?.textContent).not.toContain("duplicate output");
  });

  it("Agent Run panel avoids browser storage and raw unsafe DOM exposure", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "sk-" + "q".repeat(40);
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("Manual state: idle");
    expect(panel.textContent).toContain("Attach context if needed, confirm provider readiness, then manually draft/send a safe-edit proposal request.");
    expect(panel.textContent).toContain("no hidden model/provider calls");
    expect(panel.textContent).not.toContain(rawSecret);
    expect(panel.textContent).not.toContain("/Users/");
    expect(panel.textContent).not.toContain("npm run check");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain(rawSecret);
    expect(browserStorageDump()).not.toContain("Agent Run");
  });

  it("drafts the one-step model proposal prompt into the composer without sending or posting", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();
    fetchMock.mockClear();
    postMessage.mockClear();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Replace the visible title safely");
    });
    await act(async () => {
      findButton("Draft one-step safe-edit prompt").click();
    });

    expect(chatInput().value).toContain("One-step safe-edit model proposal request");
    expect(chatInput().value).toContain("Goal summary\nReplace the visible title safely");
    expect(chatInput().value).toContain("Explicit context summary");
    expect(chatInput().value).toContain("Provider readiness\nGPT-4o mini (openai-api)");
    expect(document.activeElement).toBe(chatInput());
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Replace the visible title safely");
  });

  it("renders inert multi-step model plan preview without auto bridge calls or sent context", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    const plan = agentRunMultiStepPlanPreview();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-plan-preview-1", "assistant", JSON.stringify(plan)) } },
      ],
    });
    renderApp();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Preview the safe multi-step implementation plan");
    });
    await act(async () => {
      findButton("Draft one-step safe-edit prompt").click();
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("Multi-step plan preview · Review only");
    expect(panel.textContent).toContain("inert");
    expect(panel.textContent).toContain("This plan preview cannot send chat, apply edits, run verification, read files, call providers, or mutate the workspace. Future send, apply, and verification remain explicit user actions.");
    expect(panel.textContent).toContain("Title: Review Agent Run plan preview");
    expect(panel.textContent).toContain("Steps: Inspect current UI: Confirm the review-only state · Add focused tests: Cover safe rendering without workspace changes");
    expect(panel.textContent).toContain("Expected file labels: apps/gui/src/components/AgentRunPanel.tsx · apps/gui/src/App.test.tsx");
    expect(panel.textContent).toContain("Verification suggestions (display-only command IDs): GUI app tests (gui-app-tests)");
    expect(panel.textContent).toContain("Manual state: Goal ready");
    expect(panel.textContent).toContain("Proposal status: not detected");
    expect(buttonWithin(panel, "Manually apply reviewed patch").disabled).toBe(true);
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(1);
    expect(lastUserMessageBody().payload?.content).toContain("One-step safe-edit model proposal request");
    expect(browserStorageDump()).not.toContain("Review Agent Run plan preview");
    expect(localSetItem).not.toHaveBeenCalled();
  });

  it("renders rejected unsafe multi-step plan diagnostics without Agent Run readiness", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    const rawPrivatePath = "/Users/alice/private.ts";
    const unsafePlan = { ...agentRunMultiStepPlanPreview(), autoApply: true, expectedTouchedFiles: [rawPrivatePath] };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-plan-preview-unsafe", "assistant", JSON.stringify(unsafePlan)) } },
      ],
    });
    renderApp();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Preview rejected plan safely");
    });
    await act(async () => {
      findButton("Draft one-step safe-edit prompt").click();
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();

    const panel = agentRunPanel();
    expect(panel.textContent).toContain("Rejected multi-step plan preview");
    expect(panel.textContent).toContain("Unsafe or malformed plan preview metadata was rejected. No apply, verification, read, send, or readiness state was created.");
    expect(panel.textContent).toContain("plan_rejected");
    expect(panel.textContent).toContain("Plan preview metadata was rejected safely.");
    expect(panel.textContent).toContain("Manual state: Goal ready");
    expect(panel.textContent).toContain("Proposal status: not detected");
    expect(panel.textContent).not.toContain(rawPrivatePath);
    expect(buttonWithin(panel, "Manually apply reviewed patch").disabled).toBe(true);
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("autoApply");
    expect(browserStorageDump()).not.toContain(rawPrivatePath);
  });

  it("sends a drafted model proposal prompt only after explicit Send and blocks valid proposals without checkpoint readiness", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-model-proposal-1", "assistant", JSON.stringify(proposal)) } },
      ],
    });
    renderApp();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      setTextareaByPlaceholder("Describe the coding task goal", "Replace the visible title safely");
    });
    await act(async () => {
      findButton("Draft one-step safe-edit prompt").click();
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();

    const commandCalls = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST");
    expect(commandCalls).toHaveLength(1);
    expect(lastUserMessageBody().payload?.content).toContain("One-step safe-edit model proposal request");
    expect(container?.textContent).toContain("proposal_detected");
    expect(agentRunPanel().textContent).toContain("Manual state: Checkpoint required");
    expect(agentRunPanel().textContent).toContain("Proposal status: detected but checkpoint metadata is missing");
    expect(agentRunPanel().textContent).toContain("Checkpoint metadata is not ready. Refresh runtime/checkpoint readiness; apply remains disabled until verified metadata arrives.");
    expect(buttonWithin(agentRunPanel(), "Manually apply reviewed patch").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("renders provider-backed model proposal metadata safely without privileged bridge requests", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = controlledProviderProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-provider-proposal-1", "assistant", JSON.stringify(proposal)) } },
      ],
    });
    renderApp();
    await flushAsync();
    postMessage.mockClear();

    await act(async () => { setTextareaByPlaceholder("Describe the coding task goal", "Review provider-backed metadata safely"); });
    await act(async () => { findButton("Draft one-step safe-edit prompt").click(); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent).toContain("proposal_detected");
    const panel = agentRunPanel();
    expect(panel.textContent).toContain("Manual state: Checkpoint required");
    expect(panel.textContent).toContain("Proposal status: detected but checkpoint metadata is missing");
    expect(panel.textContent).toContain("Plan: Review visible metadata · Wait for manual apply");
    expect(panel.textContent).toContain("Verification suggestions (display-only command IDs): GUI app tests");
    expect(panel.textContent).toContain("Touched files: 1");
    expect(buttonWithin(panel, "Manually apply reviewed patch").disabled).toBe(true);
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest" || message.type === "gui.controlledAgentFileReadRequest" || message.type === "gui.controlledAgentEditRequest" || message.type === "gui.controlledAgentCommandRunRequest")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(1);
    expect(browserStorageDump()).not.toContain("controlled_agent_provider_proposal");
    expect(browserStorageDump()).not.toContain("Review provider-backed metadata safely");
  });

  it("routes controlled workflow proposal path through connected experimental auth without changing authority gates", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = controlledProviderProposalPayload({
      providerProposal: {
        ...controlledProviderProposalPayload().providerProposal,
        proposalId: "experimental-auth-proposal-1",
        summary: "Review a bounded experimental-auth proposal.",
      },
    });
    mockRuntimeResponses({
      authResponse: providerAuthResponse("connected"),
      capsResponse: capsResponse({ agentRunReadiness: agentRunReadinessMetadata() }),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-experimental-provider-proposal-1", "assistant", JSON.stringify(proposal)) } },
      ],
    });
    renderApp();
    await flushAsync();
    postMessage.mockClear();

    expect(container?.textContent).toContain("State: Experimental OpenAI account fallback / gpt-5-codex");
    expect(findButton("Send").disabled).toBe(false);
    await act(async () => { setTextareaByPlaceholder("Describe the coding task goal", "Use connected experimental auth for a controlled provider proposal"); });
    await act(async () => { findButton("Draft one-step safe-edit prompt").click(); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    const panel = agentRunPanel();
    expect(lastUserMessageBody().payload?.content).toContain("One-step safe-edit model proposal request");
    expect(text).toContain("proposal_detected");
    expect(panel.textContent).toContain("Manual state: Checkpoint required");
    expect(panel.textContent).toContain("Proposal status: detected but checkpoint metadata is missing");
    expect(panel.textContent).toContain("Plan: Review visible metadata · Wait for manual apply");
    expect(panel.textContent).toContain("Touched files: 1");
    expect(buttonWithin(panel, "Manually apply reviewed patch").disabled).toBe(true);
    expect(buttonWithin(panel, "Manually run allowlisted verification").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest" || message.type === "gui.ideActionRequest" || message.type === "gui.controlledAgentFileReadRequest" || message.type === "gui.controlledAgentEditRequest" || message.type === "gui.controlledAgentCommandRunRequest" || message.type === "gui.controlledAgentVerificationBundleRequest")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/chats/chat-001/commands") && init?.method === "POST")).toHaveLength(1);
    expect(text).not.toContain("Authorization: Bearer");
    expect(text).not.toContain("access_token");
    expect(text).not.toContain("Cookie:");
    expect(text).not.toContain("/Users/");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("oauth");
    expect(browserStorageDump()).not.toContain("controlled_agent_provider_proposal");
    expect(browserStorageDump()).not.toContain("Use connected experimental auth");
  });

  it("posts the existing apply bridge message only after explicit Agent Run apply click", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ agentRunReadiness: agentRunReadinessMetadata() }),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-model-proposal-1", "assistant", JSON.stringify(proposal)) } },
      ],
    });
    renderApp();
    await flushAsync();
    await act(async () => { setTextareaByPlaceholder("Describe the coding task goal", "Replace the visible title safely"); });
    await act(async () => { findButton("Draft one-step safe-edit prompt").click(); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });
    await flushAsync();
    expect(agentRunPanel().textContent).toContain("Manual state: Ready for manual apply");
    expect(agentRunPanel().textContent).toContain("Checkpoint/policy readiness: verified · ready_for_user_apply");
    expect(buttonWithin(agentRunPanel(), "Manually apply reviewed patch").disabled).toBe(false);
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });

    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0]?.[0].payload).toEqual(proposal);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest")).toHaveLength(0);
  });

  it("Agent Run apply payload contains no execution authority and pending apply blocks duplicates", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      capsResponse: capsResponse({ agentRunReadiness: agentRunReadinessMetadata() }),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-model-proposal-1", "assistant", JSON.stringify(proposal)) } },
      ],
    });
    renderApp();
    await flushAsync();
    await act(async () => { setTextareaByPlaceholder("Describe the coding task goal", "Replace the visible title safely"); });
    await act(async () => { findButton("Draft one-step safe-edit prompt").click(); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });
    await flushAsync();
    postMessage.mockClear();

    await act(async () => {
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
      buttonWithin(agentRunPanel(), "Manually apply reviewed patch").click();
    });

    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    const applyCall = applyCalls[0]?.[0];
    expect(applyCall.requestId).toMatch(/^gui-agent-run-apply-/);
    expect(JSON.stringify(applyCall.payload)).not.toMatch(/"(?:command|cmd|args|cwd|env|tool)"/);
    expect(Object.keys(applyCall.payload)).toEqual(["requiresUserConfirmation", "summary", "cloudRequired", "edits"]);
    expect(buttonWithin(agentRunPanel(), "Manually apply reviewed patch").disabled).toBe(true);
    expect(agentRunPanel().textContent).toContain("Manual state: Apply pending");
  });

  it("renders invalid and normal model proposal responses without enabling Agent Run apply", async () => {
    const invalidProposal = { ...safeEditProposalPayload(), requestId: "assistant-owned-request" };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-invalid-proposal", "assistant", JSON.stringify(invalidProposal)) } },
      ],
    });
    renderApp();
    await flushAsync();
    await act(async () => { setTextareaByPlaceholder("Describe the coding task goal", "Replace the visible title safely"); });
    await act(async () => { findButton("Draft one-step safe-edit prompt").click(); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });
    await flushAsync();

    expect(container?.textContent).toContain("proposal_rejected");
    expect(agentRunPanel().textContent).not.toContain("Manual state: Ready for manual apply");
    expect(buttonWithin(agentRunPanel(), "Manually apply reviewed patch").disabled).toBe(true);

    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
    fetchMock.mockReset();

    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-normal", "assistant", "I need a file excerpt before proposing an edit.") } },
      ],
    });
    renderApp();
    await flushAsync();
    await act(async () => { setTextareaByPlaceholder("Describe the coding task goal", "Replace the visible title safely"); });
    await act(async () => { findButton("Draft one-step safe-edit prompt").click(); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });
    await flushAsync();

    expect((container as HTMLDivElement | undefined)?.textContent).toContain("normal_response");
    expect(buttonWithin(agentRunPanel(), "Manually apply reviewed patch").disabled).toBe(true);
  });

  it("keeps stale model proposal responses and browser mode inert without storage or raw unsafe DOM", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "s".repeat(64);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Chat A", 0), chatSummary("chat-002", "Chat B", 0)],
      chatThreads: { "chat-001": chatThread("chat-001", "Chat A", []), "chat-002": chatThread("chat-002", "Chat B", []) },
      sseEvents: [
        { seq: 0, type: "snapshot", chatId: "chat-001", payload: {} },
        { seq: 1, type: "message_added", chatId: "chat-001", payload: { message: chatMessage("chat-001", "assistant-stale", "assistant", JSON.stringify(safeEditProposalPayload())) } },
      ],
    });
    renderApp();
    await flushAsync();
    await act(async () => { setTextareaByPlaceholder("Describe the coding task goal", `Replace title without ${rawSecret} /Users/alice/private/file.ts npm run check`); });
    await act(async () => { findButton("Draft one-step safe-edit prompt").click(); });
    expect(chatInput().value).toContain("[redacted]");
    expect(chatInput().value).not.toContain(rawSecret);
    expect(chatInput().value).not.toContain("/Users/alice");
    expect(chatInput().value).not.toContain("npm run check");
    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await flushAsync();

    expect(container?.textContent).toContain("browser preview only");
    expect(agentRunPanel().textContent).toContain("Manual state: Checkpoint required");
    expect(buttonWithin(agentRunPanel(), "Manually apply reviewed patch").disabled).toBe(true);
    expect(buttonsNamed("Apply in VS Code after review")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Replace title");
    expect(browserStorageDump()).not.toContain(rawSecret);
  });
  it("does not expose raw secret-like replacement text in DOM or storage before acknowledgement for a redacted proposal", async () => {
    localStorage.setItem("sentinel", "keep");
    const rawToken = "sk-" + "b".repeat(40);
    const longToken = "c".repeat(64);
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: `Bearer ${rawToken} api_key=${longToken}`,
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Redacted secret isolation", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Redacted secret isolation", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const html = container?.innerHTML ?? "";
    expect(container?.textContent ?? "").toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    expect(container?.textContent ?? "").toContain("I understand the raw replacement text may differ from the redacted preview.");
    expect(container?.querySelector("[data-testid='edit-proposal-acknowledge-redaction']")).not.toBeNull();
    expect(container?.textContent ?? "").toContain("large replacement");
    expect(html).not.toContain(rawToken);
    expect(html).not.toContain(longToken);
    expect(html).not.toContain(`Bearer ${rawToken}`);
    expect(html).not.toContain(`api_key=${longToken}`);
    expect(browserStorageDump()).toContain("sentinel");
    expect(browserStorageDump()).not.toContain(rawToken);
    expect(browserStorageDump()).not.toContain(longToken);
    // In browser mode the apply button is not rendered; in VS Code it would be disabled. Either way the acknowledgement control is required before any apply can be issued.
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in VS Code after review")).toBe(false);
  });

  it("resets acknowledgement when the edit proposal payload changes", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const shortenedReplacementText = "safe replacement text segment ".repeat(14);
    const firstProposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: shortenedReplacementText,
            },
          ],
        },
      ],
    };
    const secondProposal = {
      ...firstProposal,
      summary: "Different confirmed edit after first review.",
    };

    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Edit proposal acknowledge reset", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal acknowledge reset", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(firstProposal))]) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();
    await flushAsync();

    const firstAck = container?.querySelector<HTMLInputElement>("[data-testid='edit-proposal-acknowledge-redaction']");
    expect(firstAck).not.toBeNull();
    expect(findButton("Apply in VS Code after review").disabled).toBe(true);
    await act(async () => {
      firstAck!.click();
    });
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);

    // Send a new user message that produces a new (changed) assistant edit proposal.
    await act(async () => {
      setTextareaValue(chatInput(), "trigger sse for second edit proposal");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 2,
        type: "snapshot",
        chatId: "chat-001",
        payload: { messages: [chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(secondProposal))] },
      })}\n\n`));
      sseController?.close();
    });
    await flushAsync();
    await flushAsync();

    const secondText = container?.textContent ?? "";
    expect(secondText).toContain("Different confirmed edit after first review.");
    expect(secondText).toContain("Replacement preview was redacted or shortened. VS Code apply uses the raw proposal text; inspect proposal JSON before requesting apply.");
    const secondAck = container?.querySelector<HTMLInputElement>("[data-testid='edit-proposal-acknowledge-redaction']");
    expect(secondAck).not.toBeNull();
    expect(secondAck?.checked).toBe(false);
    expect(findButton("Apply in VS Code after review").disabled).toBe(true);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("rejects duplicate edit proposal file groups before rendering or posting", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = {
      ...safeEditProposalPayload(),
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
              replacementText: "const label = \"Yet AI\";",
            },
          ],
        },
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 9, character: 0 }, end: { line: 9, character: 12 } },
              replacementText: "const next = \"Yet AI\";",
            },
          ],
        },
        {
          workspaceRelativePath: "src/another.ts",
          textReplacements: [
            {
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
              replacementText: "const another = \"Yet AI\";",
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Duplicate file edit groups chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Duplicate file edit groups chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Edit proposal detected but rejected");
    expect(text).toContain("The edit proposal payload is invalid or unsafe.");
    expect(text).toContain("Ask the model to resend one strict edit proposal");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(container?.querySelector("[data-testid='edit-proposal-unique-files']")).toBeNull();
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("does not transfer edit-proposal inspect state to a changed proposal JSON", async () => {
    const first = safeEditProposalPayload();
    const second = { ...first, summary: "Different confirmed edit after first review." };
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Edit proposal inspect transfer", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal inspect transfer", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(first))]) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();
    await flushAsync();

    const initialText = container?.textContent ?? "";
    expect(initialText).not.toContain(JSON.stringify(first, null, 2));

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });
    expect(container?.textContent ?? "").toContain("Replace one visible editor line after user review.");

    await act(async () => {
      setTextareaValue(chatInput(), "trigger sse for edit proposal update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });
    await flushAsync();
    expect(sseController).toBeDefined();

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({ seq: 0, type: "snapshot", chatId: "chat-001", payload: { messages: [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(second))] } })}\n\n`));
      await Promise.resolve();
    });
    await flushAsync();

    const changedText = container?.textContent ?? "";
    expect(changedText).toContain("Different confirmed edit after first review.");
    expect(changedText).not.toContain("Replace one visible editor line after user review.");
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(findButton("Inspect proposal JSON").disabled).toBe(false);
  });

  it("renders a single fenced json edit envelope as preview-only until explicit apply", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Fenced edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Fenced edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", `Here is one reviewable proposal:\n\n\`\`\`json\n${JSON.stringify(envelope, null, 2)}\n\`\`\`\n\nIt will not apply automatically.`)]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replace one visible editor line after user review.");
    expect(text).toContain("Apply in VS Code after review");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });

    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
  });

  it("rejects assistant edit proposals with multiple fenced envelopes before posting", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, payload: proposal };
    const json = JSON.stringify(envelope);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Multiple fenced edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Multiple fenced edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", `Option A:\n\`\`\`json\n${json}\n\`\`\`\nOption B:\n\`\`\`json\n${json}\n\`\`\``)]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Edit proposal detected but rejected");
    expect(text).toContain("multiple or ambiguous edit proposal candidates");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });
  it("renders JetBrains proposal preview with explicit apply emission", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "JetBrains edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "JetBrains edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replace one visible editor line after user review.");
    expect(text).toContain("src/example.ts");
    expect(text).toContain("Apply in JetBrains after review");
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);

    await act(async () => {
      findButton("Apply in JetBrains after review").click();
    });

    const applyCalls = postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
  });

  it("renders exact Demo Mode edit envelope as actionable JetBrains apply panel only after click", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const proposal = demoModeSafeEditProposalPayload();
    const envelope = demoModeSafeEditProposalEnvelope(proposal);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "JetBrains Demo Mode edit proposal", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "JetBrains Demo Mode edit proposal", [chatMessage("chat-001", "assistant-demo-edit-1", "assistant", JSON.stringify(envelope, null, 2))]) },
    });

    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Demo Mode safe edit no-op preview.");
    expect(text).toContain("src/example.ts");
    expect(text).toContain("replacement characters 0");
    expect(text).toContain("Empty replacement text.");
    expect(text).toContain("Apply in JetBrains after review");
    expect(text).not.toContain("requestId");
    expect(text).not.toContain("requestId");

    await act(async () => {
      findButton("Apply in JetBrains after review").click();
    });

    const applyCalls = postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
  });

  it("renders actionable JetBrains apply panel for persisted Demo Mode edit envelope followed by status text", async () => {
    const postIntellijMessage = vi.fn();
    window.postIntellijMessage = postIntellijMessage;
    const proposal = demoModeSafeEditProposalPayload();
    const assistantRequestId = "assistant-demo-status-request-id-ignored";
    const envelope = demoModeSafeEditProposalEnvelope(proposal);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      demoMode: demoModeResponse(true),
      chats: [chatSummary("chat-001", "Installed Demo Mode edit proposal", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Installed Demo Mode edit proposal", [
          chatMessage("chat-001", "assistant-demo-edit-1", "assistant", JSON.stringify(envelope, null, 2)),
          chatMessage("chat-001", "assistant-demo-status-1", "assistant", "Demo Mode is ready for your next local prompt."),
        ]),
      },
    });

    renderApp();
    await flushAsync();
    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8001" });
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(text).toContain("Demo Mode is ready for your next local prompt.");
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Demo Mode safe edit no-op preview.");
    expect(text).toContain("Apply in JetBrains after review");
    expect(text).not.toContain(assistantRequestId);
    expect(postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(text).not.toContain("requestId");
    await act(async () => {
      findButton("Apply in JetBrains after review").click();
    });

    const applyCalls = postIntellijMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
    expect(applyCalls[0][0].requestId).not.toBe(assistantRequestId);
  });

  it("keeps exact Demo Mode edit envelope preview-only in browser mode", async () => {
    delete window.postIntellijMessage;
    delete window.acquireVsCodeApi;
    if (appParentDescriptor) Object.defineProperty(window, "parent", appParentDescriptor);
    if (appReferrerDescriptor) Object.defineProperty(Document.prototype, "referrer", appReferrerDescriptor);
    const proposal = demoModeSafeEditProposalPayload();
    const envelope = demoModeSafeEditProposalEnvelope(proposal);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Browser Demo Mode edit proposal", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Browser Demo Mode edit proposal", [chatMessage("chat-001", "assistant-demo-edit-1", "assistant", JSON.stringify(envelope, null, 2))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Demo Mode safe edit no-op preview.");
    expect(text).toContain("Preview only in this host. Browser cannot apply proposed edits");
    expect(Array.from(container?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Apply in JetBrains after review" || button.textContent === "Apply in VS Code after review")).toBe(false);
  });

  it("emits an apply request only after explicit user click in a privileged host", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });

    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][0]).toMatchObject({ version: bridgeVersion, type: "gui.applyWorkspaceEditRequest", payload: proposal });
    expect(applyCalls[0][0].requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
  });

  it("rejects an assistant-supplied apply requestId without posting apply", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    const assistantRequestId = "assistant-request-id-must-not-correlate";
    const envelope = { type: "gui.applyWorkspaceEditRequest", version: bridgeVersion, requestId: assistantRequestId, payload: proposal };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Assistant request id rejected", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Assistant request id rejected", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(envelope))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Edit proposal detected but rejected");
    expect(text).toContain("The assistant must not supply an apply request id.");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(text).not.toContain(assistantRequestId);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("clears a stale valid apply panel when the latest proposal-like assistant message is rejected", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    const malformed = "{ \"summary\": \"Broken proposal\", \"edits\": [";
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Invalid latest edit proposal", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Invalid latest edit proposal", [
          chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal)),
          chatMessage("chat-001", "assistant-2", "assistant", malformed),
        ]),
      },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Earlier safe edit proposal. Only the latest valid proposal can be requested from the proposal card.");
    expect(text).toContain("Edit proposal detected but rejected");
    expect(text).toContain("The edit proposal JSON is not valid.");
    expect(text).toContain("Safe edit/proposal template");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(text).not.toContain(malformed);
    expect(container?.querySelector("[data-testid='edit-proposal-apply-button']")).toBeNull();
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("clears proposal apply state synchronously on direct chat id changes", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal chat", 1), chatSummary("chat-002", "Other chat", 0)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Edit proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
        "chat-002": chatThread("chat-002", "Other chat", []),
      },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(findButton("Apply in VS Code after review")).toBeDefined();
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const oldRequestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(oldRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
    });

    let text = container?.textContent ?? "";
    expect(text).not.toContain("Propose safe edit");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(text).not.toContain(oldRequestId);

    await dispatchHostApplyResult(oldRequestId, {
      status: "applied",
      message: "Stale direct chat id result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    text = container?.textContent ?? "";
    expect(text).not.toContain("Host apply result");
    expect(text).not.toContain("Stale direct chat id result.");
  });

  it("keeps proposal request id stable across unrelated chat view updates and prevents duplicate apply while pending", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Stable proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Stable proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
      sseEvents: [],
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const initialRequestId = editProposalRequestId();
    await act(async () => {
      setTextareaValue(chatInput(), "cause unrelated chat update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editProposalRequestId()).toBe(initialRequestId);
    const applyButton = findButton("Apply in VS Code after review");
    await act(async () => {
      applyButton.click();
      applyButton.click();
    });

    expect(findButton("VS Code apply request pending…").disabled).toBe(true);
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    expect(applyCalls).toHaveLength(1);

    await dispatchHostApplyResult(applyCalls[0][0].requestId, {
      status: "applied",
      message: "Stable proposal result displayed.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Stable proposal result displayed.");

    await act(async () => {
      setTextareaValue(chatInput(), "cause another unrelated chat update");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editProposalRequestId()).toBe(initialRequestId);
    expect(container?.textContent ?? "").toContain("Stable proposal result displayed.");
  });

  it("allows explicit pending apply cancel without emitting another request or accepting stale results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Cancelable proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Cancelable proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(findButton("VS Code apply request pending…").disabled).toBe(true);

    await act(async () => {
      findButton("Clear pending apply state").click();
    });

    expect(findButton("Apply in VS Code after review").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(1);

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Stale canceled apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Stale canceled apply result.");
  });

  it("uses a fresh apply attempt id after clearing pending state and ignores the stale first result", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Retry proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Retry proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const firstApplyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    const firstRequestId = firstApplyCalls[firstApplyCalls.length - 1]?.[0].requestId;
    expect(firstRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await act(async () => {
      findButton("Clear pending apply state").click();
    });
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyCalls = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    const secondRequestId = applyCalls[applyCalls.length - 1]?.[0].requestId;
    expect(applyCalls).toHaveLength(2);
    expect(secondRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);
    expect(secondRequestId).not.toBe(firstRequestId);
    // Session-nonce contract: two retries inside the same App mount must share
    // the same per-session nonce segment but differ in the counter segment.
    const firstMatch = firstRequestId?.match(/^gui-edit-proposal-apply-([A-Za-z0-9][A-Za-z0-9_.-]*)-(\d+)$/);
    const secondMatch = secondRequestId?.match(/^gui-edit-proposal-apply-([A-Za-z0-9][A-Za-z0-9_.-]*)-(\d+)$/);
    expect(firstMatch).not.toBeNull();
    expect(secondMatch).not.toBeNull();
    expect(firstMatch?.[1]).toBe(secondMatch?.[1]);
    expect(firstMatch?.[1].length ?? 0).toBeGreaterThan(0);
    expect(firstMatch?.[2]).not.toBe(secondMatch?.[2]);

    await dispatchHostApplyResult(firstRequestId, {
      status: "applied",
      message: "Stale first apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Stale first apply result.");
    expect(findButton("VS Code apply request pending…").disabled).toBe(true);

    await dispatchHostApplyResult(secondRequestId, {
      status: "applied",
      message: "Second apply result displayed.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Second apply result displayed.");
  });

  it("regenerates the apply session nonce on each App mount and shares it across retries", () => {
    // Per-session contract: the helper must return a non-empty, bridge-safe
    // nonce (no forbidden secret/api_key/sk markers, no token/secret words).
    const nonce = generateApplyRequestSessionNonce();
    expect(nonce).toMatch(/^s[0-9a-f]{12}$/);
    expect(nonce.length).toBeLessThanOrEqual(128);
    expect(/authorization|bearer|api[_-]?key|token|secret|access[_-]?token|sk-(?:proj-)?[A-Za-z0-9_-]{8,}/i.test(nonce)).toBe(false);

    // Two independent calls produce different nonces (high-entropy).
    const other = generateApplyRequestSessionNonce();
    expect(other).not.toBe(nonce);
  });

  it("rejects invalid proposal objects before rendering or sending", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const invalidProposal = { ...safeEditProposalPayload(), requiresUserConfirmation: false };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Invalid proposal chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Invalid proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(invalidProposal))]) },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Propose safe edit");
    expect(text).not.toContain("Apply in VS Code after review");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("clears a stale valid proposal when an invalid latest assistant proposal replaces it", async () => {
    const proposal = safeEditProposalPayload();
    const invalidProposal = { ...proposal, requiresUserConfirmation: false };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Invalid latest proposal chat", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Invalid latest proposal chat", [
          chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal)),
          chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(invalidProposal)),
        ]),
      },
    });

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent ?? "").not.toContain("Propose safe edit");
    expect(container?.querySelector(".edit-proposal-card")?.textContent ?? "").toContain("Edit proposal detected but rejected");
  });

  it("fail-closes a stale apply when latest chat messages replace a valid proposal with invalid content", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sseController = controller;
          },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Dynamic invalid proposal chat", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Dynamic invalid proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();
    await flushAsync();
    await flushAsync();

    expect(findButton("Apply in VS Code after review")).toBeDefined();
    const staleRequestId = editProposalRequestId();
    await act(async () => {
      setTextareaValue(chatInput(), "open dynamic proposal stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 1,
        type: "snapshot",
        chatId: "chat-001",
        payload: {
          messages: [
            chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal)),
            chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify({ ...proposal, requiresUserConfirmation: false })),
          ],
        },
      })}\n\n`));
      await Promise.resolve();
    });

    expect(container?.textContent ?? "").not.toContain("Propose safe edit");
    expect(container?.textContent ?? "").not.toContain("Apply in VS Code after review");
    expect(container?.querySelector(".edit-proposal-card")?.textContent ?? "").toContain("Edit proposal detected but rejected");

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 2,
        type: "snapshot",
        chatId: "chat-001",
        payload: {
          messages: [chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify({ ...proposal, requiresUserConfirmation: false }))],
        },
      })}\n\n`));
      await Promise.resolve();
    });
    await dispatchHostApplyResult(staleRequestId, {
      status: "applied",
      message: "Stale dynamic apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(container?.textContent ?? "").not.toContain("Stale dynamic apply result.");
  });

  it("shows only matching pending host apply results and ignores unsolicited or stale results", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Correlated proposal chat", 1), chatSummary("chat-002", "Other chat", 1)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Correlated proposal chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
        "chat-002": chatThread("chat-002", "Other chat", []),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "applied",
      message: "Unsolicited apply result.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Unsolicited apply result.");

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "failed",
      message: "Mismatched apply result.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    expect(container?.textContent ?? "").not.toContain("Mismatched apply result.");

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Applied after user confirmation.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    let text = container?.textContent ?? "";
    expect(text).toContain("Host apply result: applied");
    expect(text).toContain("Applied after user confirmation.");
    expect(text).toContain("src/example.ts");

    await dispatchHostApplyResult(requestId, {
      status: "failed",
      message: "Authorization Bearer unsafe-secret",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });

    text = container?.textContent ?? "";
    expect(text).toContain("Applied after user confirmation.");
    expect(text).not.toContain("unsafe-secret");

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    expect(container?.textContent ?? "").not.toContain("Host apply result");
    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Stale result after chat switch.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").not.toContain("Stale result after chat switch.");
  });

  it("clears pending apply on runtime settings change and ignores the old host result", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Settings stale apply chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Settings stale apply chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(findButton("VS Code apply request pending…").disabled).toBe(true);

    await dispatchHostReady({ runtimeUrl: "http://127.0.0.1:8765", sessionToken: "newSettingsLocalValue" });
    await flushAsync();

    expect(container?.textContent ?? "").toContain("Propose safe edit");
    expect(container?.textContent ?? "").not.toContain("VS Code apply request pending…");
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Old runtime apply result should not render.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    const text = container?.textContent ?? "";
    expect(text).not.toContain("Old runtime apply result should not render.");
    expect(text).not.toContain("Host apply result");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("newSettingsLocalValue");
  });

  it("rejects host apply results carrying assistant proposal correlation metadata", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Mismatched proposal result chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Mismatched proposal result chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Result with mismatched proposalRequestId should not render.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
      proposalRequestId: "assistant-supplied-proposal-id",
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Rejected invalid host bridge message");
    expect(text).toContain("VS Code apply request pending…");
    expect(text).not.toContain("Result with mismatched proposalRequestId should not render.");
    expect(text).not.toContain("Host apply result: applied");
    expect(browserStorageDump()).not.toContain("assistant-supplied-proposal-id");
  });

  it("bounds completed host apply request tracking to a fixed small limit", () => {
    const completed = new Map<string, string>();
    for (let index = 0; index < completedApplyRequestChatsLimit + 5; index += 1) {
      rememberCompletedApplyRequest(completed, `request-${index}`, "chat-001");
    }

    expect(completed.size).toBe(completedApplyRequestChatsLimit);
    expect(completed.has("request-0")).toBe(false);
    expect(completed.has(`request-${completedApplyRequestChatsLimit + 4}`)).toBe(true);
  });

  it("does not overwrite a rendered host apply result when a duplicate result arrives for the same chat", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Confirmed edit apply chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Confirmed edit apply chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "First host apply result rendered.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("First host apply result rendered.");

    await dispatchHostApplyResult(requestId, {
      status: "failed",
      message: "Duplicate host apply result should not render.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    const text = container?.textContent ?? "";
    expect(text).toContain("First host apply result rendered.");
    expect(text).toContain("Ignored duplicate host apply result.");
    expect(text).not.toContain("Duplicate host apply result should not render.");
  });

  it("rejects unsafe host apply result messages and paths before rendering", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Sanitized result chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Sanitized result chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    const secret = "sk-" + "d".repeat(40);
    await dispatchHostApplyResult(requestId, {
      status: "failed",
      message: `Failed with Bearer ${secret} at /Users/private/me/.config/auth.json ${"detail ".repeat(80)}`,
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: ["src/example.ts", "credentials/private-token.txt"],
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Rejected invalid host bridge message");
    expect(text).not.toContain("Host apply result: failed");
    expect(text).not.toContain("[redacted]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("/Users/private/me");
    expect(text).not.toContain("credentials/private-token.txt");

    expect(text.length).toBeLessThan(16200);
  });

  it("ignores stale host apply result while a different apply request is pending in the same chat", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Stale apply chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Stale apply chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "failed",
      message: "Unsolicited host apply result.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    expect(container?.textContent ?? "").not.toContain("Unsolicited host apply result.");
    expect(container?.textContent ?? "").not.toContain("Ignored stale host apply result.");

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const pendingRequestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(pendingRequestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await dispatchHostApplyResult("gui-edit-proposal-999", {
      status: "failed",
      message: "Mismatched stale host apply result should not render.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    const text = container?.textContent ?? "";
    expect(text).toContain("Ignored stale host apply result.");
    expect(text).not.toContain("Mismatched stale host apply result should not render.");
    expect(findButton("VS Code apply request pending…").disabled).toBe(true);

    await dispatchHostApplyResult(pendingRequestId, {
      status: "applied",
      message: "Pending apply result displayed.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Pending apply result displayed.");
    expect(container?.textContent ?? "").not.toContain("Ignored stale host apply result.");
  });

  it("does not render an old-chat host apply result or a duplicate for a previous chat", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Original chat", 1), chatSummary("chat-002", "Switched chat", 0)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Original chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]),
        "chat-002": chatThread("chat-002", "Switched chat", []),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    expect(requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Original chat apply result rendered.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    expect(container?.textContent ?? "").toContain("Original chat apply result rendered.");

    await act(async () => {
      setInputValue(chatIdInput(), "chat-002");
      await Promise.resolve();
    });
    await flushAsync();
    expect(container?.textContent ?? "").not.toContain("Host apply result");

    await dispatchHostApplyResult(requestId, {
      status: "applied",
      message: "Old chat duplicate apply result should not render.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });
    const text = container?.textContent ?? "";
    expect(text).not.toContain("Old chat duplicate apply result should not render.");
    expect(text).not.toContain("Ignored duplicate host apply result.");
    expect(text).not.toContain("Ignored stale host apply result.");
  });

  it("compacts latest valid edit proposal bubble and hides raw JSON by default", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const proposal = safeEditProposalPayload();
    const rawJson = JSON.stringify(proposal);
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Compact edit proposal", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Compact edit proposal", [chatMessage("chat-001", "assistant-1", "assistant", rawJson)]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const initialText = container?.textContent ?? "";
    expect(initialText).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(initialText).toContain("Propose safe edit");
    expect(initialText).toContain("Replace one visible editor line after user review.");
    expect(initialText).not.toContain(rawJson);
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Replace one visible editor line");

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });

    const inspectedText = container?.textContent ?? "";
    const inspectedPre = container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']");
    expect(inspectedPre).not.toBeNull();
    expect(inspectedPre?.textContent).toContain("\"workspaceRelativePath\": \"src/example.ts\"");
    expect(inspectedPre?.textContent).toContain("\"summary\":");
    expect(inspectedText).toContain("\"workspaceRelativePath\": \"src/example.ts\"");
    expect(inspectedText).toContain("\"requiresUserConfirmation\": true");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("Replace one visible editor line");
  });

  it("keeps latest valid confirmed edit proposal actionable when followed by normal assistant text", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const valid = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Historical edit proposal", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Historical edit proposal", [
          chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(valid)),
          chatMessage("chat-001", "assistant-2", "assistant", "Normal assistant response."),
        ]),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(text).toContain("Normal assistant response.");
    expect(text).toContain("Propose safe edit");
    expect(text).toContain("Replace one visible editor line after user review.");
    expect(findButton("Apply in VS Code after review").disabled).toBe(false);
    expect(container?.querySelectorAll("pre[aria-label=\"Assistant edit proposal JSON\"]")).toHaveLength(0);
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("resets edit proposal inspect state when payload changes and the new proposal is hidden by default", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const firstProposal = safeEditProposalPayload();
    const secondProposal = {
      ...safeEditProposalPayload(),
      summary: "Replace a different editor line after user review.",
      edits: [
        {
          workspaceRelativePath: "src/example.ts",
          textReplacements: [
            {
              range: { start: { line: 7, character: 0 }, end: { line: 7, character: 20 } },
              replacementText: "const other = \"Yet AI\";",
            },
          ],
        },
      ],
    };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Edit proposal change", 1)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Edit proposal change", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(firstProposal))]),
      },
      sseEvents: [],
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).not.toBeNull();

    let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/chats/subscribe?chat_id=")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) { sseController = controller; },
          cancel() {},
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
      return mockRuntimeResponse(input, init, {
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Edit proposal change", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Edit proposal change", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(secondProposal))]) },
      });
    });

    await act(async () => {
      setTextareaValue(chatInput(), "open edit proposal stream");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    await act(async () => {
      sseController?.enqueue(encoder.encode(`data: ${JSON.stringify({
        seq: 1,
        type: "snapshot",
        chatId: "chat-001",
        payload: {
          messages: [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(secondProposal))],
        },
      })}\n\n`));
      await Promise.resolve();
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Replace a different editor line after user review.");
    expect(text).toContain("Proposed a safe edit. Review the proposal card below. It will not apply automatically.");
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(findButton("Inspect proposal JSON")).toBeDefined();

    await act(async () => {
      findButton("Inspect proposal JSON").click();
    });
    const inspectedPre = container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']");
    expect(inspectedPre).not.toBeNull();
    expect(inspectedPre?.textContent).toContain("\"summary\": \"Replace a different editor line after user review.\"");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it("does not render compact edit proposal bubble or card when the latest assistant message is invalid", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    const invalidProposal = { ...proposal, requiresUserConfirmation: false };
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Invalid latest edit", 2)],
      chatThreads: {
        "chat-001": chatThread("chat-001", "Invalid latest edit", [
          chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal)),
          chatMessage("chat-001", "assistant-2", "assistant", JSON.stringify(invalidProposal)),
        ]),
      },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    const text = container?.textContent ?? "";
    expect(text).toContain("Earlier safe edit proposal. Only the latest valid proposal can be requested from the proposal card.");
    expect(text).not.toContain("Proposed a safe edit.");
    expect(text).not.toContain("Propose safe edit");
    expect(container?.querySelector(".edit-proposal-card")?.textContent ?? "").toContain("Edit proposal detected but rejected");
    expect(Array.from(container?.querySelectorAll("button") ?? []).map((button) => button.textContent)).not.toContain("Apply in VS Code after review");
    expect(container?.querySelector(".chat-bubble.assistant pre[aria-label='Assistant edit proposal JSON']")).toBeNull();
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest")).toHaveLength(0);
  });

  it.each([
    ["applied", "Edits were applied by the host after confirmation."],
    ["denied", "The host/user declined the edit. Review the host confirmation and request apply again only if you still want it."],
    ["rejected", "The host rejected the edit by policy or validation. Ask for a smaller/safe proposal before trying again."],
    ["failed", "The host failed while applying. The file may have changed; refresh context and ask for an updated proposal before retrying."],
  ] satisfies Array<["applied" | "denied" | "rejected" | "failed", string]>)(
    "renders per-status repair guidance with the host apply result for %s",
    async (status, guidance) => {
      const postMessage = vi.fn();
      window.acquireVsCodeApi = () => ({ postMessage });
      const proposal = safeEditProposalPayload();
      mockRuntimeResponses({
        ...readyRuntimeOptions(),
        chats: [chatSummary("chat-001", "Repair guidance chat", 1)],
        chatThreads: { "chat-001": chatThread("chat-001", "Repair guidance chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
      });
      renderApp();
      await flushAsync();
      await flushAsync();

      await act(async () => {
        findButton("Apply in VS Code after review").click();
      });
      const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
      expect(requestId).toMatch(/^gui-edit-proposal-apply-[A-Za-z0-9][A-Za-z0-9_.-]*-\d+$/);

      const hostResultMessage = `Host result ${status} should be shown alongside the static repair hint.`;
      await dispatchHostApplyResult(requestId, {
        status,
        message: hostResultMessage,
        cloudRequired: false,
        appliedEditCount: status === "applied" ? 1 : 0,
        affectedFiles: status === "applied" ? ["src/example.ts"] : [],
      });

      const text = container?.textContent ?? "";
      expect(text).toContain(`Host apply result: ${status}`);
      expect(text).toContain(guidance);
      expect(container?.querySelector(".apply-result-card .subtle[data-testid='apply-result-guidance']")).not.toBeNull();
      expect(text).toContain(hostResultMessage);
      // The GUI only renders the sanitized host result alongside the bounded/static repair hint;
      // it never claims to have applied, retried, or edited files itself.
      expect(text).not.toContain("Authorization Bearer");
    },
  );

  it("shows apply-to-verify next step only after an applied host result", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({ ...readyRuntimeOptions(), chats: [chatSummary("chat-001", "Apply verify step", 1)], chatThreads: { "chat-001": chatThread("chat-001", "Apply verify step", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) } });
    renderApp();
    await flushAsync();
    await flushAsync();

    expect(container?.textContent ?? "").not.toContain("Next safe step: run verification.");
    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const requestId = postMessage.mock.calls.find(([message]) => message.type === "gui.applyWorkspaceEditRequest")?.[0].requestId;
    await dispatchHostApplyResult(requestId, {
      status: "denied",
      message: "User skipped apply.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    expect(container?.textContent ?? "").not.toContain("Next safe step: run verification.");

    await act(async () => {
      findButton("Apply in VS Code after review").click();
    });
    const applyRequests = postMessage.mock.calls.filter(([message]) => message.type === "gui.applyWorkspaceEditRequest");
    const secondRequestId = applyRequests[applyRequests.length - 1]?.[0].requestId;
    await dispatchHostApplyResult(secondRequestId, {
      status: "applied",
      message: "Applied before verification.",
      cloudRequired: false,
      appliedEditCount: 1,
      affectedFiles: ["src/example.ts"],
    });

    const text = container?.textContent ?? "";
    expect(text).toContain("Next safe step: run verification.");
    expect(text).toContain("Pick an allowlisted command below when you are ready; the GUI will not run or send anything automatically.");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(0);
  });

  it("attaches verification output explicitly as one-shot context and clears after accepted send", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("GUI app tests").click();
    });
    await dispatchHostIdeActionResult("gui-verification-command-1", { status: "succeeded", message: "GUI tests passed.", cloudRequired: false, action: "runVerificationCommand", commandId: "gui-app-tests", exitCode: 0, durationMs: 42, outputTail: "vitest passed", truncated: false });
    expect(container?.textContent ?? "").toContain("Attach verification result to next message");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "runVerificationCommand")).toHaveLength(1);
    fetchMock.mockClear();

    await act(async () => {
      findButton("Attach verification result to next message").click();
    });

    expect(chatInput().value).toContain("Use the attached verification_output from gui-app-tests");
    expect(container?.textContent ?? "").toContain("Added gui-app-tests verification output to the one-shot bundle.");
    expect(findButton("Verification result attached to next message").disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody() as { payload?: { content?: string; context?: { kind?: string; items?: Array<Record<string, unknown>> } } };
    expect(body.payload?.context?.kind).toBe("explicit_context_bundle");
    expect(body.payload?.context?.items).toEqual([{ kind: "verification_output", commandId: "gui-app-tests", status: "succeeded", exitCode: 0, outputTail: "vitest passed", truncated: false }]);
    expect(container?.textContent ?? "").toContain("One-shot explicit context bundle attached to the last accepted message and cleared.");
    expect(container?.textContent ?? "").toContain("empty");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("vitest passed");
  });

  it("keeps explicitly attached verification output after failed send for retry", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandStatus: 500, commandError: "send failed safely" });
    renderApp();
    await flushAsync();

    await act(async () => {
      findButton("Repository check").click();
    });
    await dispatchHostIdeActionResult("gui-verification-command-1", { status: "failed", message: "Repository check failed.", cloudRequired: false, action: "runVerificationCommand", commandId: "repository-check", exitCode: 1, durationMs: 77, outputTail: "check failed", truncated: false });
    await act(async () => {
      findButton("Attach verification result to next message").click();
    });

    expect(container?.textContent ?? "").toContain("Verification output");
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    expect(chatInput().value).toContain("Use the attached verification_output from repository-check");
    expect(container?.textContent ?? "").toContain("Verification output");
    expect(container?.textContent ?? "").toContain("check failed");
  });

  it("searches selects and attaches project snippets to the next message context only after explicit clicks", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    expect(container?.textContent ?? "").toContain("query needs review");
    expect(container?.textContent ?? "").toContain("Explicit click only; no auto-search");
    expect(findButton("Search project snippets").disabled).toBe(true);
    await act(async () => {
      setInputValue(projectSnippetQueryInput(), "../secret");
    });
    expect(findButton("Search project snippets").disabled).toBe(true);
    expect(container?.textContent ?? "").toContain("Use literal text only; glob, regex, path traversal, shell, and special query operators are not allowed.");

    await act(async () => {
      setInputValue(projectSnippetQueryInput(), "chat composer");
    });
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.ideActionRequest" && message.payload?.action === "searchWorkspaceSnippets")).toHaveLength(0);

    await act(async () => {
      findButton("Search project snippets").click();
    });
    await act(async () => {
      findButton("Project snippet search pending…").click();
    });

    const searchMessages = postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === "gui.ideActionRequest" && message.payload?.action === "searchWorkspaceSnippets");
    expect(searchMessages).toHaveLength(1);
    expect(searchMessages[0]).toEqual({ version: bridgeVersion, type: "gui.ideActionRequest", requestId: "gui-workspace-snippet-search-1", payload: { action: "searchWorkspaceSnippets", query: "chat composer" } });

    await dispatchHostIdeActionResult("gui-workspace-snippet-search-1", workspaceSnippetSearchResultPayload());
    expect(container?.textContent ?? "").toContain("2 sanitized snippets returned for chat composer");
    expect(container?.textContent ?? "").toContain("Project snippet");
    expect(findButton("Attach selected snippets (0)").disabled).toBe(true);

    const snippetCheckboxes = Array.from(container?.querySelectorAll<HTMLInputElement>(".workspace-snippet-search-card input[type='checkbox']") ?? []);
    expect(snippetCheckboxes).toHaveLength(2);
    await act(async () => {
      snippetCheckboxes[0]?.click();
    });
    await act(async () => {
      findButton("Attach selected snippets (1)").click();
    });

    expect(container?.textContent ?? "").toContain("Attached 1 selected project snippet to the next message context. The bundle is one-shot and clears after accepted Send; use Remove snippet to detach before sending.");
    expect(findButton("Attach selected snippets (0)").disabled).toBe(true);
    expect(container?.textContent ?? "").toContain("1/4 excerpts");
    expect(container?.textContent ?? "").toContain("Remove snippet");
    await act(async () => {
      findButton("Remove snippet").click();
    });
    expect(container?.textContent ?? "").toContain("Removed one excerpt from the one-shot bundle.");
    expect(container?.textContent ?? "").toContain("empty");
    await act(async () => {
      snippetCheckboxes[0]?.click();
    });
    await act(async () => {
      findButton("Attach selected snippets (1)").click();
    });
    expect(container?.textContent ?? "").toContain("1/4 excerpts");
    fetchMock.mockClear();
    await act(async () => {
      setTextareaValue(chatInput(), "use attached snippet");
    });
    await act(async () => {
      findButton("Send").click();
      await Promise.resolve();
    });

    const body = lastUserMessageBody() as { payload?: { context?: { kind?: string; items?: Array<Record<string, unknown>> } } };
    expect(body.payload?.context?.kind).toBe("explicit_context_bundle");
    expect(body.payload?.context?.items).toEqual([{ kind: "workspace_snippet", workspaceRelativePath: "apps/gui/src/App.tsx", languageId: "typescript", range: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } }, text: "function ChatComposer() {\n  return null;\n}" }]);
    expect(container?.textContent ?? "").toContain("One-shot explicit context bundle attached to the last accepted message and cleared.");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("ChatComposer");
  });

  it("mirrors selected snippets into explicit controlled-run context preview without storage or hidden reads", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses(readyRuntimeOptions());
    renderApp();
    await flushAsync();

    await act(async () => { setInputValue(projectSnippetQueryInput(), "chat composer"); });
    await act(async () => { findButton("Search project snippets").click(); });
    await dispatchHostIdeActionResult("gui-workspace-snippet-search-1", workspaceSnippetSearchResultPayload());
    await act(async () => { Array.from(container?.querySelectorAll<HTMLInputElement>(".workspace-snippet-search-card input[type='checkbox']") ?? [])[0]?.click(); });
    await act(async () => { findButton("Attach selected snippets (1)").click(); });

    const text = container?.textContent ?? "";
    expect(text).toContain("Explicit controlled-run context");
    expect(text).toContain("VS Code visible selection");
    expect(text).toContain("Only the user-selected bounded context below is eligible for the controlled run preview.");
    expect(text).toContain("Selected bounded items: 1");
    expect(text).toContain("Total preview lines: 3");
    expect(text).toContain("function ChatComposer");
    expect(postMessage.mock.calls.filter(([message]) => message.type === "gui.controlledAgentFileReadRequest" || message.type === "gui.controlledRunRequest")).toHaveLength(0);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("ChatComposer");

    await act(async () => { setTextareaValue(chatInput(), "use selected context once"); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });

    expect(lastUserMessageBody()).toMatchObject({ payload: { context: { kind: "explicit_context_bundle" } } });
    expect(container?.textContent ?? "").toContain("One-shot explicit context bundle attached to the last accepted message and cleared.");
    expect(container?.textContent ?? "").not.toContain("Explicit controlled-run context");
    expect(browserStorageDump()).not.toContain("ChatComposer");
  });

  it("keeps selected project snippets after failed send and ignores stale unsafe results", async () => {
    const postMessage = vi.fn();
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    const rawSecret = "access_token=" + "w".repeat(64);
    window.acquireVsCodeApi = () => ({ postMessage });
    mockRuntimeResponses({ ...readyRuntimeOptions(), commandStatus: 500, commandError: "send failed safely" });
    renderApp();
    await flushAsync();

    await act(async () => { setInputValue(projectSnippetQueryInput(), "chat composer"); });
    await act(async () => { findButton("Search project snippets").click(); });
    await dispatchHostIdeActionResult("stale-snippet-search", workspaceSnippetSearchResultPayload({ message: "Stale snippet result ignored." }));
    expect(container?.textContent ?? "").toContain("Ignored stale IDE action result.");
    expect(container?.textContent ?? "").not.toContain("Stale snippet result ignored.");
    await dispatchHostIdeActionResult("gui-workspace-snippet-search-1", workspaceSnippetSearchResultPayload({ snippets: [{ workspaceRelativePath: "apps/gui/src/App.tsx", languageId: "typescript", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, text: `const token = \"\";` }] }));
    expect(container?.textContent ?? "").toContain("Search project snippets: pending");
    expect(container?.textContent ?? "").toContain("Rejected invalid host bridge message");
    expect(container?.textContent ?? "").not.toContain("access_token");

    await act(async () => { findButton("Clear pending project snippet search").click(); });
    await act(async () => { findButton("Search project snippets").click(); });
    await dispatchHostIdeActionResult("gui-workspace-snippet-search-2", workspaceSnippetSearchResultPayload());
    await act(async () => { Array.from(container?.querySelectorAll<HTMLInputElement>(".workspace-snippet-search-card input[type='checkbox']") ?? [])[0]?.click(); });
    await act(async () => { findButton("Attach selected snippets (1)").click(); });
    await act(async () => { setTextareaValue(chatInput(), "send fails with snippet"); });
    await act(async () => { findButton("Send").click(); await Promise.resolve(); });

    expect(chatInput().value).toBe("send fails with snippet");
    expect(container?.textContent ?? "").toContain("Project snippet");
    expect(container?.textContent ?? "").toContain("function ChatComposer");
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("ChatComposer");
    expect(browserStorageDump()).not.toContain(rawSecret);
  });

  it("renders project snippet search as browser preview-only without posting", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    delete window.postIntellijMessage;
    delete window.acquireVsCodeApi;
    if (appParentDescriptor) Object.defineProperty(window, "parent", appParentDescriptor);
    if (appReferrerDescriptor) Object.defineProperty(Document.prototype, "referrer", appReferrerDescriptor);
    mockRuntimeResponses();
    renderApp();
    await flushAsync();

    expect(container?.textContent ?? "").toContain("Project snippets");
    expect(container?.textContent ?? "").toContain("browser preview only");
    expect(container?.textContent ?? "").toContain("Open Yet AI in VS Code or JetBrains to request sanitized local workspace snippets.");
    expect(findButton("Search project snippets").disabled).toBe(true);
    await act(async () => {
      setInputValue(projectSnippetQueryInput(), "chat composer");
    });
    expect(findButton("Search project snippets").disabled).toBe(true);
    expect(localSetItem).not.toHaveBeenCalled();
    expect(browserStorageDump()).not.toContain("chat composer");
  });

  it("drops host apply results whose status is not in the bounded repair-guidance set", async () => {
    const postMessage = vi.fn();
    window.acquireVsCodeApi = () => ({ postMessage });
    const proposal = safeEditProposalPayload();
    mockRuntimeResponses({
      ...readyRuntimeOptions(),
      chats: [chatSummary("chat-001", "Unsafe status chat", 1)],
      chatThreads: { "chat-001": chatThread("chat-001", "Unsafe status chat", [chatMessage("chat-001", "assistant-1", "assistant", JSON.stringify(proposal))]) },
    });
    renderApp();
    await flushAsync();
    await flushAsync();

    // Unknown statuses are rejected by the bridge payload validator before reaching the panel,
    // so no result card or repair guidance is rendered for them.
    await dispatchHostApplyResult(undefined, {
      status: "exploded",
      message: "Should not render at all.",
      cloudRequired: false,
      appliedEditCount: 0,
      affectedFiles: [],
    });
    expect(container?.querySelector(".apply-result-card")).toBeNull();
    expect(container?.textContent ?? "").not.toContain("Should not render at all.");
    expect(container?.textContent ?? "").not.toContain("Edits were applied by the host after confirmation.");
    expect(container?.textContent ?? "").not.toContain("The host failed while applying.");
  });
});

function controlledHostCapabilitiesFixture() {
  return {
    protocolVersion: "controlled_host_capabilities_v2",
    hostSurface: "vscode",
    authority: "metadata_only",
    capabilities: {
      controlledStart: "supported",
      controlledRead: "supported",
      controlledEdit: "supported",
      controlledVerification: "supported",
      controlledRepair: "unsupported",
    },
    correlationRequirements: ["request_id", "runtime_session_id", "explicit_user_gesture"],
    authorityFlags: {
      metadataOnly: true,
      controlledRead: false,
      controlledEdit: false,
      controlledVerification: false,
      controlledStart: false,
      repair: false,
      shell: false,
      git: false,
      packageInstall: false,
      network: false,
      provider: false,
      tool: false,
      hiddenSearch: false,
      indexing: false,
      autoApply: false,
      autoRun: false,
      autoFix: false,
    },
    limits: {
      maxReadBytes: 8192,
      maxReadLines: 240,
      maxEditFiles: 1,
      maxEditOperations: 4,
      maxPatchBytes: 12000,
      maxVerificationOutputBytes: 12000,
      maxVerificationOutputLines: 240,
      maxRepairAttempts: 0,
    },
    reasonCodes: ["metadata_only", "explicit_user_gesture_required"],
    safeLabels: { host: "VS Code host", support: "Controlled dev-preview path ready" },
  };
}

async function dispatchHostReady(payload: { runtimeUrl?: string; runtimeProxyBaseUrl?: string; sessionToken?: string; controlledCapabilities?: Record<string, unknown> }) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.ready",
        payload: {
          ...payload,
          productId: "yet-ai",
          displayName: "Yet AI",
          cloudRequired: false,
        },
      },
    }));
  });
}

async function dispatchRuntimeStatus(payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.runtimeStatus",
        payload,
      },
    }));
  });
}

function runtimeStatusPayload(payload: Record<string, unknown> = {}) {
  return {
    protocolVersion: "2026-06-21",
    surface: "vscode",
    lifecycle: "connected",
    runtimeOwner: "ide_host",
    launchMode: "auto",
    tokenState: "present",
    processState: "running",
    diagnosis: "runtime connected",
    nextAction: "Type a prompt or refresh provider readiness.",
    cloudRequired: false,
    authority: "metadata_only",
    ...payload,
  };
}

async function dispatchHostContextSnapshot(payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.contextSnapshot",
        requestId: "context-001",
        payload: {
          kind: "active_editor",
          source: "vscode",
          ...payload,
        },
      },
    }));
  });
}

async function dispatchHostApplyResult(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.applyWorkspaceEditResult",
        requestId,
        payload,
      },
    }));
  });
}

async function dispatchHostIdeActionProgress(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.ideActionProgress",
        requestId,
        payload,
      },
    }));
  });
}

async function dispatchHostIdeActionResult(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.ideActionResult",
        requestId,
        payload,
      },
    }));
  });
}

async function dispatchHostMessage(message: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  });
}

async function dispatchHostControlledFileReadResult(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.controlledAgentFileReadResult",
        requestId,
        payload,
      },
    }));
  });
}

async function dispatchHostControlledEditResult(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.controlledAgentEditResult",
        requestId,
        payload,
      },
    }));
  });
}

async function dispatchHostControlledCommandRunResult(requestId: string | undefined, payload: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.controlledAgentCommandRunResult",
        requestId,
        payload,
      },
    }));
  });
}

function controlledReadHostMessage(requestId: string, requestPayload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const payload = JSON.parse(JSON.stringify(hostFileReadSuccess.payload)) as Record<string, any>;
  payload.request.requestId = overrides.requestId ?? requestId;
  payload.request.workspaceRelativePath = requestPayload.workspaceRelativePath;
  payload.workspace.runId = requestPayload.runId;
  payload.workspace.controlledWorkspaceId = requestPayload.controlledWorkspaceId;
  payload.result.text = overrides.text ?? payload.result.text;
  payload.result.sanitizedPathLabel = overrides.sanitizedPathLabel ?? requestPayload.workspaceRelativePath;
  return { requestId, payload };
}

function controlledEditMetadata(overrides: Record<string, unknown> = {}) {
  const replacementText = "const title = \"Yet AI\";\n";
  const metadata = JSON.parse(JSON.stringify(editExecutorPlanned)) as Record<string, any>;
  metadata.runId = "run-s84-request";
  metadata.workspaceReadinessId = "ready-s84-request";
  metadata.edits[0].replacementText = replacementText;
  metadata.edits[0].replacementByteCount = new TextEncoder().encode(replacementText).length;
  metadata.edits[0].sanitizedSummary = "Update selected UI metadata lines.";
  return { ...metadata, ...overrides };
}

function controlledEditHostMessage(requestId: string, requestPayload: Record<string, any>, overrides: Record<string, unknown> = {}) {
  const payload = JSON.parse(JSON.stringify(hostEditApplied.payload)) as Record<string, any>;
  payload.requestId = overrides.requestId ?? requestId;
  payload.runId = requestPayload.runId;
  payload.controlledWorkspaceId = requestPayload.controlledWorkspaceId;
  payload.runtimeSessionId = requestPayload.runtimeSessionId;
  payload.workspaceReadinessId = requestPayload.workspaceReadinessId;
  payload.edits = JSON.parse(JSON.stringify(requestPayload.edits));
  for (const edit of payload.edits) {
    delete edit.replacementText;
  }
  payload.result.message = overrides.message ?? payload.result.message;
  Object.assign(payload, overrides);
  return { requestId, payload };
}

function controlledCommandRunHostMessage(requestId: string, requestPayload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const status = overrides.status ?? "succeeded";
  const outputTail = overrides.outputTail ?? "Repository validation completed with sanitized metadata";
  const payload = {
    requestId: overrides.requestId ?? requestId,
    requestIdMintedBy: "gui",
    controlledWorkspaceId: requestPayload.controlledWorkspaceId,
    runId: requestPayload.runId,
    runtimeSessionId: requestPayload.runtimeSessionId,
    workspaceReadinessId: requestPayload.workspaceReadinessId,
    userConfirmed: true,
    commandId: requestPayload.commandId,
    authority: "allowlisted_command_id",
    cloudRequired: false,
    executionAllowed: false,
    freeformCommandAllowed: false,
    policyFlags: requestPayload.policyFlags,
    status,
    message: overrides.message ?? (status === "succeeded" ? "Repository validation succeeded safely." : "Checks failed safely."),
    exitCode: overrides.exitCode ?? (status === "succeeded" ? 0 : 1),
    durationMs: overrides.durationMs ?? 1234,
    outputTail,
    outputByteCount: String(outputTail).length,
    outputLineCount: 1,
    resultHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    truncated: overrides.truncated ?? false,
  } as Record<string, unknown>;
  Object.assign(payload, overrides);
  return { requestId, payload };
}

function workspaceSnippetSearchResultPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "succeeded",
    message: "Workspace snippets ready.",
    cloudRequired: false,
    action: "searchWorkspaceSnippets",
    queryLabel: "chat composer",
    resultCount: 2,
    snippets: [
      { workspaceRelativePath: "apps/gui/src/App.tsx", languageId: "typescript", range: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } }, text: "function ChatComposer() {\n  return null;\n}" },
      { workspaceRelativePath: "apps/gui/src/bridge/bridgeAdapter.ts", languageId: "typescript", range: { start: { line: 20, character: 0 }, end: { line: 22, character: 1 } }, text: "export type BridgeHost = \"browser\";" },
    ],
    truncated: false,
    ...overrides,
  };
}

function renderApp(options: { autoHostReady?: boolean } = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<App />);
  });
  if (options.autoHostReady === false || !window.acquireVsCodeApi) {
    return;
  }
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        version: bridgeVersion,
        type: "host.ready",
        payload: { runtimeUrl: "http://127.0.0.1:8001" },
      },
    }));
  });
}


function editProposalRequestId(): string {
  const match = (container?.textContent ?? "").match(/Proposal id: (gui-edit-proposal-\d+)/);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

type MockRuntimeOptions = {
  authStatusCode?: number;
  authMessage?: string;
  authSupportsLogin?: boolean;
  authResponse?: ProviderAuthResponse;
  startAuthUrl?: string;
  startAuthMessage?: string;
  startAuthStatus?: number;
  startAuthError?: string;
  exchangeResponse?: ProviderAuthResponse & { success: boolean };
  sseEvents?: unknown[];
  commandResponse?: Promise<Response>;
  commandStatus?: number;
  commandError?: string;
  providers?: unknown[];
  models?: unknown[];
  modelsFailure?: boolean;
  demoMode?: unknown;
  demoModeStatus?: number;
  demoModeSetResponse?: unknown;
  demoModeSetStatus?: number;
  runtimeFailure?: boolean;
  pingResponse?: unknown;
  capsResponse?: unknown;
  providerTestResponse?: unknown;
  providerTestStatus?: number;
  providerSaveResponse?: unknown;
  providerSaveStatus?: number;
  chats?: unknown[];
  chatThreads?: Record<string, unknown>;
  createChatThread?: unknown;
  agentProgress?: unknown;
  agentProgressStatus?: number;
  agentProgressError?: string;
  projectMemoryNotes?: unknown[];
};

function providerAuthResponse(status: ProviderAuthStatus): ProviderAuthResponse {
  const authSource = status === "api_key_configured" ? "api_key" : status === "login_unavailable" ? "none" : "oauth";
  return {
    provider: "openai",
    configured: status === "api_key_configured" || status === "connected",
    status,
    authSource,
    supportsLogin: status !== "login_unavailable" && status !== "api_key_configured",
    supportsApiKey: true,
    cloudRequired: false,
    message: `Mock status ${status}`,
    accountLabel: status === "connected" ? "user@example.test" : undefined,
    expiresAt: status === "connected" || status === "expired" ? "2026-05-24T01:00:00Z" : undefined,
    redacted: status === "api_key_configured" ? "sk-...test" : status === "connected" ? "oauth-...test" : undefined,
    pollIntervalSeconds: status === "pending" ? 5 : undefined,
  };
}

function pendingExperimentalAuthResponse(): ProviderAuthResponse {
  return {
    provider: "openai",
    configured: false,
    status: "pending",
    authSource: "oauth",
    supportsLogin: true,
    supportsApiKey: true,
    authorizationUrl: "https://auth.openai.com/oauth/authorize?client_id=yet-ai-local&state=codex-state-001",
    sessionId: "provider-login-session-001",
    expiresAt: "2026-05-24T01:00:00Z",
    scopes: ["openid", "profile", "email", "offline_access"],
    cloudRequired: false,
    message: "Experimental high-risk Codex-like OpenAI login is pending.",
  };
}

function connectedExperimentalAuthResponse(): ProviderAuthResponse & { success: boolean } {
  return {
    ...providerAuthResponse("connected"),
    success: true,
    message: "OpenAI login is connected.",
  };
}

function capsResponse(overrides: Record<string, unknown> = {}) {
  return {
    productId: "yet-ai",
    protocolVersion: "2026-05-15",
    runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" },
    capabilities: [],
    features: {},
    providers: [],
    ide: { bridge: true, lsp: false },
    ...overrides,
  };
}

function agentRunReadinessMetadata(overrides: Record<string, unknown> = {}) {
  return {
    checkpoint: {
      checkpointId: "checkpoint-s45-c2",
      checkpointVerified: true,
      checkpointHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      checkedAt: "2026-06-22T20:02:00Z",
    },
    sandbox: {
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
        confirmedAt: "2026-06-22T20:00:00Z",
        disposableWorkspaceAcknowledged: true,
        requestIdMintedBy: "gui",
      },
      limits: {
        maxSteps: 4,
        maxTouchedFiles: 4,
        maxPatchBytes: 12000,
        maxRuntimeSeconds: 600,
        workspaceRelativePaths: ["src/example.ts"],
      },
      checkpoint: {
        status: "verified",
        checkpointId: "checkpoint-s45-c2",
        createdAt: "2026-06-22T20:01:00Z",
        verified: true,
        fileCount: 1,
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      rollback: {
        status: "planned",
        planId: "rollback-s45-c2",
        planHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        affectedFileCount: 1,
        requiresUserConfirmation: true,
      },
    },
    policy: {
      kind: "tool_authority_policy",
      version: "2026-06-21",
      mode: "sandbox_preview",
      defaultDecision: "deny",
      cloudRequired: false,
      summary: "Allowlisted verification can be displayed only by command id and explicit confirmation.",
      capability: "allowlisted_verification",
      source: {
        origin: "gui",
        requestIdMintedBy: "gui",
        hostSurface: "vscode",
      },
      risk: ["metadata_only"],
      requirements: ["explicit_user_confirmation", "trusted_request_id", "schema_validation", "trace_entry", "allowlisted_command_id"],
      decision: "allow_with_confirmation",
      allowlistedCommandId: "repository-check",
    },
    verificationCommandId: "repository-check",
    ...overrides,
  };
}

function demoModeResponse(enabled: boolean) {
  return {
    enabled,
    providerId: "yet-demo",
    modelId: "yet-demo-chat",
    displayName: "Yet AI Demo Mode",
    cloudRequired: false,
    providerAccess: "direct",
    message: "Demo Mode uses local canned responses from the runtime. It requires no API key, makes no provider calls, and is not model quality.",
  };
}

function demoProvider() {
  return {
    id: "yet-demo",
    kind: "demo-local",
    displayName: "Yet AI Demo Mode",
    enabled: true,
    baseUrl: "local-runtime-demo-mode",
    auth: { type: "none", configured: true },
    models: [readyModel({ id: "yet-demo-chat", displayName: "Yet AI Demo Chat" })],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function enabledProvider() {
  return {
    id: "openai-api",
    kind: "openai-compatible",
    displayName: "OpenAI API",
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "api_key", configured: true, redacted: "sk-...test" },
    models: [readyModel()],
    capabilities: { chat: true, completion: false, embeddings: false },
  };
}

function readyModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "gpt-4o-mini",
    displayName: "GPT-4o mini",
    capabilities: { chat: true, streaming: true, tools: false, reasoning: false },
    readiness: { status: "ready" },
    ...overrides,
  };
}

function readyRuntimeOptions(): Pick<MockRuntimeOptions, "providers" | "models"> {
  return {
    providers: [enabledProvider()],
    models: [readyModel({ providerId: "openai-api" })],
  };
}

function chatSummary(chatId: string, title: string, messageCount: number) {
  return {
    chatId,
    title,
    createdAt: "2026-05-29T07:15:00Z",
    updatedAt: "2026-05-29T07:16:30Z",
    messageCount,
  };
}

function chatMessage(chatId: string, id: string, role: "user" | "assistant" | "error", content: string, status: "complete" | "error" = "complete") {
  return {
    id,
    chatId,
    role,
    content,
    createdAt: "2026-05-29T07:15:00Z",
    status,
  };
}

function chatMessageWithoutStatus(chatId: string, id: string, role: "user" | "assistant" | "error", content: string) {
  return {
    id,
    chatId,
    role,
    content,
    createdAt: "2026-05-29T07:15:00Z",
  };
}

function chatThread(chatId: string, title: string, messages: unknown[]) {
  return {
    chatId,
    title,
    createdAt: "2026-05-29T07:15:00Z",
    updatedAt: "2026-05-29T07:16:30Z",
    messages,
  };
}

function safeEditProposalPayload() {
  return {
    requiresUserConfirmation: true,
    summary: "Replace one visible editor line after user review.",
    cloudRequired: false,
    edits: [
      {
        workspaceRelativePath: "src/example.ts",
        textReplacements: [
          {
            range: { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } },
            replacementText: "const label = \"Yet AI\";",
          },
        ],
      },
    ],
  };
}

function controlledProviderProposalPayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: "controlled_agent_provider_proposal",
    version: "2026-07-07",
    authority: "provider_proposal_metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    providerToolCallingAllowed: false,
    rawProviderPayloadStored: false,
    automaticApplyAllowed: false,
    automaticRunAllowed: false,
    workspace: { controlledWorkspaceId: "workspace-1", runId: "run-1", workspaceMode: "worktree", host: "vscode", privatePathExposed: false },
    providerProposal: {
      proposalId: "model-proposal-1",
      source: "model",
      sanitizedOnly: true,
      rawPayloadStored: false,
      toolCallsIncluded: false,
      automaticActionsIncluded: false,
      summary: "Review a bounded model proposal.",
      plan: { stepCount: 2, steps: ["Review visible metadata", "Wait for manual apply"] },
      editMetadata: { operation: "replace", workspaceRelativePath: "apps/gui/src/App.tsx", expectedContentHash: `sha256:${"a".repeat(64)}`, startLine: 3, endLine: 3, replacementByteCount: 42, rawReplacementStored: false, rawDiffStored: false, requiresUserApply: true },
      verificationSuggestion: { commandId: "gui-app-tests", allowlistedCommandIdOnly: true, freeformCommandAllowed: false, requiresUserRun: true },
    },
    policyFlags: {
      metadataOnly: true,
      boundedPlanMetadataAllowed: true,
      boundedEditMetadataAllowed: true,
      providerToolCallingAllowed: false,
      rawProviderPayloadPersistenceAllowed: false,
      rawPromptPersistenceAllowed: false,
      rawFilePersistenceAllowed: false,
      rawDiffPersistenceAllowed: false,
      rawCommandPersistenceAllowed: false,
      rawOutputPersistenceAllowed: false,
      automaticApplyAllowed: false,
      automaticRunAllowed: false,
      automaticVerifyAllowed: false,
      automaticRepairAllowed: false,
      shellAllowed: false,
      gitAllowed: false,
      networkAllowed: false,
      packageInstallAllowed: false,
      hiddenReadAllowed: false,
      searchAllowed: false,
      indexingAllowed: false,
      toolAuthorityAllowed: false,
    },
    ...overrides,
  };
}

function agentRunMultiStepPlanPreview() {
  return {
    version: "2026-06-25",
    kind: "agent_run.multistep_plan",
    authority: "metadata_only",
    cloudRequired: false,
    executionAllowed: false,
    title: "Review Agent Run plan preview",
    summary: "Display a safe inert plan preview before future manual actions.",
    steps: [
      {
        id: "step-1",
        title: "Inspect current UI",
        summary: "Confirm the review-only state",
        status: "preview_only",
        expectedTouchedFiles: ["apps/gui/src/components/AgentRunPanel.tsx"],
        riskLabels: ["copy review"],
      },
      {
        id: "step-2",
        title: "Add focused tests",
        summary: "Cover safe rendering without workspace changes",
        status: "preview_only",
        expectedTouchedFiles: ["apps/gui/src/App.test.tsx"],
        riskLabels: ["test stability"],
      },
    ],
    risks: ["Copy may need owner review"],
    expectedTouchedFiles: ["apps/gui/src/components/AgentRunPanel.tsx", "apps/gui/src/App.test.tsx"],
    verificationSuggestions: [
      {
        commandId: "gui-app-tests",
        label: "GUI app tests",
        description: "Run the focused GUI application test gate after explicit user selection.",
        riskLevel: "medium",
        expectedDuration: "Usually 5 to 10 minutes",
        cwdPolicyLabel: "Repository root selected by host",
        outputBoundLabel: "Sanitized tail only",
      },
    ],
    manualActionPolicy: {
      noAutoSend: true,
      noAutoApply: true,
      noAutoVerification: true,
      noAutoRollback: true,
      noHiddenReads: true,
      requiresExplicitUserAction: true,
    },
  };
}

function demoModeSafeEditProposalPayload() {
  return {
    requiresUserConfirmation: true,
    summary: "Demo Mode safe edit no-op preview. No provider call was made; this is a local canned response, not model quality. This proposal preserves the current selection only when the same context includes a valid workspace-relative path; otherwise it uses an empty zero-length preview fallback.",
    cloudRequired: false,
    edits: [
      {
        workspaceRelativePath: "src/example.ts",
        textReplacements: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            replacementText: "",
          },
        ],
      },
    ],
  };
}

function demoModeSafeEditProposalEnvelope(proposal = demoModeSafeEditProposalPayload(), requestId?: string) {
  return {
    type: "gui.applyWorkspaceEditRequest",
    version: bridgeVersion,
    ...(requestId ? { requestId } : {}),
    payload: proposal,
  };
}

function testRange() {
  return { start: { line: 4, character: 2 }, end: { line: 4, character: 18 } };
}

function ideActionProposal(overrides: Record<string, unknown>) {
  return {
    type: "assistant.ideActionProposal",
    version: bridgeVersion,
    requiresUserConfirmation: true,
    cloudRequired: false,
    ...overrides,
  };
}

function agentProgressResponse(snapshots: unknown[] = []) {
  return { cloudRequired: false, providerAccess: "direct", generatedAt: "2026-05-29T15:00:00Z", snapshots };
}

function agentProgressSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "2026-05-29",
    runId: "run-001",
    cardId: "T-277",
    startedAt: "2026-05-29T14:00:00Z",
    updatedAt: "2026-05-29T14:01:00Z",
    phase: "running_command",
    status: "healthy_running",
    message: "Running verification",
    elapsedMs: 61000,
    ageMs: 1000,
    currentTool: { kind: "test", label: "npm test", startedAt: "2026-05-29T14:00:30Z", elapsedMs: 30000 },
    stuckReason: "none",
    recentEvents: [
      { eventId: "event-001", timestamp: "2026-05-29T14:00:30Z", phase: "running_command", status: "healthy_running", message: "Started test command" },
    ],
    ...overrides,
  };
}

function projectMemoryNote(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-001",
    title: "Architecture decision",
    text: "Use engine-owned local memory only.",
    tags: ["architecture"],
    source: "manual",
    createdAt: "2026-06-17T12:00:00Z",
    updatedAt: "2026-06-17T12:00:00Z",
    ...overrides,
  };
}

function mockStreamingReadyRuntime(options: { abortResponse?: Promise<Response> } = {}) {
  let sseController: ReadableStreamDefaultController<Uint8Array> | undefined;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/chats/subscribe?chat_id=")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          sseController = controller;
        },
        cancel() {},
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    }
    if (url.endsWith("/v1/ping")) {
      return Promise.resolve(jsonResponse({ productId: "yet-ai", displayName: "Yet AI", version: "0.0.0", ready: true, serverTime: "2026-05-24T00:00:00Z" }));
    }
    if (url.endsWith("/v1/caps")) {
      return Promise.resolve(jsonResponse({ productId: "yet-ai", protocolVersion: "2026-05-15", runtime: { mode: "local", cloudRequired: false, providerAccess: "direct" }, capabilities: [], features: {}, providers: [], ide: { bridge: true, lsp: false } }));
    }
    if (url.endsWith("/v1/models")) {
      return Promise.resolve(jsonResponse({ models: [readyModel({ providerId: "openai-api" })] }));
    }
    if (url.endsWith("/v1/providers")) {
      return Promise.resolve(jsonResponse({ providers: [enabledProvider()], cloudRequired: false, providerAccess: "direct" }));
    }
    if (url.endsWith("/v1/provider-auth/openai/status")) {
      return Promise.resolve(jsonResponse(providerAuthResponse("login_unavailable")));
    }
    if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
      if ((JSON.parse(String(init.body)) as { type?: string }).type === "abort" && options.abortResponse) {
        return options.abortResponse;
      }
      return Promise.resolve(jsonResponse({ accepted: true, chatId: "chat-001", requestId: "request-001", type: JSON.parse(String(init.body)).type }));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { close: () => sseController?.close() };
}

function abortCommandCalls() {
  return fetchMock.mock.calls.filter(([url, init]) => {
    if (!String(url).includes("/v1/chats/") || !String(url).endsWith("/commands") || init?.method !== "POST") {
      return false;
    }
    return (JSON.parse(String(init.body)) as { type?: string }).type === "abort";
  });
}

function lastUserMessageBody() {
  const commandCalls = fetchMock.mock.calls.filter(([url, init]) => (String(url).endsWith("/v1/chats/chat-001/commands") || String(url).endsWith("/v1/chats/chat-002/commands")) && init?.method === "POST");
  for (let index = commandCalls.length - 1; index >= 0; index -= 1) {
    const commandCall = commandCalls[index];
    const body = JSON.parse(String(commandCall[1]?.body)) as { type?: string; payload?: Record<string, unknown> };
    if (body.type === "user_message") {
      return body;
    }
  }
  throw new Error("User message command not found");
}

function mockRuntimeResponse(input: RequestInfo | URL, init: RequestInit | undefined, options: MockRuntimeOptions = {}) {
  const url = String(input);
  if (url.endsWith("/v1/provider-auth/openai/status")) {
    if (options.authStatusCode) {
      return Promise.resolve(jsonResponse({ error: "raw-secret should not appear" }, options.authStatusCode));
    }
    return Promise.resolve(jsonResponse(options.authResponse ?? {
      provider: "openai",
      configured: false,
      status: options.authSupportsLogin ? "login_available" : "login_unavailable",
      authSource: "none",
      supportsLogin: options.authSupportsLogin ?? false,
      supportsApiKey: true,
      cloudRequired: false,
      message: options.authMessage ?? "Experimental account login (non-default) is not available for this local provider path. Create an API key in the provider console and paste it once into Yet AI.",
    }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/start")) {
    if (options.startAuthStatus) {
      return Promise.resolve(jsonResponse({ error: options.startAuthError ?? "invalid provider auth request" }, options.startAuthStatus));
    }
    return Promise.resolve(jsonResponse({
      provider: "openai",
      configured: false,
      status: "pending",
      authSource: "oauth",
      supportsLogin: true,
      supportsApiKey: true,
      authorizationUrl: options.startAuthUrl ?? "https://auth.openai.com/oauth/authorize?state=test",
      sessionId: "provider-login-session-001",
      expiresAt: "2026-05-24T01:00:00Z",
      scopes: ["openid", "profile", "email", "offline_access"],
      cloudRequired: false,
      success: true,
      message: options.startAuthMessage ?? "Open the authorization URL to continue signing in.",
    }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/exchange")) {
    return Promise.resolve(jsonResponse(options.exchangeResponse ?? connectedExperimentalAuthResponse()));
  }
  if (init?.method === "POST" && url.endsWith("/v1/provider-auth/openai/disconnect")) {
    return Promise.resolve(jsonResponse({ ...providerAuthResponse("not_configured"), success: true }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/providers")) {
    return Promise.resolve(jsonResponse(options.providerSaveResponse ?? {
      id: "openai-compatible-custom",
      kind: "openai-compatible",
      displayName: "OpenAI-Compatible Provider",
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      auth: { type: "api_key", configured: true, redacted: "sk-...test" },
      models: [readyModel({ displayName: "gpt-4o-mini" })],
      capabilities: { chat: true, completion: false, embeddings: false },
    }, options.providerSaveStatus ?? 200));
  }
  if (init?.method === "PATCH" && url.includes("/v1/providers/")) {
    return Promise.resolve(jsonResponse(options.providerSaveResponse ?? enabledProvider(), options.providerSaveStatus ?? 200));
  }
  if (init?.method === "POST" && url.includes("/v1/providers/") && url.endsWith("/test")) {
    return Promise.resolve(jsonResponse(options.providerTestResponse ?? {
      ok: true,
      providerId: "openai-api",
      status: "reachable",
      message: "Provider is reachable and accepted the configured credentials.",
      modelId: "gpt-4o-mini",
      cloudRequired: false,
    }, options.providerTestStatus ?? 200));
  }
  if (url.endsWith("/v1/chats") && init?.method === "POST") {
    return Promise.resolve(jsonResponse(options.createChatThread ?? chatThread("chat-new", "New local chat", [])));
  }
  if (url.endsWith("/v1/chats")) {
    return Promise.resolve(jsonResponse({ chats: options.chats ?? [] }));
  }
  if (url.endsWith("/v1/agent-progress")) {
    if (options.agentProgressStatus) {
      return Promise.resolve(jsonResponse({ error: options.agentProgressError ?? "agent progress unavailable" }, options.agentProgressStatus));
    }
    return Promise.resolve(jsonResponse(options.agentProgress ?? agentProgressResponse()));
  }
  if (url.endsWith("/v1/project-memory/search") && init?.method === "POST") {
    return Promise.resolve(jsonResponse({ matches: (options.projectMemoryNotes ?? []).map((note) => ({ note, scoreLabel: "text" })), cloudRequired: false, providerAccess: "direct", queryLabel: JSON.parse(String(init.body)).query }));
  }
  if (url.endsWith("/v1/project-memory") && init?.method === "POST") {
    return Promise.resolve(jsonResponse(projectMemoryNote(JSON.parse(String(init.body)))));
  }
  const memoryMatch = /\/v1\/project-memory\/([^/?]+)$/.exec(url);
  if (memoryMatch && init?.method === "DELETE") {
    return Promise.resolve(jsonResponse({ deleted: true, noteId: decodeURIComponent(memoryMatch[1]) }));
  }
  if (url.endsWith("/v1/project-memory")) {
    return Promise.resolve(jsonResponse({ notes: options.projectMemoryNotes ?? [], cloudRequired: false, providerAccess: "direct" }));
  }
  const chatMatch = /\/v1\/chats\/([^/?]+)$/.exec(url);
  if (chatMatch && init?.method === "DELETE") {
    return Promise.resolve(jsonResponse({ deleted: true, chatId: decodeURIComponent(chatMatch[1]) }));
  }
  if (chatMatch) {
    const requestedChatId = decodeURIComponent(chatMatch[1]);
    return Promise.resolve(jsonResponse(options.chatThreads?.[requestedChatId] ?? chatThread(requestedChatId, requestedChatId, [])));
  }
  if (url.includes("/v1/chats/subscribe?chat_id=")) {
    return Promise.resolve(sseResponse(options.sseEvents ?? []));
  }
  if (init?.method === "POST" && url.includes("/v1/chats/") && url.endsWith("/commands")) {
    if (options.commandResponse) {
      return options.commandResponse;
    }
    if (options.commandStatus) {
      return Promise.resolve(jsonResponse({ error: options.commandError ?? "command failed" }, options.commandStatus));
    }
    return Promise.resolve(jsonResponse({
      accepted: true,
      chatId: "chat-001",
      requestId: "request-001",
      type: "user_message",
    }));
  }
  if (url.endsWith("/v1/ping")) {
    if (options.runtimeFailure) {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8001"));
    }
    return Promise.resolve(jsonResponse(options.pingResponse ?? {
      productId: "yet-ai",
      displayName: "Yet AI",
      version: "0.0.0",
      ready: true,
      serverTime: "2026-05-24T00:00:00Z",
    }));
  }
  if (url.endsWith("/v1/caps")) {
    if (options.runtimeFailure) {
      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:8001"));
    }
    return Promise.resolve(jsonResponse(options.capsResponse ?? capsResponse()));
  }
  if (url.endsWith("/v1/models")) {
    if (options.modelsFailure) {
      return Promise.resolve(jsonResponse({ error: "models unavailable" }, 503));
    }
    return Promise.resolve(jsonResponse({ models: options.models ?? [] }));
  }
  if (init?.method === "POST" && url.endsWith("/v1/demo-mode")) {
    return Promise.resolve(jsonResponse(options.demoModeSetResponse ?? demoModeResponse(JSON.parse(String(init.body)).enabled === true), options.demoModeSetStatus ?? 200));
  }
  if (url.endsWith("/v1/demo-mode")) {
    return Promise.resolve(jsonResponse(options.demoMode ?? demoModeResponse(false), options.demoModeStatus ?? 200));
  }
  if (url.endsWith("/v1/providers")) {
    return Promise.resolve(jsonResponse({ providers: options.providers ?? [], cloudRequired: false, providerAccess: "direct" }));
  }
  return Promise.resolve(jsonResponse({}));
}

function mockRuntimeResponses(options: MockRuntimeOptions = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => mockRuntimeResponse(input, init, options));
  vi.stubGlobal("fetch", fetchMock);
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function browserStorageDump() {
  const values: string[] = [];
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) {
        values.push(key, storage.getItem(key) ?? "");
      }
    }
  }
  return values.join("\n");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function findButton(name: string) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((item) => item.textContent === name);
  if (!button) {
    throw new Error(`Button not found: ${name}`);
  }
  return button;
}

function findConversationButton(label: RegExp) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button.conversation-select") ?? []).find((item) => label.test(item.getAttribute("aria-label") ?? ""));
  if (!button) {
    throw new Error(`Conversation button not found: ${label}`);
  }
  return button;
}

function expectConversationRowParts(title: string, expected: { updated: string; messages: string; position: string }) {
  const button = findConversationButton(new RegExp(`^(Open conversation|Current conversation): ${escapeRegExp(title)}`));
  const titleLine = button.querySelector<HTMLElement>(".conversation-title-line");
  const metaLine = button.querySelector<HTMLElement>(".conversation-meta-line");
  expect(titleLine?.querySelector(".conversation-title")?.textContent).toBe(title);
  expect(metaLine?.querySelector(".conversation-updated")?.textContent).toBe(expected.updated);
  expect(metaLine?.querySelector(".conversation-message-count")?.textContent).toBe(expected.messages);
  expect(metaLine?.querySelector(".conversation-position")?.textContent).toBe(expected.position);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buttonsNamed(name: string) {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter((item) => item.textContent === name);
}

function buttonWithin(parent: HTMLElement, name: string) {
  const button = Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === name);
  if (!button) {
    throw new Error(`Button not found within element: ${name}`);
  }
  return button;
}

function findDetails(id: string) {
  const details = container?.querySelector(`[data-testid='${id}']`);
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error(`Details not found: ${id}`);
  }
  return details;
}

function findInputValue(value: string) {
  return Array.from(container?.querySelectorAll<HTMLInputElement>("input") ?? []).find((input) => input.value === value);
}

function findSelectValue(value: string) {
  return Array.from(container?.querySelectorAll<HTMLSelectElement>("select") ?? []).find((select) => select.value === value);
}

function sessionTokenInput() {
  const input = runtimeSessionTokenInputOptional();
  if (!input) {
    throw new Error("Session token input not found");
  }
  return input;
}

function runtimeSessionTokenInputOptional() {
  return Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []).find((input) => input.placeholder === "Bearer token for local runtime");
}

function apiKeyInput() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []).find((item) => item.placeholder === "Provider API key, not the runtime Session token");
  if (!input) {
    throw new Error("API key input not found");
  }
  return input;
}

function authCodeInput() {
  const input = authCodeInputOptional();
  if (!input) {
    throw new Error("Authorization code input not found");
  }
  return input;
}

function authCodeInputOptional() {
  return Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []).find((item) => item.placeholder === "Paste authorization code");
}

function projectSnippetQueryInput(): HTMLInputElement {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>(".workspace-snippet-search-card input") ?? []).find((item) => item.placeholder === "function name or symbol text");
  if (!input) {
    throw new Error("Project snippet query input not found");
  }
  return input;
}

function chatInput() {
  const textarea = container?.querySelector<HTMLTextAreaElement>(".composer-input-area textarea");
  if (!textarea) {
    throw new Error("Chat textarea not found");
  }
  return textarea;
}

function manualRunnerPanel() {
  const panel = container?.querySelector<HTMLElement>("[aria-label='Manual runner coding loop']");
  if (!panel) {
    throw new Error("Manual runner panel not found");
  }
  return panel;
}

function agentRunPanel() {
  const panel = container?.querySelector<HTMLElement>("[data-testid='agent-run-panel']");
  if (!panel) {
    throw new Error("Agent Run panel not found");
  }
  return panel;
}

function codingTaskSessionPanel() {
  const panel = container?.querySelector<HTMLElement>("[aria-label='Coding task session']");
  if (!panel) {
    throw new Error("Coding task session panel not found");
  }
  return panel;
}

function proposalHistoryPanel() {
  const panel = container?.querySelector<HTMLElement>("[data-testid='proposal-history-panel']");
  if (!panel) {
    throw new Error("Proposal history panel not found");
  }
  return panel;
}

function whatWillBeSentPanel() {
  const panel = whatWillBeSentPanelOptional();
  if (!panel) {
    throw new Error("What will be sent panel not found");
  }
  return panel;
}

function whatWillBeSentPanelOptional() {
  return container?.querySelector<HTMLElement>("[aria-label='What will be sent']") ?? undefined;
}

function manualRunnerDraftTextarea() {
  const textarea = manualRunnerPanel().querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) {
    throw new Error("Manual runner draft textarea not found");
  }
  return textarea;
}

function manualRunnerProposalCardOptional() {
  return container?.querySelector<HTMLElement>("[aria-label='Manual runner plan proposal review']") ?? undefined;
}

function manualRunnerProposalCard() {
  const card = manualRunnerProposalCardOptional();
  if (!card) {
    throw new Error("Manual runner plan proposal card not found");
  }
  return card;
}

function manualRunnerPlanProposal(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "2026-05-29",
    kind: "manual_runner_plan_proposal",
    title: "Review local provider readiness",
    steps: ["Inspect readiness state", "Confirm local model labels"],
    rationale: "Display the proposed review path before any user-mediated action.",
    nextAction: "Ask the user to review the proposal",
    ...overrides,
  };
}

function chatLifecycleText() {
  const lifecycle = container?.querySelector<HTMLElement>(".chat-lifecycle-state");
  if (!lifecycle) {
    throw new Error("Chat lifecycle state not found");
  }
  return lifecycle.textContent ?? "";
}

function activeFileExcerptToggle() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>(".active-file-excerpt-card input[type='checkbox']") ?? [])[0];
  if (!input) {
    throw new Error("Active file excerpt toggle not found");
  }
  return input;
}

function activeFileExcerptToggleOptional() {
  return Array.from(container?.querySelectorAll<HTMLInputElement>(".active-file-excerpt-card input[type='checkbox']") ?? [])[0];
}

function activeFileExcerptResultPayload(options: { text?: string; source?: "vscode" | "jetbrains"; truncated?: boolean; path?: string; startLine?: number } = {}) {
  return {
    status: "succeeded",
    message: "Active file excerpt ready.",
    cloudRequired: false,
    action: "getActiveFileExcerpt",
    contextAttachment: {
      kind: "active_file_excerpt",
      source: options.source ?? "vscode",
      file: { displayPath: options.path ?? "src/editor.ts", workspaceRelativePath: options.path ?? "src/editor.ts", languageId: "typescript" },
      range: { start: { line: options.startLine ?? 10, character: 0 }, end: { line: (options.startLine ?? 10) + 14, character: 1 } },
      text: options.text ?? "export function greet() {\n  return \"hello\";\n}\n",
      truncated: options.truncated ?? false,
    },
  };
}

function attachedContextToggle() {
  const input = attachedContextToggleOptional();
  if (!input) {
    throw new Error("Attached context toggle not found");
  }
  return input;
}

function attachedContextToggleOptional() {
  return Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []).find((item) => item.parentElement?.textContent?.includes("Attach to next message") || item.parentElement?.textContent?.includes("Do not attach"));
}

function attachedContextAcknowledgementToggle() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []).find((item) => item.parentElement?.textContent?.includes("I understand the hidden selected text may be included"));
  if (!input) {
    throw new Error("Attached context acknowledgement toggle not found");
  }
  return input;
}

function runtimeBaseUrlInput() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>("input") ?? []).find((item) => item.parentElement?.textContent?.includes("Runtime base URL"));
  if (!input) {
    throw new Error("Runtime base URL input not found");
  }
  return input;
}

function chatIdInput() {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>("input") ?? []).find((item) => item.parentElement?.textContent?.includes("Chat id"));
  if (!input) {
    throw new Error("Chat id input not found");
  }
  return input;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findInputByPlaceholder(placeholder: string) {
  const input = Array.from(container?.querySelectorAll<HTMLInputElement>("input") ?? []).find((item) => item.placeholder.includes(placeholder));
  if (!input) {
    throw new Error(`Input placeholder not found: ${placeholder}`);
  }
  return input;
}

function findTextareaByPlaceholder(placeholder: string) {
  const input = Array.from(container?.querySelectorAll<HTMLTextAreaElement>("textarea") ?? []).find((item) => item.placeholder.includes(placeholder));
  if (!input) {
    throw new Error(`Textarea placeholder not found: ${placeholder}`);
  }
  return input;
}

function setTextareaByPlaceholder(placeholder: string, value: string) {
  setTextareaValue(findTextareaByPlaceholder(placeholder), value);
}

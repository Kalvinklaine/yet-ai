// @vitest-environment jsdom
import { act, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectChatLaunchIntent, clearProjectChatLaunchIntent } from "./projectChatLaunchIntent";
import { ProjectScopeController } from "./projectScope";
import { createProjectRuntimeSettings } from "./projectClient";
import type { ChatRuntimeSettings, ChatThread } from "./runtimeClient";
import { useProjectLaunchController } from "./useProjectLaunchController";
import type { ExplicitContextBundleItem } from "./activeEditorContext";

const projectA = "prj_AAAAAAAAAAAAAAAAAAAAAA";
const projectB = "prj_BBBBBBBBBBBBBBBBBBBBBQ";
const generation = "ready-1";
let root: ReactDOM.Root | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function thread(chatId: string): ChatThread {
  return { chatId, title: chatId, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", messages: [] };
}

type ProbeProps = {
  projectId: string;
  chatId: string | null;
  revision?: number;
  onCreated: (created: ChatThread) => void;
  onItems: (items: ExplicitContextBundleItem[]) => void;
  onNavigate: (chatId: string) => void;
};

function Probe({ projectId, chatId, revision = 0, onCreated, onItems, onNavigate }: ProbeProps) {
  const settingsRef = useRef<ChatRuntimeSettings>(createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" }, projectId));
  const revisionRef = useRef(revision);
  const chatIdRef = useRef<string | null>(chatId);
  const scopeRef = useRef(new ProjectScopeController(projectId as never));
  const [items, setItems] = useState<ExplicitContextBundleItem[]>([]);
  settingsRef.current = createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" }, projectId, scopeRef.current.current());
  revisionRef.current = revision;
  chatIdRef.current = chatId;
  useProjectLaunchController({
    projectId,
    showChatPage: true,
    projectPage: "chat",
    hostReadyGeneration: generation,
    projectHostAuthorityReady: true,
    activeChatSummary: chatId ? { chatId, title: chatId, createdAt: "now", updatedAt: "now", messageCount: 0 } : undefined,
    chatId,
    launchIntentScopeKey: `${projectId}:chat:draft:${generation}:${revision}`,
    settingsRef,
    settingsRevisionRef: revisionRef,
    chatIdRef,
    projectScopeController: scopeRef.current,
    abortActiveStream: () => undefined,
    setChatInput: () => undefined,
    applyCreatedChat: (created) => onCreated(created),
    navigateToCreatedChat: onNavigate,
    setExplicitContextBundleItems: setItems,
    setIncludeExplicitContextBundle: () => undefined,
    setExplicitContextBundleStatus: () => undefined,
  });
  useEffect(() => onItems(items), [items, onItems]);
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
  clearProjectChatLaunchIntent();
  vi.unstubAllGlobals();
});

describe("useProjectLaunchController", () => {
  it("ignores a stale Start-new create completion after project replacement", async () => {
    const create = deferred<Response>();
    const onCreated = vi.fn();
    const onNavigate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => create.promise));
    createProjectChatLaunchIntent({ projectId: projectA, source: "project_home", selectedNoteIds: ["note-1"], lifecycleGeneration: generation });
    const props = { projectId: projectA, chatId: null, onCreated, onItems: vi.fn(), onNavigate };
    await render(props);
    await act(async () => {
      root?.render(<Probe {...props} projectId={projectB} />);
      create.resolve(response(thread("chat-stale")));
      await Promise.resolve();
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("ignores stale selected-memory completion after the chat changes", async () => {
    const memory = deferred<Response>();
    const onItems = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => memory.promise));
    createProjectChatLaunchIntent({ projectId: projectA, chatId: "chat-one", source: "project_home", selectedNoteIds: ["note-1"], lifecycleGeneration: generation });
    const props = { projectId: projectA, chatId: "chat-one", onCreated: vi.fn(), onItems, onNavigate: vi.fn() };
    await render(props);
    await act(async () => {
      root?.render(<Probe {...props} chatId="chat-two" />);
      memory.resolve(response({ notes: [{ id: "note-1", title: "Note", text: "Safe selected memory", tags: [], source: "manual", createdAt: "now", updatedAt: "now" }] }));
      await Promise.resolve();
    });
    expect(onItems.mock.calls.some(([items]) => items.length > 0)).toBe(false);
  });

  it("does not duplicate the memory request when the effect is invoked again", async () => {
    const memory = deferred<Response>();
    const fetchMock = vi.fn(() => memory.promise);
    vi.stubGlobal("fetch", fetchMock);
    createProjectChatLaunchIntent({ projectId: projectA, chatId: "chat-one", source: "project_home", selectedNoteIds: ["note-1"], lifecycleGeneration: generation });
    const props = { projectId: projectA, chatId: "chat-one", onCreated: vi.fn(), onItems: vi.fn(), onNavigate: vi.fn() };
    await render(props);
    await act(async () => {
      root?.render(<Probe {...props} />);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      memory.resolve(response({ notes: [] }));
      await Promise.resolve();
    });
  });
});

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { addExplicitContextBundleItem, projectMemoryToBundleItem, type ExplicitContextBundleItem, type ProjectMemoryBundleItem } from "./activeEditorContext";
import { selectControlledRunProjectMemory } from "./controlledRunProjectMemorySelection";
import { bindProjectChatLaunchIntentChatId, clearProjectChatLaunchIntent, consumeProjectChatLaunchIntent, getBrowserProjectChatLifecycleGeneration, peekProjectChatLaunchIntent } from "./projectChatLaunchIntent";
import { listProjectMemory } from "./projectMemoryClient";
import { createProjectScopeCorrelation, type ProjectScopeController, type ProjectScopeCorrelation } from "./projectScope";
import { createChat, type ChatRuntimeSettings, type ChatSummary, type ChatThread } from "./runtimeClient";

export type LaunchIntentCreateState =
  | { state: "idle" }
  | { state: "creating"; intentKey: string; scopeKey: string }
  | { state: "failed"; intentKey: string; scopeKey: string };

export type LaunchMemoryBundleMerge = {
  items: ExplicitContextBundleItem[];
  addedCount: number;
  duplicateCount: number;
  capacityOmittedCount: number;
  selectionOmittedCount: number;
  status: string;
};

export function mergeLaunchMemoryBundleItems(current: ExplicitContextBundleItem[], candidates: ProjectMemoryBundleItem[], selectedCount: number): LaunchMemoryBundleMerge {
  let items = current;
  let addedCount = 0;
  let duplicateCount = 0;
  let capacityOmittedCount = 0;
  for (const candidate of candidates) {
    if (items.some((item) => item.key === candidate.key)) {
      duplicateCount += 1;
      continue;
    }
    const next = addExplicitContextBundleItem(items, candidate);
    if (next === items) {
      capacityOmittedCount += 1;
      continue;
    }
    items = next;
    addedCount += 1;
  }
  const selectionOmittedCount = Math.max(0, selectedCount - candidates.length);
  const omissions = [
    selectionOmittedCount > 0 ? `${selectionOmittedCount} unavailable or unsafe` : "",
    duplicateCount > 0 ? `${duplicateCount} already attached` : "",
    capacityOmittedCount > 0 ? `${capacityOmittedCount} did not fit controlled bundle limits` : "",
  ].filter(Boolean);
  const omissionStatus = omissions.length > 0 ? ` ${omissions.join(", ")} selected note${selectionOmittedCount + duplicateCount + capacityOmittedCount === 1 ? " was" : "s were"} omitted.` : "";
  const status = addedCount > 0
    ? `Attached ${addedCount} explicitly selected project memory note${addedCount === 1 ? "" : "s"} for review before Send.${omissionStatus}`
    : omissions.length > 0
      ? `No selected project memory was added.${omissionStatus} Nothing was attached.`
      : "Selected project memory was unavailable or unsafe. Nothing was attached.";
  return { items, addedCount, duplicateCount, capacityOmittedCount, selectionOmittedCount, status };
}

type UseProjectLaunchControllerInput = {
  projectId?: string;
  showChatPage: boolean;
  projectPage?: "home" | "chat" | "memory" | "agent";
  routedChatId?: string;
  hostReadyGeneration?: string | null;
  projectHostAuthorityReady: boolean;
  activeChatSummary?: ChatSummary;
  chatId: string | null;
  launchIntentScopeKey: string;
  settingsRef: MutableRefObject<ChatRuntimeSettings>;
  settingsRevisionRef: MutableRefObject<number>;
  chatIdRef: MutableRefObject<string | null>;
  projectScopeController: ProjectScopeController;
  abortActiveStream: (message: string) => unknown;
  setChatInput: (draft: string) => void;
  applyCreatedChat: (created: ChatThread, targetRevision: number) => void;
  navigateToCreatedChat: (chatId: string) => void;
  setExplicitContextBundleItems: Dispatch<SetStateAction<ExplicitContextBundleItem[]>>;
  setIncludeExplicitContextBundle: Dispatch<SetStateAction<boolean>>;
  setExplicitContextBundleStatus: Dispatch<SetStateAction<string | null>>;
};

type ActiveCreate = { token: symbol; intentKey: string; revision: number; correlation: ProjectScopeCorrelation };

export function useProjectLaunchController(input: UseProjectLaunchControllerInput) {
  const [launchIntentCreateState, setLaunchIntentCreateState] = useState<LaunchIntentCreateState>({ state: "idle" });
  const launchIntentCreateRef = useRef<ActiveCreate | null>(null);
  const launchIntentMemoryRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const currentInputRef = useRef(input);
  currentInputRef.current = input;

  const reset = useCallback((clearIntent = false) => {
    launchIntentCreateRef.current = null;
    launchIntentMemoryRef.current = null;
    setLaunchIntentCreateState({ state: "idle" });
    if (clearIntent) clearProjectChatLaunchIntent();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      launchIntentCreateRef.current = null;
      launchIntentMemoryRef.current = null;
      clearProjectChatLaunchIntent();
    };
  }, []);

  useEffect(() => {
    const {
      projectId, showChatPage, routedChatId, hostReadyGeneration, projectHostAuthorityReady,
      activeChatSummary, chatIdRef, settingsRef, settingsRevisionRef, projectScopeController,
      launchIntentScopeKey, abortActiveStream, setChatInput, applyCreatedChat,
      navigateToCreatedChat, setExplicitContextBundleItems, setIncludeExplicitContextBundle,
      setExplicitContextBundleStatus,
    } = input;
    if (!projectId || !showChatPage) {
      reset(true);
      return;
    }
    const lifecycleGeneration = hostReadyGeneration ?? getBrowserProjectChatLifecycleGeneration();
    if (hostReadyGeneration && !projectHostAuthorityReady) return;
    const currentChatId = chatIdRef.current;
    const pending = peekProjectChatLaunchIntent({ projectId, lifecycleGeneration });
    if (pending && pending.chatId === undefined && routedChatId) {
      reset(true);
      return;
    }
    if (routedChatId && !activeChatSummary) return;
    if (pending && pending.chatId === undefined) {
      const intentKey = `${projectId}:${lifecycleGeneration}:${pending.createdAtEpochMs}`;
      if (launchIntentCreateRef.current?.intentKey === intentKey) return;
      if (pending.selectedNoteIds.length === 0) {
        consumeProjectChatLaunchIntent({ projectId, lifecycleGeneration });
        return;
      }
      const token = Symbol("project-chat-launch-intent-create");
      const targetSettings = settingsRef.current;
      const targetRevision = settingsRevisionRef.current;
      const correlation = createProjectScopeCorrelation(projectScopeController.current());
      launchIntentCreateRef.current = { token, intentKey, revision: targetRevision, correlation };
      setLaunchIntentCreateState({ state: "creating", intentKey, scopeKey: launchIntentScopeKey });
      abortActiveStream("SSE stopped and abort requested before starting a new project chat");
      setChatInput("");
      void createChat(targetSettings).then((created) => {
        const activeCreate = launchIntentCreateRef.current;
        const current = currentInputRef.current;
        const currentScopeKey = `${current.projectId ?? "legacy"}:${current.showChatPage ? "chat" : current.projectPage ?? "root"}:${current.routedChatId ?? "draft"}:${current.hostReadyGeneration ?? "browser"}:${current.settingsRevisionRef.current}`;
        if (!mountedRef.current || activeCreate?.token !== token || launchIntentScopeKey !== currentScopeKey) return;
        launchIntentCreateRef.current = null;
        if (!created.ok || !created.data.chatId?.trim() || settingsRevisionRef.current !== targetRevision || !projectScopeController.accepts(correlation)) {
          clearProjectChatLaunchIntent();
          setLaunchIntentCreateState({ state: "failed", intentKey, scopeKey: launchIntentScopeKey });
          return;
        }
        if (!bindProjectChatLaunchIntentChatId({ projectId, lifecycleGeneration }, created.data.chatId)) {
          setLaunchIntentCreateState({ state: "failed", intentKey, scopeKey: launchIntentScopeKey });
          return;
        }
        applyCreatedChat(created.data, targetRevision);
        setLaunchIntentCreateState({ state: "idle" });
        navigateToCreatedChat(created.data.chatId);
      });
      return;
    }
    if (!currentChatId) return;
    const intent = peekProjectChatLaunchIntent({ projectId, chatId: currentChatId, lifecycleGeneration });
    if (!intent) return;
    if (intent.selectedNoteIds.length === 0) {
      consumeProjectChatLaunchIntent({ projectId, chatId: currentChatId, lifecycleGeneration });
      return;
    }
    const targetRevision = settingsRevisionRef.current;
    const correlation = createProjectScopeCorrelation(projectScopeController.current());
    const intentKey = `${projectId}:${currentChatId}:${intent.createdAtEpochMs}`;
    if (launchIntentMemoryRef.current === intentKey) return;
    launchIntentMemoryRef.current = intentKey;
    void listProjectMemory(settingsRef.current).then((result) => {
      if (launchIntentMemoryRef.current === intentKey) launchIntentMemoryRef.current = null;
      if (!mountedRef.current || settingsRevisionRef.current !== targetRevision || chatIdRef.current !== currentChatId || !projectScopeController.accepts(correlation)) return;
      const consumed = consumeProjectChatLaunchIntent({ projectId, chatId: currentChatId, lifecycleGeneration });
      if (!consumed) return;
      if (!result.ok) {
        setExplicitContextBundleStatus("Selected project memory could not be loaded. Nothing was attached.");
        return;
      }
      const selection = selectControlledRunProjectMemory({ selectedNoteIds: consumed.selectedNoteIds, notes: result.data.notes, maxSelectedNotes: 3 });
      const candidates = selection.attachments
        .filter((attachment) => attachment.status === "selected" && attachment.selectedBody !== undefined)
        .map((attachment) => projectMemoryToBundleItem({
          kind: "project_memory",
          noteId: attachment.noteId,
          title: attachment.titleLabel,
          text: attachment.selectedBody!,
          tags: attachment.tagLabels,
          taskLabel: attachment.taskLabel,
          sessionLabel: attachment.sessionLabel,
          attachTraceLabel: `project-chat-launch:${consumed.source}`,
        }));
      setExplicitContextBundleItems((current) => {
        const merged = mergeLaunchMemoryBundleItems(current, candidates, selection.selectedCount);
        if (merged.addedCount > 0) setIncludeExplicitContextBundle(true);
        setExplicitContextBundleStatus(merged.status);
        return merged.items;
      });
    });
  }, [
    input.abortActiveStream,
    input.activeChatSummary,
    input.applyCreatedChat,
    input.chatId,
    input.chatIdRef,
    input.hostReadyGeneration,
    input.launchIntentScopeKey,
    input.navigateToCreatedChat,
    input.projectHostAuthorityReady,
    input.projectId,
    input.projectPage,
    input.projectScopeController,
    input.routedChatId,
    input.setChatInput,
    input.setExplicitContextBundleItems,
    input.setExplicitContextBundleStatus,
    input.setIncludeExplicitContextBundle,
    input.settingsRef,
    input.settingsRevisionRef,
    input.showChatPage,
    reset,
  ]);

  return { launchIntentCreateState, resetProjectLaunchController: reset };
}

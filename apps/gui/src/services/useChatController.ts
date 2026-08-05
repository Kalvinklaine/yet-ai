import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type MutableRefObject } from "react";
import type { CodingSessionTraceDraft } from "./codingSessionTrace";
import { chatRecoveryCodeForRuntimeError, type ChatLifecycleState } from "./chatLifecycle";
import { resolveChatAfterList, resolveFallbackChatAfterDelete } from "./conversationHistory";
import { createProjectScopeCorrelation, type ProjectScopeController, type ProjectScopeCorrelation } from "./projectScope";
import { sanitizeDisplayText, sanitizeDisplayValue, sanitizeTimelineText } from "./redaction";
import { createChat, deleteChat, getChat, listChats, sendAbort, sendContinueResponse, sendUserMessage, type ChatContext, type ChatRuntimeSettings, type ChatSummary, type ProjectContextPlanningSelection, type RuntimeError, type RuntimeSettings } from "./runtimeClient";
import { subscribeToChat, type SseEvent } from "./sseClient";
import { addAcceptedUserMessage, applyChatViewEvent, createInitialChatViewState, hydrateChatViewFromThread, removeOptimisticUserMessage, resetChatViewState, stopStreamingAssistant } from "./chatViewState";

export type ChatResetReason = "create" | "select" | "delete" | "direct_id" | "refresh" | "project" | "settings";

export type ChatControllerResetters = {
  resetConversation: (reason: ChatResetReason, chatId: string | null) => void;
  clearAcceptedContext: () => void;
};

export type ChatSendOptions = {
  canSend: boolean;
  context?: ChatContext | ((chatId: string, revision: number) => ChatContext | undefined);
  planningSelection?: ProjectContextPlanningSelection | ((chatId: string, revision: number) => ProjectContextPlanningSelection | undefined);
  onCreated?: (chatId: string) => void;
  onAccepted?: (input: { chatId: string; content: string; optimisticUserMessageId: string; requestId: string; revision: number }) => void;
  onRejected?: () => void;
};

type ActiveStream = {
  controller: AbortController;
  settings: ChatRuntimeSettings;
  revision: number;
  chatId: string;
  scopeCorrelation: ProjectScopeCorrelation;
  unregisterScopeCancellation: () => void;
};

type PendingChatRequest = {
  controller: AbortController;
  settings: ChatRuntimeSettings;
  chatId: string | null;
  unregisterScopeCancellation: () => void;
};

type AbortActiveStreamOptions = {
  finalizeStreaming?: boolean;
  addTimelineEntry?: boolean;
  reportAbortErrors?: boolean;
};

type ChatControllerInput = {
  initialChatId: string | null;
  projectId?: string;
  routedChatId?: string;
  hostReadyGeneration?: string | null;
  navigateToChat?: (chatId: string | null) => void;
  settingsRef: MutableRefObject<ChatRuntimeSettings>;
  settingsRevisionRef: MutableRefObject<number>;
  projectScopeController: ProjectScopeController;
  addTimelineRef: MutableRefObject<(entry: string) => void>;
  appendTraceRef: MutableRefObject<(draft: CodingSessionTraceDraft) => void>;
  resettersRef: MutableRefObject<ChatControllerResetters>;
  onMissingRoutedChat?: (chatId: string) => void;
};

export type ChatResultLineage = {
  mounted: boolean;
  expectedRevision: number;
  currentRevision: number;
  expectedAttempt?: number;
  currentAttempt?: number;
  expectedChatId?: string | null;
  currentChatId?: string | null;
  scopeAccepted: boolean;
};

export function acceptsChatResult(lineage: ChatResultLineage): boolean {
  return lineage.mounted
    && lineage.expectedRevision === lineage.currentRevision
    && (lineage.expectedAttempt === undefined || lineage.expectedAttempt === lineage.currentAttempt)
    && (lineage.expectedChatId === undefined || lineage.expectedChatId === lineage.currentChatId)
    && lineage.scopeAccepted;
}

export function useChatController({ initialChatId, projectId, routedChatId, hostReadyGeneration, navigateToChat, settingsRef, settingsRevisionRef, projectScopeController, addTimelineRef, appendTraceRef, resettersRef, onMissingRoutedChat }: ChatControllerInput) {
  const [chatError, setChatError] = useState<RuntimeError | null>(null);
  const [chatId, setChatIdState] = useState<string | null>(initialChatId);
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([]);
  const [chatHistoryError, setChatHistoryError] = useState<RuntimeError | null>(null);
  const [chatHistoryRevision, setChatHistoryRevision] = useState<number | null>(null);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [missingRoutedChatId, setMissingRoutedChatId] = useState<string | null>(null);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [conversationNotice, setConversationNotice] = useState<string | null>(null);
  const [compactConversationsOpen, setCompactConversationsOpen] = useState(false);
  const [chatInput, setChatInputState] = useState("");
  const [chatView, setChatView] = useState(() => createInitialChatViewState(initialChatId ?? ""));
  const [chatLifecycleState, setChatLifecycleState] = useState<ChatLifecycleState>("idle");
  const [chatProgressHeartbeat, setChatProgressHeartbeat] = useState(0);
  const chatIdRef = useRef<string | null>(initialChatId);
  const chatHistoryAttemptRef = useRef(0);
  const firstProjectChatCreateRef = useRef<{ token: symbol; revision: number; correlation: ProjectScopeCorrelation; request: PendingChatRequest } | null>(null);
  const pendingChatRequestRef = useRef<PendingChatRequest | null>(null);
  const activeStreamRef = useRef<ActiveStream | null>(null);
  const optimisticUserMessageCounterRef = useRef(0);
  const chatInputUserLineageRef = useRef(0);
  const mountedRef = useRef(true);
  chatIdRef.current = chatId;

  const markChatProgress = useCallback(() => {
    setChatProgressHeartbeat((current) => current + 1);
  }, []);

  const setChatId = useCallback((next: string | null) => {
    chatIdRef.current = next;
    setChatIdState(next);
  }, []);
  const setChatInput = useCallback((draft: string | ((current: string) => string)) => {
    chatInputUserLineageRef.current += 1;
    setChatInputState(draft);
  }, []);
  const appendChatError = useCallback((message: string, code?: string) => {
    setChatView((current) => applyChatViewEvent(current, { seq: 0, type: "error", chatId: current.chatId, payload: { message, code } }));
  }, []);

  const abortActiveStream = useCallback((timelineMessage: string, options: AbortActiveStreamOptions = {}) => {
    const { finalizeStreaming = true, addTimelineEntry = true, reportAbortErrors = true } = options;
    const activeStream = activeStreamRef.current;
    if (!activeStream) return null;
    activeStream.unregisterScopeCancellation();
    activeStream.controller.abort();
    activeStreamRef.current = null;
    if (finalizeStreaming) setChatView((current) => stopStreamingAssistant(current));
    setChatLifecycleState("stopped");
    void sendAbort(activeStream.settings, activeStream.chatId).then((result) => {
      if (reportAbortErrors && !result.ok) addTimelineRef.current(`Abort command error: ${sanitizeDisplayText(result.error.message)}`);
    });
    if (addTimelineEntry) addTimelineRef.current(timelineMessage);
    return activeStream;
  }, [addTimelineRef]);

  const abortPendingChatRequest = useCallback(() => {
    const pending = pendingChatRequestRef.current;
    if (!pending) return false;
    pending.unregisterScopeCancellation();
    pending.controller.abort();
    pendingChatRequestRef.current = null;
    firstProjectChatCreateRef.current = null;
    setChatHistoryLoading(false);
    setChatLifecycleState("stopped");
    addTimelineRef.current("Pending chat request stopped");
    return true;
  }, [addTimelineRef]);

  const startSse = useCallback((targetChatId = chatIdRef.current) => {
    if (!targetChatId || activeStreamRef.current) return;
    const controller = new AbortController();
    const stream: ActiveStream = {
      controller,
      settings: settingsRef.current,
      revision: settingsRevisionRef.current,
      chatId: targetChatId,
      scopeCorrelation: createProjectScopeCorrelation(projectScopeController.current()),
      unregisterScopeCancellation: projectScopeController.registerCancellation(() => controller.abort()),
    };
    activeStreamRef.current = stream;
    setChatLifecycleState("sse_connecting");
    addTimelineRef.current(`Opening SSE for ${targetChatId}`);
    appendTraceRef.current({ family: "chat.streamStarted", title: "Opening chat stream", status: "pending", summary: `Opening SSE for ${targetChatId}.`, details: { chatId: targetChatId } });
    void subscribeToChat(stream.settings, targetChatId, {
      onConnected: () => {
        if (activeStreamRef.current === stream && stream.revision === settingsRevisionRef.current && chatIdRef.current === stream.chatId && projectScopeController.accepts(stream.scopeCorrelation)) markChatProgress();
      },
      onEvent: (event) => {
        if (activeStreamRef.current !== stream || stream.revision !== settingsRevisionRef.current || chatIdRef.current !== stream.chatId || !projectScopeController.accepts(stream.scopeCorrelation) || event.chatId !== stream.chatId) return;
        const safeEvent: SseEvent = { ...event, payload: sanitizeDisplayValue(event.payload) as Record<string, unknown> | undefined };
        markChatProgress();
        setChatView((current) => applyChatViewEvent(current, safeEvent));
        if (event.type === "stream_started" || event.type === "stream_delta") setChatLifecycleState("streaming");
        else if (event.type === "stream_finished") setChatLifecycleState("idle");
        else if (event.type === "error") setChatLifecycleState("failed");
        appendStreamTrace(appendTraceRef.current, event, safeEvent);
        addTimelineRef.current(sanitizeTimelineText(`${event.seq} ${event.type}\n${JSON.stringify(safeEvent.payload ?? {}, null, 2)}`));
      },
      onError: (error) => {
        if (activeStreamRef.current !== stream || stream.revision !== settingsRevisionRef.current || chatIdRef.current !== stream.chatId || !projectScopeController.accepts(stream.scopeCorrelation)) return;
        markChatProgress();
        setChatError(error);
        setChatLifecycleState("failed");
        appendChatError(error.message, chatRecoveryCodeForRuntimeError(error, "sse"));
        addTimelineRef.current(`SSE error: ${sanitizeDisplayText(error.message)}`);
        appendTraceRef.current({ family: "chat.streamError", title: "Chat stream error", status: "failed", summary: error.message, details: { status: error.status } });
      },
    }, controller.signal).finally(() => {
      stream.unregisterScopeCancellation();
      if (activeStreamRef.current === stream) activeStreamRef.current = null;
    });
  }, [addTimelineRef, appendChatError, appendTraceRef, markChatProgress, projectScopeController, settingsRef, settingsRevisionRef]);

  const refreshChats = useCallback(async (targetSettings: ChatRuntimeSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    const attempt = ++chatHistoryAttemptRef.current;
    const scopeCorrelation = createProjectScopeCorrelation(projectScopeController.current());
    setChatHistoryLoading(true); setChatHistoryError(null);
    const result = await listChats(targetSettings);
    if (!mountedRef.current || settingsRevisionRef.current !== revision || chatHistoryAttemptRef.current !== attempt || !projectScopeController.accepts(scopeCorrelation)) return;
    if (result.ok) {
      const summaries = result.data.chats ?? [];
      setChatSummaries(summaries); setChatHistoryRevision(revision);
      const routedPresent = routedChatId === undefined || summaries.some((summary) => summary.chatId === routedChatId);
      setMissingRoutedChatId(routedPresent ? null : routedChatId ?? null);
      if (!routedPresent && routedChatId) onMissingRoutedChat?.(routedChatId);
      const resolution = routedChatId ? { nextChatId: routedChatId, shouldResetView: chatIdRef.current !== routedChatId, reason: "current_present" as const } : resolveChatAfterList({ currentChatId: chatIdRef.current, summaries, defaultChatId: projectId ? null : "chat-001" });
      if (!routedPresent) setConversationNotice(`Chat ${sanitizeDisplayText(routedChatId ?? "")} was not found in this project. The routed chat id remains selected.`);
      else if (resolution.reason === "first_summary") setConversationNotice(`Selected ${sanitizeDisplayText(summaries[0]?.title || resolution.nextChatId || "")} because the previous chat is not in this local runtime list.`);
      else if (resolution.reason === "default_chat" || resolution.reason === "draft") setConversationNotice("No saved conversations are available; showing a fresh local chat.");
      else setConversationNotice(null);
      if (resolution.shouldResetView) {
        resettersRef.current.resetConversation("refresh", resolution.nextChatId);
        setChatInput(""); setChatView(resetChatViewState(resolution.nextChatId ?? "")); setChatId(resolution.nextChatId);
      }
    } else {
      setChatSummaries([]); setChatHistoryError(result.error); setChatHistoryRevision(revision);
    }
    setChatHistoryLoading(false);
  }, [onMissingRoutedChat, projectId, resettersRef, routedChatId, setChatId, setChatInput, settingsRef, settingsRevisionRef]);

  const loadChatThread = useCallback(async (targetChatId: string, targetSettings: ChatRuntimeSettings = settingsRef.current, revision = settingsRevisionRef.current) => {
    const attempt = ++chatHistoryAttemptRef.current;
    const scopeCorrelation = createProjectScopeCorrelation(projectScopeController.current());
    setChatHistoryLoading(true); setChatHistoryError(null);
    const result = await getChat(targetSettings, targetChatId);
    if (!mountedRef.current || settingsRevisionRef.current !== revision || chatHistoryAttemptRef.current !== attempt || chatIdRef.current !== targetChatId || !projectScopeController.accepts(scopeCorrelation)) return;
    if (result.ok) {
      setMissingRoutedChatId((current) => current === targetChatId ? null : current);
      setChatView((current) => hydrateChatViewFromThread(current, result.data));
      setChatSummaries((current) => upsertChatSummary(current, result.data)); setChatHistoryRevision(revision);
    } else {
      if (routedChatId === targetChatId && result.error.status === 404) { setMissingRoutedChatId(targetChatId); onMissingRoutedChat?.(targetChatId); }
      setChatHistoryError(result.error); setChatHistoryRevision(revision);
    }
    setChatHistoryLoading(false);
  }, [onMissingRoutedChat, routedChatId, settingsRef, settingsRevisionRef]);

  const createNewChat = useCallback(async () => {
    const targetSettings = settingsRef.current; const revision = settingsRevisionRef.current; const attempt = ++chatHistoryAttemptRef.current; const scopeCorrelation = createProjectScopeCorrelation(projectScopeController.current());
    abortActiveStream("SSE stopped and abort requested before creating a new chat");
    setChatHistoryLoading(true); setChatHistoryError(null); setChatError(null); setChatInput("");
    const result = await createChat(targetSettings);
    if (!mountedRef.current || settingsRevisionRef.current !== revision || chatHistoryAttemptRef.current !== attempt || !projectScopeController.accepts(scopeCorrelation)) return;
    if (result.ok && result.data.chatId.trim()) {
      setChatSummaries((current) => upsertChatSummary(current, result.data)); setChatHistoryRevision(revision); setCompactConversationsOpen(false);
      setChatId(result.data.chatId); setMissingRoutedChatId(null); navigateToChat?.(result.data.chatId); setConversationNotice(`Created and selected ${sanitizeDisplayText(result.data.title || result.data.chatId)}.`);
      setChatView(hydrateChatViewFromThread(resetChatViewState(result.data.chatId), result.data)); resettersRef.current.resetConversation("create", result.data.chatId);
    } else if (!result.ok) { setChatHistoryError(result.error); setChatHistoryRevision(revision); }
    setChatHistoryLoading(false);
  }, [abortActiveStream, navigateToChat, resettersRef, setChatId, setChatInput, settingsRef, settingsRevisionRef]);

  const selectChat = useCallback((nextChatId: string) => {
    setCompactConversationsOpen(false); if (nextChatId === chatIdRef.current) return;
    abortActiveStream("SSE stopped and abort requested before switching chats"); setChatInput(""); resettersRef.current.resetConversation("select", nextChatId);
    setChatId(nextChatId); setMissingRoutedChatId(null); navigateToChat?.(nextChatId);
    const summary = chatSummaries.find((item) => item.chatId === nextChatId); setConversationNotice(`Switched to ${sanitizeDisplayText(summary?.title || nextChatId)}.`);
    setChatView(resetChatViewState(nextChatId)); void loadChatThread(nextChatId);
  }, [abortActiveStream, chatSummaries, loadChatThread, navigateToChat, resettersRef, setChatId, setChatInput]);

  const updateDirectChatId = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (next !== chatIdRef.current) { abortActiveStream("SSE stopped and abort requested before changing chat id"); setChatInput(""); resettersRef.current.resetConversation("direct_id", next); setChatView(resetChatViewState(next)); }
    setChatId(next);
  }, [abortActiveStream, resettersRef, setChatId, setChatInput]);

  const deleteCurrentChat = useCallback(async (targetChatId: string) => {
    const targetTitle = sanitizeDisplayText(chatSummaries.find((item) => item.chatId === targetChatId)?.title || targetChatId);
    const deletingCurrent = chatIdRef.current === targetChatId; setCompactConversationsOpen(false);
    if (!window.confirm(deletingCurrent ? `Delete the current conversation "${targetTitle}"? This removes it from engine-owned local history and selects the next available local chat.` : `Delete conversation "${targetTitle}" from engine-owned local history?`)) { setConversationNotice(`Kept ${targetTitle}; delete was cancelled.`); return; }
    setConversationNotice(`Deleting ${targetTitle}…`);
    const settings = settingsRef.current; const revision = settingsRevisionRef.current; const attempt = ++chatHistoryAttemptRef.current;
    if (deletingCurrent) { abortActiveStream("SSE stopped and abort requested before deleting the current chat"); setChatView(resetChatViewState(targetChatId)); setChatInput(""); resettersRef.current.resetConversation("delete", targetChatId); }
    setDeletingChatId(targetChatId); setChatHistoryLoading(true); setChatHistoryError(null);
    const result = await deleteChat(settings, targetChatId);
    if (!mountedRef.current || settingsRevisionRef.current !== revision || chatHistoryAttemptRef.current !== attempt) { setDeletingChatId((current) => current === targetChatId ? null : current); return; }
    if (result.ok) {
      const fallback = resolveFallbackChatAfterDelete({ summariesBeforeDelete: chatSummaries, deletedChatId: targetChatId, activeChatId: chatIdRef.current, defaultChatId: projectId ? null : "chat-001" });
      setChatSummaries(fallback.remainingSummaries); setChatHistoryRevision(revision);
      if (fallback.deletedCurrent) {
        const summary = fallback.remainingSummaries.find((item) => item.chatId === fallback.nextChatId);
        setConversationNotice(summary ? `Deleted ${targetTitle}. Selected ${sanitizeDisplayText(summary.title || fallback.nextChatId || "")}.` : `Deleted ${targetTitle}. No saved conversations remain; showing a fresh local chat.`);
        setChatId(fallback.nextChatId); navigateToChat?.(fallback.nextChatId); setChatView(resetChatViewState(fallback.nextChatId ?? "")); setChatInput(""); resettersRef.current.resetConversation("delete", fallback.nextChatId);
      } else setConversationNotice(`Deleted ${targetTitle}.`);
    } else { setChatHistoryError(result.error); setConversationNotice(`Could not delete ${targetTitle}: ${sanitizeDisplayText(result.error.message)}`); setChatHistoryRevision(revision); }
    setDeletingChatId(null); setChatHistoryLoading(false);
  }, [abortActiveStream, chatSummaries, navigateToChat, projectId, resettersRef, setChatId, setChatInput, settingsRef, settingsRevisionRef]);

  const submitChat = useCallback(async (event: FormEvent<HTMLFormElement>, options: ChatSendOptions) => {
    event.preventDefault();
    const submittedInput = chatInput; const lineage = chatInputUserLineageRef.current; const content = submittedInput.trim();
    if (!content || firstProjectChatCreateRef.current) return;
    const settings = settingsRef.current; const revision = settingsRevisionRef.current; let targetChatId = chatIdRef.current; setChatError(null);
    if (!options.canSend) {
      const error: RuntimeError = { status: "configuration", message: "Chat is not ready for the current runtime settings. Refresh runtime and configure a provider/model before sending." };
      setChatError(error); setChatLifecycleState("failed"); appendChatError(error.message, chatRecoveryCodeForRuntimeError(error, "command")); addTimelineRef.current("Command blocked until current runtime settings are ready"); return;
    }
    let createToken: symbol | null = null;
    if (!targetChatId && projectId) {
      const token = Symbol("first-project-chat"); const correlation = createProjectScopeCorrelation(projectScopeController.current()); createToken = token;
      const controller = new AbortController();
      const request = { controller, settings, chatId: null, unregisterScopeCancellation: projectScopeController.registerCancellation(() => controller.abort()) };
      pendingChatRequestRef.current = request;
      firstProjectChatCreateRef.current = { token, revision, correlation, request }; setChatLifecycleState("chat_creating"); setChatHistoryLoading(true); setChatHistoryError(null);
      const created = await createChat(settings, controller.signal); const pending = firstProjectChatCreateRef.current;
      request.unregisterScopeCancellation();
      if (pendingChatRequestRef.current === request) pendingChatRequestRef.current = null;
      if (!mountedRef.current || pending?.token !== token || pending.revision !== settingsRevisionRef.current || settingsRevisionRef.current !== revision || !projectScopeController.accepts(correlation) || chatIdRef.current !== null) { if (pending?.token === token) firstProjectChatCreateRef.current = null; return; }
      setChatHistoryLoading(false);
      if (!created.ok || !created.data.chatId?.trim()) {
        firstProjectChatCreateRef.current = null; const error = created.ok ? { status: "protocol", message: "The local runtime created a chat without a usable chat id." } satisfies RuntimeError : created.error;
        setChatHistoryError(error); setChatHistoryRevision(revision); setChatError(error); setChatLifecycleState("failed"); addTimelineRef.current(`Chat create error: ${sanitizeDisplayText(error.message)}`); return;
      }
      targetChatId = created.data.chatId; setChatId(targetChatId); setChatSummaries((current) => upsertChatSummary(current, created.data)); setChatHistoryRevision(revision);
      setChatView(hydrateChatViewFromThread(resetChatViewState(targetChatId), created.data)); setConversationNotice(`Created and selected ${sanitizeDisplayText(created.data.title || targetChatId)}.`); navigateToChat?.(targetChatId); options.onCreated?.(targetChatId);
    }
    if (!targetChatId) return;
    const context = typeof options.context === "function" ? options.context(targetChatId, revision) : options.context;
    const planningSelection = typeof options.planningSelection === "function" ? options.planningSelection(targetChatId, revision) : options.planningSelection;
    setChatLifecycleState("command_submitting"); const optimisticId = `${targetChatId}-optimistic-user-${++optimisticUserMessageCounterRef.current}`;
    const commandController = new AbortController();
    const commandRequest = { controller: commandController, settings, chatId: targetChatId, unregisterScopeCancellation: projectScopeController.registerCancellation(() => commandController.abort()) };
    pendingChatRequestRef.current = commandRequest;
    appendTraceRef.current({ family: "chat.sendAccepted", title: "Send requested", status: "pending", summary: "User message submitted from the GUI.", details: { chatId: targetChatId, hasContext: Boolean(context), contextKind: context?.kind } });
    setChatView((current) => addAcceptedUserMessage(current, content, optimisticId));
    const result = await sendUserMessage(settings, targetChatId, content, context, planningSelection, commandController.signal);
    commandRequest.unregisterScopeCancellation();
    if (pendingChatRequestRef.current === commandRequest) pendingChatRequestRef.current = null;
    if (commandController.signal.aborted) {
      if (firstProjectChatCreateRef.current?.token === createToken) firstProjectChatCreateRef.current = null;
      setChatView((current) => removeOptimisticUserMessage(current, optimisticId));
      if (chatInputUserLineageRef.current === lineage) setChatInputState(submittedInput);
      return;
    }
    if (!mountedRef.current || settingsRevisionRef.current !== revision || chatIdRef.current !== targetChatId) {
      if (firstProjectChatCreateRef.current?.token === createToken) firstProjectChatCreateRef.current = null;
      setChatView((current) => removeOptimisticUserMessage(current, optimisticId));
      return;
    }
    if (result.ok) {
      if (firstProjectChatCreateRef.current?.token === createToken) firstProjectChatCreateRef.current = null;
      if (chatInputUserLineageRef.current === lineage) setChatInputState("");
      markChatProgress();
      addTimelineRef.current(`Command accepted ${result.data.requestId}`); appendTraceRef.current({ family: "chat.sendAccepted", title: "Send accepted", status: "succeeded", summary: "Runtime accepted user message command.", requestId: result.data.requestId, details: { chatId: targetChatId, hasContext: Boolean(context), contextKind: context?.kind } });
      options.onAccepted?.({ chatId: targetChatId, content, optimisticUserMessageId: optimisticId, requestId: result.data.requestId, revision }); resettersRef.current.clearAcceptedContext(); startSse(targetChatId);
      setChatLifecycleState((current) => current === "command_submitting" || current === "sse_connecting" ? "command_accepted" : current);
    } else {
      if (firstProjectChatCreateRef.current?.token === createToken) firstProjectChatCreateRef.current = null;
      setChatError(result.error); setChatLifecycleState("failed"); if (chatInputUserLineageRef.current === lineage) setChatInputState(submittedInput);
      setChatView((current) => removeOptimisticUserMessage(current, optimisticId)); appendChatError(result.error.message, chatRecoveryCodeForRuntimeError(result.error, "command"));
      addTimelineRef.current(`Command error: ${sanitizeDisplayText(result.error.message)}`); appendTraceRef.current({ family: "chat.sendRejected", title: "Send rejected", status: "failed", summary: result.error.message, details: { chatId: targetChatId, status: result.error.status } }); options.onRejected?.();
    }
  }, [addTimelineRef, appendChatError, appendTraceRef, chatInput, markChatProgress, navigateToChat, projectId, projectScopeController, resettersRef, setChatId, settingsRef, settingsRevisionRef, startSse]);

  const continueResponse = useCallback(async (messageId: string) => {
    const targetChatId = chatIdRef.current;
    const message = chatView.messages.find((item) => item.id === messageId);
    if (!projectId || !targetChatId || !message?.continuation || message.status !== "interrupted" || activeStreamRef.current) return;
    setChatError(null);
    setChatLifecycleState("command_submitting");
    const result = await sendContinueResponse(settingsRef.current, targetChatId, {
      interruptedTurnId: message.continuation.turnId,
      expectedProjectRevision: message.continuation.projectRevision,
      expectedManifestId: message.continuation.manifestId,
    });
    if (chatIdRef.current !== targetChatId) return;
    if (result.ok) {
      markChatProgress();
      addTimelineRef.current(`Continue accepted ${result.data.requestId}`);
      startSse(targetChatId);
      setChatLifecycleState("command_accepted");
    } else {
      setChatError(result.error);
      setChatLifecycleState("failed");
      appendChatError(result.error.message, chatRecoveryCodeForRuntimeError(result.error, "command"));
    }
  }, [addTimelineRef, appendChatError, chatView.messages, markChatProgress, projectId, settingsRef, startSse]);

  const resetForScope = useCallback((nextChatId: string | null) => {
    abortPendingChatRequest();
    abortActiveStream("SSE stopped for previous project", { finalizeStreaming: false, addTimelineEntry: false, reportAbortErrors: false });
    firstProjectChatCreateRef.current = null; chatHistoryAttemptRef.current += 1; setChatId(nextChatId); setChatView(resetChatViewState(nextChatId ?? "")); setChatSummaries([]); setChatHistoryRevision(null); setChatHistoryError(null); setChatHistoryLoading(false); setMissingRoutedChatId(null); setDeletingChatId(null); setConversationNotice(null); setChatInputState(""); setChatLifecycleState("idle");
  }, [abortActiveStream, abortPendingChatRequest, setChatId]);
  const invalidate = useCallback(() => {
    abortPendingChatRequest();
    abortActiveStream("SSE stopped and abort requested for previous runtime settings"); firstProjectChatCreateRef.current = null; chatHistoryAttemptRef.current += 1;
    setChatLifecycleState("idle"); setChatHistoryRevision(null); setChatSummaries([]); setChatHistoryError(null); setChatHistoryLoading(false); setDeletingChatId(null);
  }, [abortActiveStream, abortPendingChatRequest]);

  useEffect(() => { if (routedChatId && routedChatId !== chatIdRef.current) { setMissingRoutedChatId(null); selectChat(routedChatId); } }, [routedChatId, selectChat]);
  const activeSummaryChatId = chatSummaries.find((summary) => summary.chatId === chatId)?.chatId;
  useEffect(() => {
    if (chatId && activeSummaryChatId && missingRoutedChatId !== chatId) void loadChatThread(chatId);
  }, [activeSummaryChatId, chatId, loadChatThread, missingRoutedChatId]);
  useEffect(() => () => { abortPendingChatRequest(); abortActiveStream("SSE stopped and abort requested on cleanup", { finalizeStreaming: false, addTimelineEntry: false, reportAbortErrors: false }); }, [abortActiveStream, abortPendingChatRequest]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; firstProjectChatCreateRef.current = null; chatHistoryAttemptRef.current += 1; }; }, []);

  return useMemo(() => ({
    chatError, setChatError, chatId, setChatId, chatIdRef, chatSummaries, setChatSummaries, chatHistoryError, setChatHistoryError, chatHistoryRevision, setChatHistoryRevision,
    chatHistoryLoading, setChatHistoryLoading, missingRoutedChatId, setMissingRoutedChatId, deletingChatId, setDeletingChatId, conversationNotice, setConversationNotice,
    compactConversationsOpen, setCompactConversationsOpen, chatInput, setChatInput, chatView, setChatView, chatLifecycleState, setChatLifecycleState,
    chatHistoryAttemptRef, firstProjectChatCreateRef, activeStreamRef, chatProgressHeartbeat, refreshChats, loadChatThread, createNewChat, selectChat, updateDirectChatId, deleteCurrentChat,
    submitChat, continueResponse, startSse, stopSse: () => { if (!abortPendingChatRequest() && !abortActiveStream("SSE stopped and abort requested")) addTimelineRef.current("SSE stopped"); }, abortActiveStream, appendChatError, resetForScope, invalidate,
  }), [abortActiveStream, abortPendingChatRequest, addTimelineRef, appendChatError, chatError, chatHistoryError, chatHistoryLoading, chatHistoryRevision, chatId, chatInput, chatLifecycleState, chatProgressHeartbeat, chatSummaries, chatView, compactConversationsOpen, continueResponse, conversationNotice, createNewChat, deleteCurrentChat, deletingChatId, invalidate, loadChatThread, missingRoutedChatId, refreshChats, resetForScope, selectChat, setChatId, setChatInput, startSse, submitChat, updateDirectChatId]);
}

function appendStreamTrace(appendTrace: (draft: CodingSessionTraceDraft) => void, event: SseEvent, safeEvent: SseEvent) {
  if (event.type === "stream_started") appendTrace({ family: "chat.streamStarted", title: "Chat stream started", status: "in_progress", summary: `Stream event ${event.seq} started.`, details: { seq: event.seq, chatId: event.chatId } });
  else if (event.type === "stream_delta") appendTrace({ family: "chat.streamDelta", title: "Chat stream delta", status: "in_progress", summary: `Stream event ${event.seq} delivered sanitized delta.`, details: { seq: event.seq, chatId: event.chatId } });
  else if (event.type === "stream_finished") appendTrace({ family: "chat.streamFinished", title: "Chat stream finished", status: "succeeded", summary: `Stream event ${event.seq} finished.`, details: { seq: event.seq, chatId: event.chatId, payload: safeEvent.payload } });
  else if (event.type === "error") appendTrace({ family: "chat.streamError", title: "Chat stream error", status: "failed", summary: "SSE error event received.", details: { seq: event.seq, chatId: event.chatId, payload: safeEvent.payload } });
}

function upsertChatSummary(summaries: ChatSummary[], thread: { chatId: string; title: string; createdAt: string; updatedAt: string; messages: unknown[] }): ChatSummary[] {
  const summary: ChatSummary = { chatId: thread.chatId, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt, messageCount: thread.messages.length };
  return [summary, ...summaries.filter((item) => item.chatId !== thread.chatId)];
}

import { projectCommandCenterLimits } from "./projectCommandCenterData";
import { parseProjectId, type ProjectId } from "./projectRouting";

export const projectChatLaunchIntentVersion = 1 as const;
export const projectChatLaunchIntentDefaultTtlMs = 30_000;
export const projectChatLaunchIntentMaxTtlMs = 60_000;

export type ProjectChatLaunchIntentSource = "project_home" | "current_workspace_dashboard";

export type ProjectChatLaunchIntent = Readonly<{
  version: typeof projectChatLaunchIntentVersion;
  projectId: ProjectId;
  chatId?: string;
  source: ProjectChatLaunchIntentSource;
  selectedNoteIds: readonly string[];
  lifecycleGeneration: string;
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
}>;

export type ProjectChatLaunchIntentInput = {
  projectId: string;
  chatId?: string;
  source: ProjectChatLaunchIntentSource;
  selectedNoteIds: readonly unknown[];
  lifecycleGeneration: string;
};

export type ProjectChatLaunchIntentMatch = {
  projectId: string;
  chatId?: string;
  lifecycleGeneration: string;
};

export type ProjectChatLaunchIntentStore = {
  read: () => unknown;
  write: (intent: ProjectChatLaunchIntent | null) => void;
};

export type ProjectChatLaunchIntentOptions = {
  store?: ProjectChatLaunchIntentStore;
  nowEpochMs?: number;
  ttlMs?: number;
};

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
let moduleIntent: ProjectChatLaunchIntent | null = null;
const browserLifecycleGeneration = createBrowserLifecycleGeneration();

const moduleStore: ProjectChatLaunchIntentStore = {
  read: () => moduleIntent,
  write: (intent) => {
    moduleIntent = intent;
  },
};

export function createProjectChatLaunchIntent(
  input: ProjectChatLaunchIntentInput,
  options: ProjectChatLaunchIntentOptions = {},
): ProjectChatLaunchIntent | null {
  const store = options.store ?? moduleStore;
  const projectId = parseProjectId(input.projectId);
  const chatId = validateOptionalChatId(input.chatId);
  const lifecycleGeneration = validateId(input.lifecycleGeneration);
  const selectedNoteIds = validateSelectedNoteIds(input.selectedNoteIds);
  const nowEpochMs = validateNow(options.nowEpochMs);
  const ttlMs = validateTtl(options.ttlMs);

  if (!projectId || chatId === null || !lifecycleGeneration || !selectedNoteIds || nowEpochMs === null || ttlMs === null || !isSource(input.source)) {
    store.write(null);
    return null;
  }

  const intent = freezeIntent({
    version: projectChatLaunchIntentVersion,
    projectId,
    ...(chatId === undefined ? {} : { chatId }),
    source: input.source,
    selectedNoteIds,
    lifecycleGeneration,
    createdAtEpochMs: nowEpochMs,
    expiresAtEpochMs: nowEpochMs + ttlMs,
  });
  store.write(intent);
  return intent;
}

export function peekProjectChatLaunchIntent(
  match: ProjectChatLaunchIntentMatch,
  options: ProjectChatLaunchIntentOptions = {},
): ProjectChatLaunchIntent | null {
  const store = options.store ?? moduleStore;
  const intent = validateStoredIntent(store.read());
  const nowEpochMs = validateNow(options.nowEpochMs);
  if (!intent || nowEpochMs === null || intent.createdAtEpochMs > nowEpochMs || intent.expiresAtEpochMs <= nowEpochMs) {
    store.write(null);
    return null;
  }
  if (!matchesIntent(intent, match)) return null;
  return intent;
}

export function consumeProjectChatLaunchIntent(
  match: ProjectChatLaunchIntentMatch,
  options: ProjectChatLaunchIntentOptions = {},
): ProjectChatLaunchIntent | null {
  const store = options.store ?? moduleStore;
  const intent = peekProjectChatLaunchIntent(match, { ...options, store });
  store.write(null);
  return intent;
}

export function clearProjectChatLaunchIntent(store: ProjectChatLaunchIntentStore = moduleStore): void {
  store.write(null);
}

export function clearProjectChatLaunchIntentIfMatches(
  match: ProjectChatLaunchIntentMatch,
  options: ProjectChatLaunchIntentOptions = {},
): boolean {
  const store = options.store ?? moduleStore;
  const intent = peekProjectChatLaunchIntent(match, { ...options, store });
  if (!intent) return false;
  store.write(null);
  return true;
}

export function getBrowserProjectChatLifecycleGeneration(): string {
  return browserLifecycleGeneration;
}

export function bindProjectChatLaunchIntentChatId(
  match: Omit<ProjectChatLaunchIntentMatch, "chatId">,
  chatId: string,
  options: ProjectChatLaunchIntentOptions = {},
): ProjectChatLaunchIntent | null {
  const store = options.store ?? moduleStore;
  const intent = peekProjectChatLaunchIntent({ ...match, chatId: undefined }, { ...options, store });
  const safeChatId = validateId(chatId);
  if (!intent || intent.chatId !== undefined || !safeChatId) {
    store.write(null);
    return null;
  }
  const bound = freezeIntent({ ...intent, chatId: safeChatId });
  store.write(bound);
  return bound;
}

export function createProjectChatLaunchIntentStore(): ProjectChatLaunchIntentStore {
  let intent: ProjectChatLaunchIntent | null = null;
  return {
    read: () => intent,
    write: (nextIntent) => {
      intent = nextIntent;
    },
  };
}

function matchesIntent(intent: ProjectChatLaunchIntent, match: ProjectChatLaunchIntentMatch): boolean {
  const projectId = parseProjectId(match.projectId);
  const chatId = validateOptionalChatId(match.chatId);
  const generation = validateId(match.lifecycleGeneration);
  return Boolean(projectId && chatId !== null && generation
    && intent.projectId === projectId
    && intent.chatId === chatId
    && intent.lifecycleGeneration === generation);
}

function validateStoredIntent(value: unknown): ProjectChatLaunchIntent | null {
  if (!isRecord(value) || value.version !== projectChatLaunchIntentVersion || !isSource(value.source)) return null;
  const projectId = typeof value.projectId === "string" ? parseProjectId(value.projectId) : null;
  const chatId = validateOptionalChatId(value.chatId);
  const lifecycleGeneration = validateId(value.lifecycleGeneration);
  const selectedNoteIds = validateSelectedNoteIds(value.selectedNoteIds);
  if (!projectId || chatId === null || !lifecycleGeneration || !selectedNoteIds
    || !Number.isFinite(value.createdAtEpochMs) || !Number.isFinite(value.expiresAtEpochMs)
    || typeof value.createdAtEpochMs !== "number" || typeof value.expiresAtEpochMs !== "number"
    || value.expiresAtEpochMs <= value.createdAtEpochMs
    || value.expiresAtEpochMs - value.createdAtEpochMs > projectChatLaunchIntentMaxTtlMs) return null;
  return freezeIntent({
    version: projectChatLaunchIntentVersion,
    projectId,
    ...(chatId === undefined ? {} : { chatId }),
    source: value.source,
    selectedNoteIds,
    lifecycleGeneration,
    createdAtEpochMs: value.createdAtEpochMs,
    expiresAtEpochMs: value.expiresAtEpochMs,
  });
}

function freezeIntent(intent: Omit<ProjectChatLaunchIntent, "selectedNoteIds"> & { selectedNoteIds: readonly string[] }): ProjectChatLaunchIntent {
  return Object.freeze({ ...intent, selectedNoteIds: Object.freeze([...intent.selectedNoteIds]) });
}

function validateSelectedNoteIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > projectCommandCenterLimits.memorySelections) return null;
  const ids = value.map(validateId);
  if (ids.some((id) => id === null)) return null;
  const safeIds = ids as string[];
  if (new Set(safeIds).size !== safeIds.length) return null;
  return safeIds;
}

function validateOptionalChatId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return validateId(value);
}

function validateId(value: unknown): string | null {
  return typeof value === "string" && safeIdPattern.test(value) ? value : null;
}

function validateNow(value: unknown): number | null {
  const now = value === undefined ? Date.now() : value;
  return typeof now === "number" && Number.isFinite(now) && now >= 0 ? now : null;
}

function validateTtl(value: unknown): number | null {
  const ttl = value === undefined ? projectChatLaunchIntentDefaultTtlMs : value;
  return typeof ttl === "number" && Number.isInteger(ttl) && ttl > 0 && ttl <= projectChatLaunchIntentMaxTtlMs ? ttl : null;
}

function isSource(value: unknown): value is ProjectChatLaunchIntentSource {
  return value === "project_home" || value === "current_workspace_dashboard";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createBrowserLifecycleGeneration(): string {
  const values = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(values);
  return `browser-${Date.now().toString(36)}-${values[0].toString(36)}${values[1].toString(36)}`;
}

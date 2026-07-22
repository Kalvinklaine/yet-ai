const vscodeHostedChatPath = "/vscode/hosted-chat";
const bootstrapParameter = "yetAiHostedBootstrap";
const bootstrapMessageType = "yet-ai.hosted-bootstrap";
const bootstrapRequestType = "yet-ai.hosted-bootstrap.request";
const bootstrapTokenPattern = /^[A-Za-z0-9_-]{32}$/;
const bootstrapTimeoutMs = 3000;

type HostedBootstrapMessage = {
  type: typeof bootstrapMessageType;
  token: string;
  entryMode: "hosted_chat";
};

export async function initializeHostedEntry(target: Window = window): Promise<void> {
  if (target.location.pathname !== vscodeHostedChatPath || target.parent === target) return;
  const token = new URL(target.location.href).searchParams.get(bootstrapParameter);
  if (!token || !bootstrapTokenPattern.test(token)) return;
  const initialConfig = target.__yetAiInitialRuntimeConfig;
  if (initialConfig?.entryMode === "hosted_chat") {
    const { entryMode: _entryMode, ...configWithoutEntryMode } = initialConfig;
    target.__yetAiInitialRuntimeConfig = configWithoutEntryMode;
  }
  const message = await waitForHostedBootstrap(target, token);
  if (!message) return;
  target.__yetAiInitialRuntimeConfig = { ...target.__yetAiInitialRuntimeConfig, entryMode: message.entryMode };
  target.history.replaceState(null, "", vscodeHostedChatPath);
}

function waitForHostedBootstrap(target: Window, token: string): Promise<HostedBootstrapMessage | undefined> {
  return new Promise((resolve) => {
    const timeout = target.setTimeout(() => finish(), bootstrapTimeoutMs);
    const finish = (message?: HostedBootstrapMessage) => {
      target.clearTimeout(timeout);
      target.removeEventListener("message", onMessage);
      resolve(message);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target.parent || !isHostedBootstrapMessage(event.data, token)) return;
      finish(event.data);
    };
    target.addEventListener("message", onMessage);
    target.parent.postMessage({ type: bootstrapRequestType, token }, "*");
  });
}

function isHostedBootstrapMessage(value: unknown, token: string): value is HostedBootstrapMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return Object.keys(message).every((key) => key === "type" || key === "token" || key === "entryMode")
    && message.type === bootstrapMessageType
    && message.token === token
    && message.entryMode === "hosted_chat";
}

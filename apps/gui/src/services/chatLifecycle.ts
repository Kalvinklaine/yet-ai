import type { RuntimeError } from "./runtimeClient";
import { sanitizeDisplayText } from "./redaction";

export type ChatLifecycleState =
  | "idle"
  | "command_submitting"
  | "command_accepted"
  | "sse_connecting"
  | "streaming"
  | "stopped"
  | "failed";

export type ChatRecoveryCode =
  | "runtime_unavailable"
  | "runtime_unauthorized"
  | "provider_or_model_not_ready"
  | "command_http_failure"
  | "command_network_failure"
  | "sse_network_failure"
  | "sse_provider_error"
  | "user_stop"
  | "provider_unauthorized"
  | "provider_rate_limited"
  | "provider_context_too_large"
  | "provider_invalid_request"
  | "provider_timeout"
  | "provider_upstream_error"
  | "provider_malformed_stream"
  | "provider_config_error"
  | "provider_not_configured"
  | "model_not_configured"
  | "provider_request_failed";

export const chatLifecycleLabels: Record<ChatLifecycleState, string> = {
  idle: "Chat is idle. Ready for local input.",
  command_submitting: "Sending message...",
  command_accepted: "Message sent; waiting for response stream.",
  sse_connecting: "Waiting for response stream.",
  streaming: "Assistant is responding...",
  stopped: "Response stopped.",
  failed: "Provider/runtime error. No automatic retry was started.",
};

const chatRecoveryCopy: Record<ChatRecoveryCode, string> = {
  runtime_unavailable: "Recovery: Refresh runtime, verify the local runtime is running, then send again.",
  runtime_unauthorized: "Recovery: fix the local runtime Session token mismatch; this is not a Provider API key problem.",
  provider_or_model_not_ready: "Recovery: configure and test a local BYOK provider/model, refresh runtime, then send again.",
  command_http_failure: "Recovery: Refresh runtime and resend after the local command endpoint is healthy. No automatic retry was started.",
  command_network_failure: "Recovery: Refresh runtime and verify the loopback runtime URL before sending again.",
  sse_network_failure: "Recovery: Refresh runtime and reopen the local stream by sending again. No automatic retry was started.",
  sse_provider_error: "Recovery: fix the provider/runtime issue shown here, then send again. No automatic retry was started.",
  user_stop: "Recovery: stream stopped locally; send a new message when ready.",
  provider_unauthorized: "Recovery: fix the Provider API key or account login in Provider setup; do not replace it with the local Session token.",
  provider_rate_limited: "Recovery: wait before retrying, check provider quota or billing, or try another configured model/provider.",
  provider_context_too_large: "Recovery: reduce the prompt or attached editor context, then send again.",
  provider_invalid_request: "Recovery: check the model id, provider endpoint, and saved provider settings.",
  provider_timeout: "Recovery: retry after checking network connectivity or the local provider server.",
  provider_upstream_error: "Recovery: the provider or local server failed. Check provider/server status, then send again.",
  provider_malformed_stream: "Recovery: the provider returned invalid streaming data. Check the provider/local server, then send again.",
  provider_config_error: "Recovery: review provider setup, saved endpoint, credentials, and model readiness.",
  provider_not_configured: "Recovery: configure and enable a provider with local credentials before chatting.",
  model_not_configured: "Recovery: configure a chat-ready model for an enabled provider before chatting.",
  provider_request_failed: "Recovery: check local provider configuration and readiness, then send again.",
};

export function chatRecoveryCopyForCode(code: string | undefined): string {
  return isChatRecoveryCode(code) ? chatRecoveryCopy[code] : chatRecoveryCopy.sse_provider_error;
}

export function chatRecoveryCopyForRuntimeError(error: RuntimeError, source: "command" | "sse" | "runtime" = "runtime"): string {
  return chatRecoveryCopy[chatRecoveryCodeForRuntimeError(error, source)];
}

export function chatRecoveryCodeForRuntimeError(error: RuntimeError, source: "command" | "sse" | "runtime" = "runtime"): ChatRecoveryCode {
  if (error.status === 401) {
    return "runtime_unauthorized";
  }
  if (error.status === "network") {
    return source === "sse" ? "sse_network_failure" : "command_network_failure";
  }
  if (error.status === "configuration") {
    return "provider_or_model_not_ready";
  }
  if (source === "sse") {
    return "sse_provider_error";
  }
  if (source === "command") {
    return "command_http_failure";
  }
  return "runtime_unavailable";
}

export function formatChatErrorMessage(message: string, recovery: string, limit = 500): string {
  const safeRecovery = sanitizeDisplayText(recovery);
  const messageLimit = Math.max(80, limit - safeRecovery.length - 1);
  const safeMessage = sanitizeDisplayText(message).length > messageLimit ? `${sanitizeDisplayText(message).slice(0, messageLimit)}…` : sanitizeDisplayText(message);
  return `${safeMessage}\n${safeRecovery}`;
}

function isChatRecoveryCode(code: string | undefined): code is ChatRecoveryCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(chatRecoveryCopy, code);
}

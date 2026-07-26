import { useCallback, useEffect, useRef, useState } from "react";
import { createBridgeAdapter, type BridgeAdapter, type HostMessage, type HostReadyPayload, type WorkspaceBindingPayload } from "../bridge/bridgeAdapter";
import { isLoopbackRuntimeUrl, isSameOriginProxyBaseUrl, type RuntimeSettings } from "./runtimeClient";

const defaultSettings: RuntimeSettings = { baseUrl: "http://127.0.0.1:8001", token: "", runtimeAccess: "direct" };

export function readInitialRuntimeSettings(): RuntimeSettings {
  if (typeof window === "undefined") return defaultSettings;
  const configured = window.__yetAiInitialRuntimeConfig;
  const configuredBase = configured?.runtimeProxyBaseUrl ?? configured?.runtimeBaseUrl;
  if (configured?.runtimeAccess === "same_origin_proxy" && configuredBase && isSameOriginProxyBaseUrl(configuredBase)) {
    return { baseUrl: configuredBase, token: "", runtimeAccess: "same_origin_proxy" };
  }
  return defaultSettings;
}

export function resolveHostReadyRuntimeSettings(current: RuntimeSettings, payload: HostReadyPayload | undefined): RuntimeSettings | null {
  if (!payload) return null;
  if (payload.runtimeProxyBaseUrl !== undefined) {
    if (!isSameOriginProxyBaseUrl(payload.runtimeProxyBaseUrl)) return null;
    return { baseUrl: payload.runtimeProxyBaseUrl, token: "", runtimeAccess: "same_origin_proxy" };
  }
  if (!payload.runtimeUrl || !isLoopbackRuntimeUrl(payload.runtimeUrl) || current.runtimeAccess === "same_origin_proxy") return null;
  return {
    baseUrl: payload.runtimeUrl,
    token: payload.sessionToken || (payload.runtimeUrl === current.baseUrl ? current.token : ""),
    runtimeAccess: "direct",
  };
}

export function resolveWorkspaceBindingUpdate(
  currentRequestId: string | null,
  message: Pick<HostMessage, "type" | "requestId" | "payload">,
): { requestId: string | null; binding: WorkspaceBindingPayload | null; changed: boolean } {
  if (message.type === "host.ready") {
    const requestId = message.requestId ?? null;
    return { requestId, binding: null, changed: requestId !== currentRequestId };
  }
  if (message.type !== "host.workspaceBinding" || currentRequestId === null || message.requestId !== currentRequestId) {
    return { requestId: currentRequestId, binding: null, changed: false };
  }
  return { requestId: currentRequestId, binding: message.payload as WorkspaceBindingPayload, changed: true };
}

export function useLiveRuntimeSettings(): { settings: RuntimeSettings; updateSettings: (settings: RuntimeSettings) => void; bridgeAdapter: BridgeAdapter; workspaceBinding: WorkspaceBindingPayload | null } {
  const [settings, setSettings] = useState<RuntimeSettings>(readInitialRuntimeSettings);
  const [workspaceBinding, setWorkspaceBinding] = useState<WorkspaceBindingPayload | null>(null);
  const hostReadyRequestId = useRef<string | null>(null);
  const [bridgeAdapter] = useState(() => createBridgeAdapter(() => undefined));
  const updateSettings = useCallback((next: RuntimeSettings) => {
    setSettings({ baseUrl: next.baseUrl, token: next.token ?? "", runtimeAccess: next.runtimeAccess ?? "direct" });
  }, []);

  useEffect(() => {
    const unsubscribe = bridgeAdapter.subscribe((message) => {
      if (message.type === "host.ready") {
        const payload = message.payload as HostReadyPayload | undefined;
        setSettings((current) => resolveHostReadyRuntimeSettings(current, payload) ?? current);
        const update = resolveWorkspaceBindingUpdate(hostReadyRequestId.current, message);
        hostReadyRequestId.current = update.requestId;
        if (update.changed) setWorkspaceBinding(null);
      } else if (message.type === "host.workspaceBinding") {
        const update = resolveWorkspaceBindingUpdate(hostReadyRequestId.current, message);
        if (update.changed) setWorkspaceBinding(update.binding);
      }
    });
    return () => {
      unsubscribe();
      bridgeAdapter.dispose();
    };
  }, [bridgeAdapter]);

  return { settings, updateSettings, bridgeAdapter, workspaceBinding };
}

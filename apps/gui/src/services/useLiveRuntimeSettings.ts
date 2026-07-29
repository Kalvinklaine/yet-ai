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
  if (payload.runtimeUrl === undefined) return current;
  if (!isLoopbackRuntimeUrl(payload.runtimeUrl) || current.runtimeAccess === "same_origin_proxy") return null;
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

export function useLiveRuntimeSettings(): { settings: RuntimeSettings; runtimeSettingsRevision: number; updateSettings: (settings: RuntimeSettings) => void; bridgeAdapter: BridgeAdapter; workspaceBinding: WorkspaceBindingPayload | null; hostReadyGeneration: string | null } {
  const [settings, setSettings] = useState<RuntimeSettings>(readInitialRuntimeSettings);
  const [runtimeSettingsRevision, setRuntimeSettingsRevision] = useState(0);
  const [workspaceBinding, setWorkspaceBinding] = useState<WorkspaceBindingPayload | null>(null);
  const [hostReadyGeneration, setHostReadyGeneration] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const hostReadyRequestId = useRef<string | null>(null);
  const [bridgeAdapter] = useState(() => createBridgeAdapter(() => undefined));
  const updateSettings = useCallback((next: RuntimeSettings) => {
    const normalized = { baseUrl: next.baseUrl, token: next.token ?? "", runtimeAccess: next.runtimeAccess ?? "direct" };
    if (sameRuntimeIdentity(settingsRef.current, normalized)) return;
    settingsRef.current = normalized;
    setSettings(normalized);
    setRuntimeSettingsRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    const unsubscribe = bridgeAdapter.subscribe((message) => {
      if (message.type === "host.ready") {
        const payload = message.payload as HostReadyPayload | undefined;
        const resolved = resolveHostReadyRuntimeSettings(settingsRef.current, payload);
        if (!resolved || typeof message.requestId !== "string" || message.requestId.length === 0) return;
        const update = resolveWorkspaceBindingUpdate(hostReadyRequestId.current, message);
        hostReadyRequestId.current = update.requestId;
        if (update.changed) setWorkspaceBinding(null);
        setHostReadyGeneration(message.requestId);
        if (!sameRuntimeIdentity(settingsRef.current, resolved)) {
          settingsRef.current = resolved;
          setSettings(resolved);
          setRuntimeSettingsRevision((revision) => revision + 1);
        }
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

  return { settings, runtimeSettingsRevision, updateSettings, bridgeAdapter, workspaceBinding, hostReadyGeneration };
}

function sameRuntimeIdentity(left: RuntimeSettings, right: RuntimeSettings): boolean {
  return left.baseUrl === right.baseUrl && left.token === right.token && left.runtimeAccess === right.runtimeAccess;
}

import { useCallback, useEffect, useState } from "react";
import { createBridgeAdapter, type BridgeAdapter, type HostReadyPayload } from "../bridge/bridgeAdapter";
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

export function useLiveRuntimeSettings(): { settings: RuntimeSettings; updateSettings: (settings: RuntimeSettings) => void; bridgeAdapter: BridgeAdapter } {
  const [settings, setSettings] = useState<RuntimeSettings>(readInitialRuntimeSettings);
  const [bridgeAdapter] = useState(() => createBridgeAdapter(() => undefined));
  const updateSettings = useCallback((next: RuntimeSettings) => {
    setSettings({ baseUrl: next.baseUrl, token: next.token ?? "", runtimeAccess: next.runtimeAccess ?? "direct" });
  }, []);

  useEffect(() => {
    const unsubscribe = bridgeAdapter.subscribe((message) => {
      if (message.type !== "host.ready") return;
      const payload = message.payload as HostReadyPayload | undefined;
      setSettings((current) => {
        return resolveHostReadyRuntimeSettings(current, payload) ?? current;
      });
    });
    return () => {
      unsubscribe();
      bridgeAdapter.dispose();
    };
  }, [bridgeAdapter]);

  return { settings, updateSettings, bridgeAdapter };
}

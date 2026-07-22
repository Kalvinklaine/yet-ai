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
      const runtimeUrl = payload?.runtimeProxyBaseUrl ?? payload?.runtimeUrl;
      if (!runtimeUrl || !isLoopbackRuntimeUrl(runtimeUrl)) return;
      setSettings((current) => {
        const proxyMode = Boolean(payload?.runtimeProxyBaseUrl);
        if (!proxyMode && current.runtimeAccess === "same_origin_proxy") return current;
        const nextToken = proxyMode ? "" : payload?.sessionToken ?? (runtimeUrl === current.baseUrl ? current.token : "");
        return { baseUrl: runtimeUrl, token: nextToken, runtimeAccess: proxyMode ? "same_origin_proxy" : "direct" };
      });
    });
    return () => {
      unsubscribe();
      bridgeAdapter.dispose();
    };
  }, [bridgeAdapter]);

  return { settings, updateSettings, bridgeAdapter };
}

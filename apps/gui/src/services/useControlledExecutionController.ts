import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { BridgeHost } from "../bridge/bridgeAdapter";
import type { ControlledAgentCommandRunRequestCorrelation, ControlledAgentCommandRunRequestResult } from "./controlledAgentCommandRunRequest";
import type { ControlledAgentEditRequestCorrelation, ControlledAgentEditRequestResult } from "./controlledAgentEditRequest";
import type { ControlledAgentFileReadRequestCorrelation, ControlledAgentFileReadRequestResult } from "./controlledAgentFileReadRequest";
import type { ControlledAgentLexicalSearchCorrelation } from "./controlledAgentLexicalSearch";
import type { ControlledAgentMultifileApplyCorrelation } from "./controlledAgentMultifileApplyRequest";
import type { ControlledAgentVerificationBundleRequestCorrelation, ControlledAgentVerificationBundleRequestResult } from "./controlledAgentVerificationBundle";
import { isLiveControlledCapability, type ControlledCapabilityProvenanceMap, type ControlledCapabilitySurface } from "./controlledCapabilityProvenance";
import { createProjectScopeCorrelation, type ProjectScopeController } from "./projectScope";
import { publishControlledHostProgress, type ChatRuntimeSettings, type ControlledHostProgressInput } from "./runtimeClient";

type UseControlledExecutionControllerInput = {
  projectId?: string;
  host: BridgeHost;
  scopeKey: string;
  capabilityProvenance: ControlledCapabilityProvenanceMap;
  settingsRef: MutableRefObject<ChatRuntimeSettings>;
  settingsRevisionRef: MutableRefObject<number>;
  chatIdRef: MutableRefObject<string | null>;
  projectScopeController: ProjectScopeController;
};

export function useControlledExecutionController(input: UseControlledExecutionControllerInput) {
  const currentInputRef = useRef(input);
  currentInputRef.current = input;
  const controlledFileReadCorrelationRef = useRef<ControlledAgentFileReadRequestCorrelation | null>(null);
  const controlledFileReadCompletedRequestIdRef = useRef<string | null>(null);
  const controlledEditCorrelationRef = useRef<ControlledAgentEditRequestCorrelation | null>(null);
  const controlledEditCompletedRequestIdRef = useRef<string | null>(null);
  const controlledCommandRunCorrelationRef = useRef<ControlledAgentCommandRunRequestCorrelation | null>(null);
  const controlledCommandRunCompletedRequestIdRef = useRef<string | null>(null);
  const controlledLexicalSearchCorrelationRef = useRef<ControlledAgentLexicalSearchCorrelation | null>(null);
  const controlledMultifileApplyCorrelationRef = useRef<ControlledAgentMultifileApplyCorrelation | null>(null);
  const controlledMultifileApplyCompletedRequestIdRef = useRef<string | null>(null);
  const controlledVerificationBundleCorrelationRef = useRef<ControlledAgentVerificationBundleRequestCorrelation | null>(null);
  const controlledVerificationBundleCompletedRequestIdRef = useRef<string | null>(null);
  const oneStepFileReadRequestIdRef = useRef<string | null>(null);
  const oneStepEditRequestIdRef = useRef<string | null>(null);
  const oneStepCommandRunRequestIdRef = useRef<string | null>(null);
  const oneStepVerificationBundleRequestIdRef = useRef<string | null>(null);
  const oneStepFileReadRequestRef = useRef<ControlledAgentFileReadRequestResult | null>(null);
  const oneStepEditRequestRef = useRef<ControlledAgentEditRequestResult | null>(null);
  const oneStepCommandRunRequestRef = useRef<ControlledAgentCommandRunRequestResult | null>(null);
  const oneStepVerificationBundleRequestRef = useRef<ControlledAgentVerificationBundleRequestResult | null>(null);
  const oneStepLoopRunCounterRef = useRef(0);

  const clearCorrelations = useCallback(() => {
    controlledFileReadCorrelationRef.current = null;
    controlledFileReadCompletedRequestIdRef.current = null;
    controlledEditCorrelationRef.current = null;
    controlledEditCompletedRequestIdRef.current = null;
    controlledCommandRunCorrelationRef.current = null;
    controlledCommandRunCompletedRequestIdRef.current = null;
    controlledLexicalSearchCorrelationRef.current = null;
    controlledMultifileApplyCorrelationRef.current = null;
    controlledMultifileApplyCompletedRequestIdRef.current = null;
    controlledVerificationBundleCorrelationRef.current = null;
    controlledVerificationBundleCompletedRequestIdRef.current = null;
    oneStepFileReadRequestIdRef.current = null;
    oneStepEditRequestIdRef.current = null;
    oneStepCommandRunRequestIdRef.current = null;
    oneStepVerificationBundleRequestIdRef.current = null;
  }, []);

  useEffect(() => clearCorrelations, [clearCorrelations, input.scopeKey]);

  const publishControlledProgress = useCallback((surface: ControlledCapabilitySurface, progress: ControlledHostProgressInput) => {
    const current = currentInputRef.current;
    if (!current.projectId || !isLiveControlledCapability(current.capabilityProvenance[surface], surface, current.host)) return;
    const targetSettings = current.settingsRef.current;
    if (!("projectScope" in targetSettings)) return;
    const targetRevision = current.settingsRevisionRef.current;
    const targetChatId = current.chatIdRef.current;
    const scopeCorrelation = createProjectScopeCorrelation(current.projectScopeController.current());
    void publishControlledHostProgress(targetSettings, progress).then(() => {
      const latest = currentInputRef.current;
      if (latest.settingsRevisionRef.current !== targetRevision || latest.chatIdRef.current !== targetChatId || !latest.projectScopeController.accepts(scopeCorrelation)) return;
    });
  }, []);

  return {
    controlledFileReadCorrelationRef,
    controlledFileReadCompletedRequestIdRef,
    controlledEditCorrelationRef,
    controlledEditCompletedRequestIdRef,
    controlledCommandRunCorrelationRef,
    controlledCommandRunCompletedRequestIdRef,
    controlledLexicalSearchCorrelationRef,
    controlledMultifileApplyCorrelationRef,
    controlledMultifileApplyCompletedRequestIdRef,
    controlledVerificationBundleCorrelationRef,
    controlledVerificationBundleCompletedRequestIdRef,
    oneStepFileReadRequestIdRef,
    oneStepEditRequestIdRef,
    oneStepCommandRunRequestIdRef,
    oneStepVerificationBundleRequestIdRef,
    oneStepFileReadRequestRef,
    oneStepEditRequestRef,
    oneStepCommandRunRequestRef,
    oneStepVerificationBundleRequestRef,
    oneStepLoopRunCounterRef,
    clearControlledCorrelations: clearCorrelations,
    publishControlledProgress,
  };
}

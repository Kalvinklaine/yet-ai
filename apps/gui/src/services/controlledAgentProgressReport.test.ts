import { describe, expect, it } from "vitest";
import { buildControlledAgentProgressReport, evaluateControlledAgentProgressAvailability } from "./controlledAgentProgressReport";

describe("controlledAgentProgressReport availability", () => {
  it("distinguishes not-started, in-flight, missing, and received progress", () => {
    const report = buildControlledAgentProgressReport({ phase: "planning", summary: "Planning metadata is available." });

    expect(evaluateControlledAgentProgressAvailability("idle", undefined)).toMatchObject({ state: "not_started", failClosed: false });
    expect(evaluateControlledAgentProgressAvailability("planning", undefined)).toMatchObject({ state: "publication_in_flight", failClosed: true });
    expect(evaluateControlledAgentProgressAvailability("failed", undefined)).toMatchObject({ state: "missing_or_dropped", failClosed: true });
    expect(evaluateControlledAgentProgressAvailability("planning", report)).toMatchObject({ state: "received", failClosed: false });
  });
});

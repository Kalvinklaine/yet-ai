import { describe, expect, it } from "vitest";
import { appendControlledRunHistoryItem, createControlledRunHistoryItem, sanitizeControlledRunHistoryArtifactLabel, sanitizeControlledRunHistoryCounter, sanitizeControlledRunHistoryLabel } from "./controlledRunHistory";

const fixedNow = () => new Date("2026-07-07T10:00:00.000Z");
const checksum = `sha256:${"a".repeat(64)}`;

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

describe("controlledRunHistory", () => {
  it("creates sanitized metadata-only history snapshots", () => {
    const item = createControlledRunHistoryItem({
      runId: "run-safe-1",
      createdAt: "2026-07-07T09:00:00.000Z",
      updatedAt: "2026-07-07T09:05:00.000Z",
      hostLabel: "vscode",
      readinessLabels: ["opt_in_ready", "workspace_ready", "checkpoint_ready"],
      phaseLabel: "completed",
      resultLabel: "succeeded",
      counters: [
        { name: "read_count", value: 2 },
        { name: "edit_count", value: 1 },
        { name: "verification_count", value: 1 },
      ],
      summaryLabels: ["controlled run completed", "verification passed"],
      artifactLabels: [{ label: "patch preview artifact", checksumLabel: checksum, sizeBucketLabel: "small", retentionLabel: "short_retention" }],
      checksumLabels: [checksum],
    }, fixedNow);

    expect(item).toEqual({
      schemaVersion: "controlled_run_history.v1",
      runId: "run-safe-1",
      createdAtLabel: "2026-07-07T09:00:00.000Z",
      updatedAtLabel: "2026-07-07T09:05:00.000Z",
      hostLabel: "vscode",
      readinessLabels: ["opt_in_ready", "workspace_ready", "checkpoint_ready"],
      phaseLabel: "completed",
      resultLabel: "succeeded",
      counters: [
        { name: "read_count", value: 2 },
        { name: "edit_count", value: 1 },
        { name: "verification_count", value: 1 },
      ],
      summaryLabels: ["controlled run completed", "verification passed"],
      artifactLabels: [{ label: "patch preview artifact", checksumLabel: checksum, sizeBucketLabel: "small", retentionLabel: "short_retention" }],
      checksumLabels: [checksum],
      safetyLabels: ["metadata_only", "raw_payloads_omitted"],
    });
  });

  it("trims bounded history lists to the newest safe items", () => {
    const first = createControlledRunHistoryItem({ runId: "run-1", phaseLabel: "queued", resultLabel: "pending" }, fixedNow);
    const second = createControlledRunHistoryItem({ runId: "run-2", phaseLabel: "running", resultLabel: "pending" }, fixedNow);
    const third = createControlledRunHistoryItem({ runId: "run-3", phaseLabel: "completed", resultLabel: "succeeded" }, fixedNow);

    expect(appendControlledRunHistoryItem([first, second], third, 2).map((item) => item.runId)).toEqual(["run-2", "run-3"]);
    expect(appendControlledRunHistoryItem([first], second, 0)).toEqual([]);
  });

  it("omits unsafe markers raw fields secrets commands provider payloads and private paths", () => {
    const secret = "access_token=" + "s".repeat(64);
    const unsafeDraft = {
      runId: "run-with-secret-token",
      createdAt: "not a date",
      hostLabel: "vscode",
      readinessLabels: ["workspace_ready", "raw prompt should not persist"],
      phaseLabel: "running",
      resultLabel: "succeeded",
      counters: [
        { name: "read_count", value: 1.8 },
        { name: "byte_bucket", value: 20000 },
        { name: "command", value: 1 },
      ],
      summaryLabels: [
        "safe visible status",
        `provider payload ${secret}`,
        "raw prompt from composer",
        "private path /Users/alice/work/project.ts",
      ],
      artifactLabels: [
        { label: "safe artifact", checksumLabel: checksum, sizeBucketLabel: "small" },
        { label: "raw diff artifact", checksumLabel: checksum },
        { label: "private artifact", privatePath: "/Users/alice/work/out.json" },
      ],
      checksumLabels: [checksum, "sha256:not-valid", `sha256:${"b".repeat(64)} ${secret}`],
      rawPrompt: "please edit this secret task",
      rawFileBody: "export const token = secret",
      rawDiff: "@@ -1 +1 @@",
      command: "npm test -- --runInBand",
      stdout: "full stdout transcript",
      providerPayload: { body: "model transcript" },
      privatePath: "/Users/alice/work/project.ts",
      authToken: secret,
    };
    const item = createControlledRunHistoryItem(unsafeDraft, fixedNow);
    const output = rendered(item);

    expect(item.runId).toBe("run-omitted-unsafe");
    expect(item.resultLabel).toBe("unsafe_metadata_blocked");
    expect(item.summaryLabels).toEqual(["safe visible status"]);
    expect(item.artifactLabels).toEqual([{ label: "safe artifact", checksumLabel: checksum, sizeBucketLabel: "small" }]);
    expect(item.checksumLabels).toEqual([checksum]);
    expect(item.counters).toContainEqual({ name: "read_count", value: 1 });
    expect(item.counters).toContainEqual({ name: "byte_bucket", value: 9999 });
    expect(item.counters.find((counter) => counter.name === "omitted_unsafe_count")?.value).toBeGreaterThan(0);
    expect(item.safetyLabels).toContain("unsafe_metadata_omitted");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("access_token");
    expect(output).not.toContain("raw prompt");
    expect(output).not.toContain("rawFileBody");
    expect(output).not.toContain("rawDiff");
    expect(output).not.toContain("npm test");
    expect(output).not.toContain("stdout");
    expect(output).not.toContain("providerPayload");
    expect(output).not.toContain("/Users/alice");
    expect(output).not.toContain("model transcript");
  });

  it("exposes deterministic sanitizer helpers", () => {
    expect(sanitizeControlledRunHistoryLabel("safe label")).toBe("safe label");
    expect(sanitizeControlledRunHistoryLabel("raw file body from bridge payload")).toBeUndefined();
    expect(sanitizeControlledRunHistoryCounter("repair_attempt_count", 3.9)).toEqual({ name: "repair_attempt_count", value: 3 });
    expect(sanitizeControlledRunHistoryCounter("rawCommand", 1)).toBeUndefined();
    expect(sanitizeControlledRunHistoryArtifactLabel({ label: "safe artifact", checksumLabel: checksum })).toEqual({ label: "safe artifact", checksumLabel: checksum });
    expect(sanitizeControlledRunHistoryArtifactLabel({ label: "safe artifact", rawDiff: "@@" })).toBeUndefined();
  });
});

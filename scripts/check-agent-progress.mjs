import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { reduceAgentProgress } from "./planner-agent-progress.mjs";
import { appendProgressEvent, createProgressListResponse, createProgressState, readProgressState, resolveAgentProgressCacheRoot, resolveAgentProgressStatePath, snapshotProgressState, writeProgressState } from "./planner-agent-progress-state.mjs";
import { formatProgressReport, main as reportMain } from "./planner-agent-progress-report.mjs";

const NOW = "2026-05-29T13:00:00Z";

function event(overrides) {
  return {
    protocolVersion: "2026-05-29",
    eventId: "evt-default",
    runId: "run-T270-001",
    cardId: "T270",
    timestamp: "2026-05-29T12:59:00Z",
    phase: "running_command",
    status: "running",
    message: "Agent progress updated.",
    ...overrides
  };
}

function serialized(value) {
  return JSON.stringify(value);
}

function assertNoSensitiveContent(value) {
  const text = serialized(value).toLowerCase();
  for (const forbidden of [
    "rawprompt",
    "raw_prompt",
    "chainofthought",
    "chain_of_thought",
    "chain-of-thought",
    "providerresponse",
    "provider_response",
    "providerbody",
    "provider_body",
    "toolrawoutput",
    "tool_raw_output",
    "api_key",
    "apikey",
    "authorization",
    "bearer ",
    "cookie",
    "pkce",
    "refresh_token",
    "access_token",
    "credential",
    "sk-live-secret",
    "c:\\users\\",
    "/users/",
    "/home/",
    "/private/",
    "~/",
    "auth.json"
  ]) {
    assert.equal(text.includes(forbidden), false, `snapshot leaked ${forbidden}`);
  }
}

function assertAbsent(value, markers) {
  const text = serialized(value);
  for (const marker of markers) {
    assert.equal(text.includes(marker), false, `value leaked ${marker}`);
  }
}

function runWrapper(args, options = {}) {
  const scriptPath = fileURLToPath(new URL("./planner-agent-progress-run.mjs", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, ...(options.env ?? {}) },
      cwd: new URL("..", import.meta.url)
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function runAssertions() {
  const healthy = reduceAgentProgress(
    [
      event({
        eventId: "evt-healthy-001",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      event({
        eventId: "evt-healthy-002",
        timestamp: "2026-05-29T12:59:45Z",
        phase: "running_command",
        status: "running",
        message: "Running validation with fresh heartbeat.",
        tool: {
          kind: "validation",
          label: "npm run validate:contracts",
          startedAt: "2026-05-29T12:59:00Z"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:55Z",
          lastToolOutputAt: "2026-05-29T12:59:50Z"
        },
        outputTail: "Validation is still running."
      })
    ],
    { now: NOW }
  );
  assert.equal(healthy.status, "healthy_running");
  assert.equal(healthy.stuckReason, "none");
  assert.equal(healthy.currentTool.label, "npm run validate:contracts");
  assert.equal(healthy.lastHeartbeatAt, "2026-05-29T12:59:55Z");
  assert.equal(healthy.heartbeatAgeMs, 5000);
  assertNoSensitiveContent(healthy);

  const longRunning = reduceAgentProgress(
    [
      event({
        eventId: "evt-long-001",
        timestamp: "2026-05-29T12:00:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      event({
        eventId: "evt-long-002",
        timestamp: "2026-05-29T12:59:50Z",
        phase: "verifying",
        status: "running",
        message: "Verification is still producing heartbeats.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:58Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(longRunning.status, "long_running");
  assert.equal(longRunning.stuckReason, "none");
  assert.equal(longRunning.elapsedMs, 3600000);

  const stalled = reduceAgentProgress(
    [
      event({
        eventId: "evt-stalled-001",
        timestamp: "2026-05-29T12:40:00Z",
        phase: "running_command",
        status: "running",
        message: "Command is running.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:54:30Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(stalled.status, "stalled");
  assert.equal(stalled.stuckReason, "heartbeat_timeout");

  const stuck = reduceAgentProgress(
    [
      event({
        eventId: "evt-stuck-001",
        timestamp: "2026-05-29T12:30:00Z",
        phase: "running_command",
        status: "running",
        message: "Command is still running.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:45:00Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(stuck.status, "stuck");
  assert.equal(stuck.stuckReason, "heartbeat_timeout");

  const failed = reduceAgentProgress(
    [
      event({
        eventId: "evt-failed-001",
        timestamp: "2026-05-29T12:57:00Z",
        phase: "running_command",
        status: "running",
        message: "Running command."
      }),
      event({
        eventId: "evt-failed-002",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "Command failed with sanitized error.",
        outputTail: "authorization: Bearer abcdefghijklmnop api_key=sk-live-secret-token path /Users/person/project/.env cookie=session=private"
      })
    ],
    { now: NOW }
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.stuckReason, "explicit_failure");
  assert.equal(failed.completedAt, "2026-05-29T12:58:00Z");
  assertNoSensitiveContent(failed);
  assert.equal(failed.outputTail.includes("[redacted"), true);

  const done = reduceAgentProgress(
    [
      event({
        eventId: "evt-done-001",
        timestamp: "2026-05-29T12:50:00Z",
        phase: "started",
        status: "running",
        message: "Agent started."
      }),
      event({
        eventId: "evt-done-002",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "done",
        status: "done",
        message: "Agent completed verification."
      })
    ],
    { now: NOW }
  );
  assert.equal(done.status, "done");
  assert.equal(done.phase, "done");
  assert.equal(done.completedAt, "2026-05-29T12:59:00Z");
  assert.equal(done.stuckReason, "none");

  const planProposal = {
    protocolVersion: "2026-05-29",
    kind: "manual_runner_plan_proposal",
    title: "Review local provider readiness",
    steps: ["Inspect readiness state", "Confirm local model labels"],
    rationale: "Display the proposed review path before any user-mediated action.",
    nextAction: "Ask the user to review the proposal"
  };
  const planProposalSnapshot = reduceAgentProgress(
    [
      event({
        eventId: "evt-plan-proposal-001",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "reading_context",
        status: "running",
        message: "Manual runner displayed an inert plan proposal.",
        planProposal
      })
    ],
    { now: NOW }
  );
  assert.deepEqual(planProposalSnapshot.planProposal, planProposal);
  assertNoSensitiveContent(planProposalSnapshot);
  for (const forbidden of ["shell", "command", "auto-run", "npm run", "cargo test"]) {
    assert.equal(serialized(planProposalSnapshot).toLowerCase().includes(forbidden), false, `plan proposal leaked ${forbidden}`);
  }

  const unsafePlanProposalSnapshot = reduceAgentProgress(
    [
      event({
        eventId: "evt-plan-proposal-unsafe",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "reading_context",
        status: "running",
        message: "Manual runner displayed an inert plan proposal.",
        planProposal: {
          ...planProposal,
          steps: ["Run shell command npm run check"]
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(unsafePlanProposalSnapshot.planProposal, undefined);
  assertNoSensitiveContent(unsafePlanProposalSnapshot);

  const codingTaskSession = {
    protocolVersion: "2026-06-18",
    kind: "coding_task_session",
    sessionId: "session-T103",
    title: "Improve local status panel",
    goal: "Show safe progress for a guided coding session.",
    status: "verification_visible",
    selectedContext: {
      count: 2,
      refs: [
        { kind: "active_file_excerpt", label: "Active editor excerpt", refId: "ctx-active-1" },
        { kind: "project_memory", label: "Stored project note", refId: "mem-note-1" }
      ]
    },
    memory: {
      count: 1,
      refs: [{ noteId: "mem-note-1", title: "Local progress convention" }]
    },
    latestResponse: { status: "completed", summary: "Response summary is visible." },
    editProposal: { status: "proposed", summary: "Reviewed edit proposal is visible." },
    verification: { status: "succeeded", commandId: "repository-check", summary: "Repository check passed." },
    nextStepSuggestions: ["Review proposed changes", "Summarize outcome"],
    cloudRequired: false,
    providerAccess: "direct"
  };
  const codingTaskSessionSnapshot = reduceAgentProgress(
    [
      event({
        eventId: "evt-coding-session-001",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "reading_context",
        status: "running",
        message: "Guided coding session state is visible.",
        codingTaskSession
      })
    ],
    { now: NOW }
  );
  assert.deepEqual(codingTaskSessionSnapshot.codingTaskSession, codingTaskSession);
  assertNoSensitiveContent(codingTaskSessionSnapshot);
  assert.equal(codingTaskSessionSnapshot.codingTaskSession.cloudRequired, false);
  assert.equal(codingTaskSessionSnapshot.codingTaskSession.providerAccess, "direct");

  for (const unsafeCodingTaskSession of [
    { ...codingTaskSession, cloudRequired: true },
    { ...codingTaskSession, latestResponse: { status: "completed", summary: "raw prompt sk-live-secret" } },
    { ...codingTaskSession, nextStepSuggestions: ["Auto-run shell command npm run check"] },
    { ...codingTaskSession, autoApply: true }
  ]) {
    const unsafeCodingTaskSessionSnapshot = reduceAgentProgress(
      [
        event({
          eventId: `evt-coding-session-unsafe-${JSON.stringify(unsafeCodingTaskSession).length}`,
          timestamp: "2026-05-29T12:59:00Z",
          phase: "reading_context",
          status: "running",
          message: "Guided coding session state is visible.",
          codingTaskSession: unsafeCodingTaskSession
        })
      ],
      { now: NOW }
    );
    assert.equal(unsafeCodingTaskSessionSnapshot.codingTaskSession, undefined);
    assertNoSensitiveContent(unsafeCodingTaskSessionSnapshot);
  }

  const unordered = [
    event({
      eventId: "evt-order-003",
      timestamp: "2026-05-29T12:59:00Z",
      phase: "verifying",
      status: "running",
      message: "Later event."
    }),
    event({
      eventId: "evt-order-001",
      timestamp: "2026-05-29T12:57:00Z",
      phase: "started",
      status: "running",
      message: "Earlier event."
    }),
    event({
      eventId: "evt-order-003",
      timestamp: "2026-05-29T12:59:00Z",
      phase: "failed",
      status: "failed",
      message: "Duplicate should be ignored."
    }),
    event({
      eventId: "evt-order-002",
      timestamp: "2026-05-29T12:58:00Z",
      phase: "stuck",
      status: "stuck",
      message: "Agent explicitly stuck."
    }),
    event({
      eventId: "evt-order-004",
      timestamp: "2026-05-29T12:59:30Z",
      phase: "done",
      status: "done",
      message: "Terminal done supersedes stuck."
    })
  ];
  const unorderedA = reduceAgentProgress(unordered, { now: NOW });
  const unorderedB = reduceAgentProgress([...unordered].reverse(), { now: NOW });
  assert.deepEqual(unorderedA, unorderedB);
  assert.equal(unorderedA.status, "done");
  assert.equal(unorderedA.stuckReason, "none");
  assert.deepEqual(
    unorderedA.recentEvents.map((recent) => recent.eventId),
    ["evt-order-001", "evt-order-002", "evt-order-003", "evt-order-004"]
  );

  const malicious = reduceAgentProgress(
    [
      event({
        eventId: "evt-malicious-001",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "running_command",
        status: "running",
        message: "raw_prompt: read /Users/person/project/file.ts with chain-of-thought and provider_response",
        tool: {
          kind: "command",
          label: "cat /home/person/.credentials token=secret"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:59Z",
          lastToolOutputAt: "2026-05-29T12:59:59Z"
        },
        outputTail: "chain of thought: hidden\nprovider response: raw\ncredential=/private/tmp/key\naccess_token=abc123\nfile content: export API_KEY=sk-live-secret-token"
      })
    ],
    { now: NOW }
  );
  assert.equal(malicious.status, "healthy_running");
  assertNoSensitiveContent(malicious);
  assert.equal(serialized(malicious).length < 5000, true, "snapshot was not bounded");

  const hugeSecretOutput = [
    "task_board_get failed because task board output too large and maximum context length was exceeded.",
    "authorization: Bearer abcdefghijklmnop cookie=session=private api_key=sk-live-secret-token",
    "raw_prompt: include provider_response and file content from /Users/person/project/file.ts",
    "C:\\Users\\person\\AppData\\secret auth.json ~/.codex/auth.json /private/tmp/key /home/person/file"
  ].join("\n") + "\n" + "provider response raw dump ".repeat(1000);
  const overflowFailed = reduceAgentProgress(
    [
      event({
        eventId: "evt-overflow-failed",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "context_length_exceeded while reading task_board_get output.",
        outputTail: hugeSecretOutput
      })
    ],
    { now: NOW }
  );
  assert.equal(overflowFailed.status, "failed");
  assert.equal(overflowFailed.overflowRecovery.kind, "task_board_output_too_large");
  assert.equal(overflowFailed.overflowRecovery.retryable, true);
  assert.match(overflowFailed.overflowRecovery.message, /scoped context/);
  assert.match(overflowFailed.overflowRecovery.message, /task_ready_cards/);
  assert.match(overflowFailed.overflowRecovery.message, /task_board_get\(card_id\)/);
  assertNoSensitiveContent(overflowFailed);
  assert.equal(serialized(overflowFailed).length < 5000, true, "overflow snapshot was not bounded");
  assert.equal((overflowFailed.outputTail.match(/provider response raw dump/g) ?? []).length < 20, true, "overflow output tail retained huge dump");

  const overflowStuck = reduceAgentProgress(
    [
      event({
        eventId: "evt-overflow-stuck",
        timestamp: "2026-05-29T12:30:00Z",
        phase: "running_command",
        status: "running",
        message: "Tool output too large while collecting scoped search results.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:45:00Z"
        },
        outputTail: hugeSecretOutput
      })
    ],
    { now: NOW }
  );
  assert.equal(overflowStuck.status, "stuck");
  assert.equal(overflowStuck.overflowRecovery.kind, "tool_output_too_large");
  assertNoSensitiveContent(overflowStuck);

  const genericTooLarge = reduceAgentProgress(
    [
      event({
        eventId: "evt-generic-too-large",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "running_command",
        status: "running",
        message: "Result was too large.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:58Z"
        }
      })
    ],
    { now: NOW }
  );
  assert.equal(genericTooLarge.overflowRecovery, undefined);

  const rawBodyMarkers = [
    "UNIQUE_COT_BODY_DO_NOT_SHOW",
    "UNIQUE_PROMPT_BODY_DO_NOT_SHOW",
    "UNIQUE_PROVIDER_BODY_DO_NOT_SHOW",
    "UNIQUE_PROVIDER_BODY_ALT_DO_NOT_SHOW",
    "UNIQUE_FILE_BODY_DO_NOT_SHOW",
    "UNIQUE_FILE_PLURAL_BODY_DO_NOT_SHOW",
    "UNIQUE_WORKSPACE_BODY_DO_NOT_SHOW",
    "UNIQUE_WORKSPACE_PLURAL_BODY_DO_NOT_SHOW",
    "UNIQUE_TOOL_RAW_BODY_DO_NOT_SHOW"
  ];
  const rawContentSentinel = reduceAgentProgress(
    [
      event({
        eventId: "evt-raw-content-sentinel",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "failed",
        status: "failed",
        message: "Raw-Prompt: UNIQUE_PROMPT_BODY_DO_NOT_SHOW should be hidden",
        outputTail: [
          "chain of thought: UNIQUE_COT_BODY_DO_NOT_SHOW",
          "provider_response = UNIQUE_PROVIDER_BODY_DO_NOT_SHOW",
          "provider body: UNIQUE_PROVIDER_BODY_ALT_DO_NOT_SHOW",
          "file-content: UNIQUE_FILE_BODY_DO_NOT_SHOW",
          "file contents: UNIQUE_FILE_PLURAL_BODY_DO_NOT_SHOW",
          "workspace content: UNIQUE_WORKSPACE_BODY_DO_NOT_SHOW",
          "workspace contents: UNIQUE_WORKSPACE_PLURAL_BODY_DO_NOT_SHOW",
          "tool raw output: UNIQUE_TOOL_RAW_BODY_DO_NOT_SHOW"
        ].join("\n")
      })
    ],
    { now: NOW }
  );
  assert.equal(rawContentSentinel.status, "failed");
  assertNoSensitiveContent(rawContentSentinel);
  assertAbsent(rawContentSentinel, rawBodyMarkers);
  assertAbsent(formatProgressReport(rawContentSentinel), rawBodyMarkers);

  const headOverflowMarker = reduceAgentProgress(
    [
      event({
        eventId: "evt-head-overflow-marker",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "Command failed.",
        outputTail: `context_length_exceeded while building prompt window. ${"safe filler ".repeat(1200)}`
      })
    ],
    { now: NOW }
  );
  assert.equal(headOverflowMarker.status, "failed");
  assert.equal(headOverflowMarker.overflowRecovery.kind, "context_length_exceeded");
  assert.equal(headOverflowMarker.outputTail.length <= 2000, true, "head overflow tail was not bounded");
  assertNoSensitiveContent(headOverflowMarker);

  const recoveredDone = reduceAgentProgress(
    [
      event({
        eventId: "evt-recovered-overflow",
        timestamp: "2026-05-29T12:50:00Z",
        phase: "failed",
        status: "failed",
        message: "context_length_exceeded while reading task_board_get output."
      }),
      event({
        eventId: "evt-recovered-done",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "done",
        status: "done",
        message: "Agent completed after scoped retry."
      })
    ],
    { now: NOW }
  );
  assert.equal(recoveredDone.status, "done");
  assert.equal(recoveredDone.overflowRecovery, undefined);
  assert.doesNotMatch(formatProgressReport(recoveredDone), /overflow_recovery/);

  const rawProviderOverflowMarkers = [
    "UNIQUE_PROVIDER_CONTEXT_BODY_DO_NOT_SHOW",
    "UNIQUE_RAW_PROMPT_CONTEXT_BODY_DO_NOT_SHOW"
  ];
  const rawProviderOverflow = reduceAgentProgress(
    [
      event({
        eventId: "evt-provider-response-overflow",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "Command failed with generic sanitized message.",
        outputTail: [
          "provider response: context_length_exceeded while building maximum context window UNIQUE_PROVIDER_CONTEXT_BODY_DO_NOT_SHOW",
          "raw prompt: maximum context length exceeded UNIQUE_RAW_PROMPT_CONTEXT_BODY_DO_NOT_SHOW"
        ].join("\n")
      })
    ],
    { now: NOW }
  );
  assert.equal(rawProviderOverflow.status, "failed");
  assert.equal(rawProviderOverflow.overflowRecovery.kind, "context_length_exceeded");
  assertNoSensitiveContent(rawProviderOverflow);
  assertAbsent(rawProviderOverflow, rawProviderOverflowMarkers);
  assertAbsent(formatProgressReport(rawProviderOverflow), rawProviderOverflowMarkers);

  const rawToolOverflowMarkers = [
    "UNIQUE_TOOL_OUTPUT_BODY_DO_NOT_SHOW",
    "UNIQUE_PROVIDER_TOOL_BODY_DO_NOT_SHOW"
  ];
  const rawToolOverflow = reduceAgentProgress(
    [
      event({
        eventId: "evt-tool-raw-output-overflow",
        timestamp: "2026-05-29T12:30:00Z",
        phase: "running_command",
        status: "running",
        message: "Waiting for command output.",
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:45:00Z"
        },
        outputTail: [
          "tool raw output: tool output too large during search UNIQUE_TOOL_OUTPUT_BODY_DO_NOT_SHOW",
          "provider-body: output too large for command UNIQUE_PROVIDER_TOOL_BODY_DO_NOT_SHOW"
        ].join("\n")
      })
    ],
    { now: NOW }
  );
  assert.equal(rawToolOverflow.status, "stuck");
  assert.equal(rawToolOverflow.overflowRecovery.kind, "tool_output_too_large");
  assertNoSensitiveContent(rawToolOverflow);
  assertAbsent(rawToolOverflow, rawToolOverflowMarkers);
  assertAbsent(formatProgressReport(rawToolOverflow), rawToolOverflowMarkers);

  const spacedRawMarkers = [
    "UNIQUE_SPACED_PROVIDER_BODY_DO_NOT_SHOW",
    "UNIQUE_TABBED_PROMPT_BODY_DO_NOT_SHOW",
    "UNIQUE_SPACED_COT_BODY_DO_NOT_SHOW",
    "UNIQUE_SPACED_WORKSPACE_BODY_DO_NOT_SHOW",
    "UNIQUE_SPACED_FILE_BODY_DO_NOT_SHOW",
    "UNIQUE_SPACED_RAW_TOOL_BODY_DO_NOT_SHOW"
  ];
  const spacedRawLabels = reduceAgentProgress(
    [
      event({
        eventId: "evt-spaced-raw-labels",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "raw\tprompt: context_length_exceeded UNIQUE_TABBED_PROMPT_BODY_DO_NOT_SHOW",
        outputTail: [
          "provider   response: maximum context length exceeded UNIQUE_SPACED_PROVIDER_BODY_DO_NOT_SHOW",
          "chain   of   thought: hidden reasoning UNIQUE_SPACED_COT_BODY_DO_NOT_SHOW",
          "workspace   contents: task board output too large UNIQUE_SPACED_WORKSPACE_BODY_DO_NOT_SHOW",
          "file   contents: private file body UNIQUE_SPACED_FILE_BODY_DO_NOT_SHOW",
          "raw   tool   output: tool output too large during search UNIQUE_SPACED_RAW_TOOL_BODY_DO_NOT_SHOW"
        ].join("\n")
      })
    ],
    { now: NOW }
  );
  assert.equal(spacedRawLabels.status, "failed");
  assert.equal(spacedRawLabels.overflowRecovery.kind, "context_length_exceeded");
  assertNoSensitiveContent(spacedRawLabels);
  assertAbsent(spacedRawLabels, spacedRawMarkers);
  assertAbsent(formatProgressReport(spacedRawLabels), spacedRawMarkers);

  const concatenationFalsePositive = reduceAgentProgress(
    [
      event({
        eventId: "evt-concatenation-too-large",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "concatenation result was too large"
      })
    ],
    { now: NOW }
  );
  assert.equal(concatenationFalsePositive.status, "failed");
  assert.equal(concatenationFalsePositive.overflowRecovery, undefined);

  const catalogFalsePositive = reduceAgentProgress(
    [
      event({
        eventId: "evt-catalog-exceeded",
        timestamp: "2026-05-29T12:58:00Z",
        phase: "failed",
        status: "failed",
        message: "catalog export exceeded size"
      })
    ],
    { now: NOW }
  );
  assert.equal(catalogFalsePositive.status, "failed");
  assert.equal(catalogFalsePositive.overflowRecovery, undefined);


  const tmp = await mkdtemp(join(tmpdir(), "yet-agent-progress-"));
  try {
    const canonicalCacheRoot = join(tmp, "cache-root");
    const canonicalPath = join(canonicalCacheRoot, "yet-ai", "agent-progress", "progress.json");
    const explicitPath = join(tmp, "explicit-progress.json");
    const envPath = join(tmp, "env-progress.json");
    assert.equal(resolveAgentProgressStatePath({ state: explicitPath, cacheRoot: canonicalCacheRoot, env: { YET_AI_AGENT_PROGRESS_STATE: envPath } }), explicitPath);
    assert.equal(resolveAgentProgressStatePath({ cacheRoot: canonicalCacheRoot, env: { YET_AI_AGENT_PROGRESS_STATE: envPath } }), envPath);
    assert.equal(resolveAgentProgressStatePath({ cacheRoot: canonicalCacheRoot, env: {} }), canonicalPath);
    assert.equal(
      resolveAgentProgressStatePath({ cacheRoot: canonicalCacheRoot, env: {}, projectId: "prj_AAAAAAAAAAAAAAAAAAAAAA" }),
      join(canonicalCacheRoot, "yet-ai", "projects", "prj_AAAAAAAAAAAAAAAAAAAAAA", "agent-progress", "progress.json")
    );
    assert.throws(
      () => resolveAgentProgressStatePath({ cacheRoot: canonicalCacheRoot, env: {}, projectId: "../private" }),
      /Invalid agent progress project destination/
    );
    const portableHome = join(tmp, "portable-home");
    const portableEnv = {
      XDG_CACHE_HOME: join(portableHome, ".cache"),
      LOCALAPPDATA: join(portableHome, "AppData", "Local"),
      APPDATA: join(portableHome, "AppData", "Roaming")
    };
    assert.equal(resolveAgentProgressCacheRoot({ env: portableEnv, home: portableHome, platform: "darwin" }), join(portableHome, "Library", "Caches"));
    assert.equal(resolveAgentProgressCacheRoot({ env: portableEnv, home: portableHome, platform: "linux" }), join(portableHome, ".cache"));
    assert.equal(resolveAgentProgressCacheRoot({ env: portableEnv, home: portableHome, platform: "win32" }), join(portableHome, "AppData", "Local"));
    assert.equal(resolveAgentProgressStatePath({ env: portableEnv, home: portableHome, platform: "darwin" }), join(portableHome, "Library", "Caches", "yet-ai", "agent-progress", "progress.json"));
    assert.equal(resolveAgentProgressStatePath({ env: portableEnv, home: portableHome, platform: "linux" }), join(portableHome, ".cache", "yet-ai", "agent-progress", "progress.json"));
    assert.equal(resolveAgentProgressStatePath({ env: portableEnv, home: portableHome, platform: "win32" }), join(portableHome, "AppData", "Local", "yet-ai", "agent-progress", "progress.json"));

    const canonicalAppend = await appendProgressEvent(
      canonicalPath,
      event({
        eventId: "evt-canonical-001",
        timestamp: "2026-05-29T12:59:00Z",
        phase: "started",
        status: "running",
        message: "Canonical path append started."
      }),
      { now: NOW }
    );
    assert.equal(canonicalAppend.events.length, 1);
    assert.deepEqual(await readProgressState(canonicalPath), canonicalAppend);
    assert.deepEqual(JSON.parse(await readFile(canonicalPath, "utf8")), createProgressListResponse(canonicalAppend, { now: NOW }));

    const concurrentPath = join(tmp, "concurrent-progress.json");
    const concurrentEvents = Array.from({ length: 24 }, (_, index) => event({
      eventId: `evt-concurrent-${String(index).padStart(2, "0")}`,
      timestamp: "2026-05-29T12:59:00Z",
      phase: "running_command",
      status: "running",
      message: `Concurrent append ${index}.`
    }));
    await Promise.all(concurrentEvents.map((nextEvent) => appendProgressEvent(concurrentPath, nextEvent, { now: NOW, lockTimeoutMs: 5000 })));
    const concurrentState = await readProgressState(concurrentPath);
    assert.deepEqual(new Set(concurrentState.events.map((nextEvent) => nextEvent.eventId)), new Set(concurrentEvents.map((nextEvent) => nextEvent.eventId)));
    assert.equal(concurrentState.events.length, concurrentEvents.length);
    assertNoSensitiveContent(concurrentState);

    const lockedSecretPath = join(tmp, "sk-live-secret-token-progress.json");
    await writeFile(`${lockedSecretPath}.lock`, "api_key=sk-live-secret-token /private/tmp/secret");
    await assert.rejects(
      appendProgressEvent(
        lockedSecretPath,
        event({ eventId: "evt-lock-timeout", message: "Lock timeout event." }),
        { now: NOW, lockTimeoutMs: 1 }
      ),
      (error) => {
        assert.equal(error.name, "AgentProgressStateError");
        assert.match(error.message, /lock timed out/);
        assertNoSensitiveContent(error.message);
        assertAbsent(error.message, [lockedSecretPath, "sk-live-secret-token", "/private/tmp/secret"]);
        return true;
      }
    );

    const statePath = join(tmp, "progress-state.json");
    const initialState = createProgressState(
      [
        event({
          eventId: "evt-state-001",
          timestamp: "2026-05-29T12:58:00Z",
          phase: "started",
          status: "running",
          message: "State roundtrip started."
        })
      ],
      { now: NOW }
    );
    const written = await writeProgressState(statePath, initialState, { now: NOW });
    const readBack = await readProgressState(statePath);
    assert.deepEqual(readBack, written);
    assert.equal(snapshotProgressState(readBack, { now: NOW }).status, "healthy_running");

    await appendProgressEvent(
      statePath,
      event({
        eventId: "evt-state-002",
        timestamp: "2026-05-29T12:59:45Z",
        phase: "verifying",
        status: "running",
        message: "Append event with sensitive output.",
        tool: {
          kind: "test",
          label: "npm test /Users/person/project secret=hidden"
        },
        heartbeat: {
          lastHeartbeatAt: "2026-05-29T12:59:58Z",
          lastToolOutputAt: "2026-05-29T12:59:57Z"
        },
        outputTail: "ok api_key=sk-live-secret-token /private/tmp/key"
      }),
      { now: NOW }
    );
    const appended = await readProgressState(statePath);
    assert.equal(appended.events.length, 2);
    assert.equal(snapshotProgressState(appended, { now: NOW }).status, "healthy_running");
    assertNoSensitiveContent(appended);

    const healthyReport = formatProgressReport(snapshotProgressState(appended, { now: NOW }));
    assert.match(healthyReport, /status: healthy_running/);
    assert.match(healthyReport, /tool: test npm test \[redacted/);
    assertNoSensitiveContent(healthyReport);
    assert.equal(healthyReport.length < 1200, true, "healthy report was not bounded");

    const stuckReport = formatProgressReport(
      reduceAgentProgress(
        [
          event({
            eventId: "evt-report-stuck",
            timestamp: "2026-05-29T12:30:00Z",
            phase: "running_command",
            status: "running",
            heartbeat: {
              lastHeartbeatAt: "2026-05-29T12:45:00Z"
            }
          })
        ],
        { now: NOW }
      )
    );
    assert.match(stuckReport, /status: stuck/);
    assert.match(stuckReport, /stuck_reason: heartbeat_timeout/);

    const overflowReport = formatProgressReport(overflowFailed);
    assert.match(overflowReport, /overflow_recovery: task_board_output_too_large/);
    assert.match(overflowReport, /scoped context/);
    assert.match(overflowReport, /task_ready_cards/);
    assert.match(overflowReport, /task_board_get\(card_id\)/);
    assertNoSensitiveContent(overflowReport);
    assert.equal(overflowReport.length < 1500, true, "overflow report was not bounded");

    const failedReport = formatProgressReport(failed);
    assert.match(failedReport, /status: failed/);
    assert.match(failedReport, /stuck_reason: explicit_failure/);
    assertNoSensitiveContent(failedReport);

    const doneReport = formatProgressReport(done);
    assert.match(doneReport, /status: done/);
    assert.match(doneReport, /phase: done/);

    let stdout = "";
    let stderr = "";
    const reportExit = await reportMain(["--state", statePath, "--now", NOW], {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } }
    });
    assert.equal(reportExit, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /status: healthy_running/);
    assertNoSensitiveContent(stdout);

    const invalidPath = join(tmp, "invalid-state.json");
    await writeFile(invalidPath, JSON.stringify({ protocolVersion: "2026-05-29", events: "api_key=sk-live-secret-token" }));
    stdout = "";
    stderr = "";
    const invalidExit = await reportMain(["--state", invalidPath, "--now", NOW], {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } }
    });
    assert.equal(invalidExit, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /events must be an array/);
    assertNoSensitiveContent(stderr);

    stderr = "";
    const missingExit = await reportMain(["--state", join(tmp, "missing.json"), "--now", NOW], {
      stdout: { write: () => {} },
      stderr: { write: (value) => { stderr += value; } }
    });
    assert.equal(missingExit, 1);
    assert.match(stderr, /not found/);

    const wrapperSuccessPath = join(tmp, "wrapper-success.json");
    const successResult = await runWrapper([
      "--card", "T371",
      "--run", "run-wrapper-success",
      "--state", wrapperSuccessPath,
      "--phase", "verifying",
      "--tool-kind", "validation",
      "--tool-label", "npm run validate:contracts /Users/person/project",
      "--heartbeat-interval-ms", "100",
      "--",
      process.execPath,
      "-e",
      "console.log('api_key=sk-live-secret-token /Users/person/project'); setTimeout(() => console.log('safe output done'), 260);"
    ]);
    assert.equal(successResult.code, 0);
    assert.match(successResult.stdout, /api_key=sk-live-secret-token/);
    assert.match(successResult.stdout, /safe output done/);
    assert.equal(successResult.stderr, "");
    const wrapperSuccessState = await readProgressState(wrapperSuccessPath);
    const wrapperSuccessPublished = JSON.parse(await readFile(wrapperSuccessPath, "utf8"));
    assert.equal(wrapperSuccessPublished.cloudRequired, false);
    assert.equal(wrapperSuccessPublished.providerAccess, "direct");
    assert.equal(wrapperSuccessPublished.snapshots.some((snapshot) => snapshot.runId === "run-wrapper-success" && snapshot.status === "done"), true);
    assert.equal(wrapperSuccessState.events.some((nextEvent) => nextEvent.phase === "started"), true);
    assert.equal(wrapperSuccessState.events.some((nextEvent) => nextEvent.phase === "verifying" && nextEvent.heartbeat?.lastHeartbeatAt !== undefined), true);
    assert.equal(wrapperSuccessState.events.some((nextEvent) => nextEvent.phase === "done" && nextEvent.status === "done"), true);
    assert.equal(wrapperSuccessState.events.at(-1).phase, "done");
    assert.equal(wrapperSuccessState.events.at(-1).status, "done");
    const wrapperSuccessSnapshot = snapshotProgressState(wrapperSuccessState);
    assert.equal(wrapperSuccessSnapshot.status, "done");
    assert.equal(wrapperSuccessSnapshot.phase, "done");
    assert.equal(wrapperSuccessSnapshot.currentTool.kind, "validation");
    assert.match(wrapperSuccessSnapshot.currentTool.label, /npm run validate:contracts/);
    assert.equal(typeof wrapperSuccessSnapshot.lastHeartbeatAt, "string");
    assert.equal(Number.isInteger(wrapperSuccessSnapshot.heartbeatAgeMs), true);
    assert.equal(typeof wrapperSuccessSnapshot.lastToolOutputAt, "string");
    assert.equal(Number.isInteger(wrapperSuccessSnapshot.toolOutputAgeMs), true);
    assert.equal(wrapperSuccessSnapshot.outputTail.length <= 2000, true, "wrapper success output tail was not bounded");
    assert.match(wrapperSuccessSnapshot.outputTail, /\[redacted/);
    assertNoSensitiveContent(wrapperSuccessState);

    const wrapperFailPath = join(tmp, "wrapper-fail.json");
    const failResult = await runWrapper([
      "--card", "T371",
      "--run", "run-wrapper-fail",
      "--state", wrapperFailPath,
      "--tool-kind", "test",
      "--tool-label", "failing command",
      "--heartbeat-interval-ms", "100",
      "--",
      process.execPath,
      "-e",
      "console.error('provider response: UNIQUE_FAIL_BODY_DO_NOT_SHOW'); process.exit(7);"
    ]);
    assert.equal(failResult.code, 7);
    assert.match(failResult.stderr, /provider response: UNIQUE_FAIL_BODY_DO_NOT_SHOW/);
    assert.equal(failResult.stdout, "");
    const wrapperFailState = await readProgressState(wrapperFailPath);
    const wrapperFailSnapshot = snapshotProgressState(wrapperFailState);
    assert.equal(wrapperFailSnapshot.status, "failed");
    assert.equal(wrapperFailSnapshot.stuckReason, "explicit_failure");
    assert.equal(wrapperFailSnapshot.currentTool.kind, "test");
    assert.equal(wrapperFailState.events.at(-1).phase, "failed");
    assert.equal(wrapperFailState.events.at(-1).status, "failed");
    assertAbsent(wrapperFailSnapshot, ["UNIQUE_FAIL_BODY_DO_NOT_SHOW"]);
    assertNoSensitiveContent(wrapperFailState);

    const wrapperMissingPath = join(tmp, "wrapper-missing.json");
    const missingCommandResult = await runWrapper([
      "--card", "T371",
      "--run", "run-wrapper-missing",
      "--state", wrapperMissingPath,
      "--tool-kind", "command",
      "--tool-label", "missing wrapped command",
      "--heartbeat-interval-ms", "100",
      "--",
      "definitely-not-a-real-command"
    ]);
    assert.notEqual(missingCommandResult.code, 0);
    assert.equal(missingCommandResult.signal, null);
    assert.equal(missingCommandResult.stdout, "");
    assert.match(missingCommandResult.stderr, /Wrapped command could not be started/);
    assert.doesNotMatch(missingCommandResult.stderr, /Unhandled 'error' event/);
    assert.doesNotMatch(missingCommandResult.stderr, /definitely-not-a-real-command/);
    assert.equal(missingCommandResult.stderr.length <= 1000, true, "missing command stderr was not bounded");
    assertNoSensitiveContent(missingCommandResult.stderr);
    const wrapperMissingState = await readProgressState(wrapperMissingPath);
    const wrapperMissingSnapshot = snapshotProgressState(wrapperMissingState);
    assert.equal(wrapperMissingSnapshot.status, "failed");
    assert.equal(wrapperMissingSnapshot.stuckReason, "explicit_failure");
    assert.equal(wrapperMissingState.events.at(-1).phase, "failed");
    assert.equal(wrapperMissingState.events.at(-1).status, "failed");
    assertNoSensitiveContent(wrapperMissingState);

    if (process.platform !== "win32") {
      const wrapperSigtermPath = join(tmp, "wrapper-sigterm.json");
      const sigtermResult = await runWrapper([
        "--card", "T371",
        "--run", "run-wrapper-sigterm",
        "--state", wrapperSigtermPath,
        "--tool-kind", "command",
        "--tool-label", "self terminating command",
        "--heartbeat-interval-ms", "100",
        "--",
        process.execPath,
        "-e",
        "process.kill(process.pid, 'SIGTERM');"
      ]);
      assert.equal(sigtermResult.code, 143);
      assert.equal(sigtermResult.signal, null);
      const wrapperSigtermState = await readProgressState(wrapperSigtermPath);
      const wrapperSigtermSnapshot = snapshotProgressState(wrapperSigtermState);
      assert.equal(wrapperSigtermSnapshot.status, "failed");
      assert.equal(wrapperSigtermSnapshot.stuckReason, "explicit_failure");
      assert.equal(wrapperSigtermState.events.at(-1).phase, "failed");
      assert.equal(wrapperSigtermState.events.at(-1).status, "failed");
      assertNoSensitiveContent(wrapperSigtermState);
    }

    const wrapperRacePath = join(tmp, "wrapper-race.json");
    const raceResult = await runWrapper([
      "--card", "T371",
      "--run", "run-wrapper-race",
      "--state", wrapperRacePath,
      "--heartbeat-interval-ms", "1",
      "--",
      process.execPath,
      "-e",
      "setTimeout(() => process.exit(0), 220);"
    ]);
    assert.equal(raceResult.code, 0);
    const wrapperRaceState = await readProgressState(wrapperRacePath);
    const wrapperRaceSnapshot = snapshotProgressState(wrapperRaceState);
    assert.equal(wrapperRaceSnapshot.status, "done");
    assert.equal(wrapperRaceSnapshot.phase, "done");
    assert.equal(wrapperRaceState.events.at(-1).phase, "done");
    assert.equal(wrapperRaceState.events.at(-1).status, "done");

    const wrapperBoundedPath = join(tmp, "wrapper-bounded.json");
    const boundedResult = await runWrapper([
      "--card", "T371",
      "--run", "run-wrapper-bounded",
      "--state", wrapperBoundedPath,
      "--heartbeat-interval-ms", "100",
      "--",
      process.execPath,
      "-e",
      "console.log('safe-line '.repeat(600) + ' authorization: Bearer abcdefghijklmnop /private/tmp/key ' + 'tail '.repeat(600));"
    ]);
    assert.equal(boundedResult.code, 0);
    assert.match(boundedResult.stdout, /authorization: Bearer abcdefghijklmnop/);
    assert.match(boundedResult.stdout, /safe-line/);
    const wrapperBoundedSnapshot = snapshotProgressState(await readProgressState(wrapperBoundedPath));
    assert.equal(wrapperBoundedSnapshot.outputTail.length <= 2000, true, "wrapper output tail exceeded limit");
    assertNoSensitiveContent(wrapperBoundedSnapshot);

    const envStatePath = join(tmp, "wrapper-env", "progress.json");
    const envResult = await runWrapper([
      "--card", "T371",
      "--run", "run-wrapper-env",
      "--",
      process.execPath,
      "-e",
      "process.exit(0);"
    ], { env: { YET_AI_AGENT_PROGRESS_STATE: envStatePath } });
    assert.equal(envResult.code, 0);
    assert.equal(snapshotProgressState(await readProgressState(envStatePath)).status, "done");

    const missingArgsResult = await runWrapper(["--card", "T371"]);
    assert.notEqual(missingArgsResult.code, 0);
    assert.match(missingArgsResult.stderr, /missing run id|Missing wrapped command|Usage/);
    assertNoSensitiveContent(missingArgsResult.stderr);

    const invalidIdResult = await runWrapper([
      "--card", "T371/api_key=sk-live-secret-token",
      "--run", "run-wrapper-invalid",
      "--",
      process.execPath,
      "-e",
      "process.exit(0);"
    ]);
    assert.notEqual(invalidIdResult.code, 0);
    assert.match(invalidIdResult.stderr, /Invalid or missing card id/);
    assertNoSensitiveContent(invalidIdResult.stderr);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAssertions();
  console.log("Agent progress reducer check passed.");
}

export { runAssertions };

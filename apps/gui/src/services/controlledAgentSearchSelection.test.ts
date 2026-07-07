import { describe, expect, it } from "vitest";
import { controlledAgentSearchSelectionResultId, createControlledAgentSearchSelection, type ControlledAgentSearchSelectionResult } from "./controlledAgentSearchSelection";
import type { ControlledAgentLexicalSearchSnippet, ControlledAgentLexicalSearchSummary } from "./controlledAgentLexicalSearch";

const hash = `sha256:${"a".repeat(64)}`;

function snippet(overrides: Partial<ControlledAgentLexicalSearchSnippet> = {}): ControlledAgentLexicalSearchSnippet {
  const text = overrides.snippet ?? "function ChatComposer() {\n  return null;\n}";
  return {
    pathLabel: "apps/gui/src/App.tsx",
    range: { start: { line: 10, character: 0 }, end: { line: 12, character: 1 } },
    languageId: "typescriptreact",
    snippet: text,
    snippetByteCount: new TextEncoder().encode(text).length,
    snippetHash: hash,
    matchCount: 1,
    truncated: false,
    ...overrides,
  };
}

function lexicalSearch(snippets: ControlledAgentLexicalSearchSnippet[] = [snippet()]): ControlledAgentLexicalSearchSummary {
  return {
    status: "succeeded",
    resultCount: snippets.length,
    totalMatchCount: snippets.reduce((total, item) => total + item.matchCount, 0),
    totalSnippetBytes: snippets.reduce((total, item) => total + item.snippetByteCount, 0),
    truncated: false,
    resultHash: `sha256:${"b".repeat(64)}`,
    snippets,
    message: "Controlled lexical search completed.",
  };
}

function selectionInput(overrides: Record<string, unknown> = {}) {
  const result = lexicalSearch();
  return {
    searchResultId: "lexical-result-s112",
    lexicalSearch: result,
    selectedResultIds: [controlledAgentSearchSelectionResultId(result.snippets[0])],
    explicitUserGesture: true,
    userGestureId: "gesture-s112-selection",
    selectionMintedBy: "user",
    assistantMinted: false,
    ...overrides,
  };
}

function output(value: unknown): string {
  return JSON.stringify(value);
}

describe("controlledAgentSearchSelection", () => {
  it("creates a metadata-only selected search context summary for explicit user selection", () => {
    const result = createControlledAgentSearchSelection(selectionInput());

    expect(result.state).toBe("ready");
    expect(result.selectedContext).toMatchObject({
      kind: "controlled_agent_selected_search_context",
      source: "controlled_lexical_search",
      searchResultId: "lexical-result-s112",
      selectedCount: 1,
      items: [
        {
          pathLabel: "apps/gui/src/App.tsx",
          range: "10:0-12:1",
          languageId: "typescriptreact",
          snippetByteCount: 42,
          snippetLineCount: 3,
          matchCount: 1,
          truncated: false,
        },
      ],
      policy: {
        canAttachToPrompt: false,
        canAutoAttachContext: false,
        canAutoSend: false,
        canCallProvider: false,
        canPersistSelection: false,
      },
    });
    expect(result.selectedContext?.selectedLabels[0]).toBe("apps/gui/src/App.tsx · 10:0-12:1 · typescriptreact");
    expect(output(result.selectedContext)).not.toContain("function ChatComposer");
    expect(Object.values(result.authority).every((value) => value === false)).toBe(true);
  });

  it("selects truncated search results as bounded metadata", () => {
    const truncatedSnippet = snippet({ truncated: true });
    const search = { ...lexicalSearch([truncatedSnippet]), status: "truncated" as const, truncated: true, message: "Literal snippets returned as truncated sanitized metadata." };
    const result = createControlledAgentSearchSelection(selectionInput({ lexicalSearch: search, selectedResultIds: [controlledAgentSearchSelectionResultId(truncatedSnippet)] }));

    expect(result.state).toBe("ready");
    expect(result.selectedContext?.items[0]).toMatchObject({ pathLabel: "apps/gui/src/App.tsx", truncated: true });
    expect(result.selectedContext?.selectedCount).toBe(1);
    expect(output(result.selectedContext)).not.toContain("function ChatComposer");
  });

  it("selects safe snippets containing provider command and tool vocabulary", () => {
    const safeCode = "const providerCommandTool = createActionProvider(commandTool);";
    const safeSnippet = snippet({ snippet: safeCode, snippetByteCount: new TextEncoder().encode(safeCode).length });
    const result = createControlledAgentSearchSelection(selectionInput({ lexicalSearch: lexicalSearch([safeSnippet]), selectedResultIds: [controlledAgentSearchSelectionResultId(safeSnippet)] }));

    expect(result.state).toBe("ready");
    expect(result.selectedContext?.selectedCount).toBe(1);
    expect(output(result.selectedContext)).not.toContain("providerCommandTool");
  });

  it("fails closed for assistant-minted selection authority", () => {
    const result = createControlledAgentSearchSelection(selectionInput({ selectionMintedBy: "assistant", assistantMinted: true }));

    expect(result.state).toBe("blocked");
    expect(result.selectedContext).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("assistant_authority_blocked");
  });

  it("fails closed for stale selected result ids", () => {
    const result = createControlledAgentSearchSelection(selectionInput({ selectedResultIds: ["search-result-stale"] }));

    expect(result.state).toBe("blocked");
    expect(result.selectedContext).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("stale_result");
  });

  it("fails closed and omits raw data for unsafe snippets and private paths", () => {
    const unsafeSnippet = snippet({ pathLabel: "/Users/alice/project/src/App.tsx", snippet: "Authorization: Bearer unsafe-token" });
    unsafeSnippet.snippetByteCount = new TextEncoder().encode(unsafeSnippet.snippet).length;
    const result = createControlledAgentSearchSelection(selectionInput({ lexicalSearch: lexicalSearch([unsafeSnippet]), selectedResultIds: [controlledAgentSearchSelectionResultId(unsafeSnippet)] }));

    expect(result.state).toBe("blocked");
    expect(result.selectedContext).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
    expect(output(result)).not.toContain("Bearer unsafe-token");
    expect(output(result)).not.toContain("/Users/alice");
  });

  it("fails closed for raw prompt, diff, command, provider, and secret-looking markers", () => {
    const cases = [
      { rawPrompt: "attach this" },
      { diff: "@@ -1 +1" },
      { command: "npm test" },
      { providerPayload: "model gateway" },
      { note: "sk-proj-1234567890abcdef" },
    ];

    for (const extra of cases) {
      const result = createControlledAgentSearchSelection(selectionInput(extra));
      expect(result.state).toBe("blocked");
      expect(result.selectedContext).toBeUndefined();
      expect(result.diagnostics.map((item) => item.code)).toContain("unsafe_metadata");
      expect(output(result)).not.toContain("sk-proj-1234567890abcdef");
    }
  });

  it("fails closed for over-budget selections", () => {
    const snippets = Array.from({ length: 5 }, (_, index) => snippet({
      pathLabel: `apps/gui/src/File${index}.tsx`,
      range: { start: { line: index + 1, character: 0 }, end: { line: index + 1, character: 12 } },
      snippetHash: `sha256:${String(index).repeat(64)}`,
    }));
    const search = lexicalSearch(snippets);
    const result = createControlledAgentSearchSelection(selectionInput({
      lexicalSearch: search,
      selectedResultIds: snippets.map(controlledAgentSearchSelectionResultId),
    })) as ControlledAgentSearchSelectionResult;

    expect(result.state).toBe("blocked");
    expect(result.selectedContext).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("over_budget");
  });
});

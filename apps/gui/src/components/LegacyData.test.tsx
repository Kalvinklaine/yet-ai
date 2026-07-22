import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyData } from "./LegacyData";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("LegacyData", () => {
  it("loads only unscoped compatibility endpoints and exposes no attach, import, or run action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/chats")) return new Response(JSON.stringify({ chats: [] }));
      if (url.endsWith("/v1/project-memory")) return new Response(JSON.stringify({ notes: [] }));
      return new Response(JSON.stringify({ cloudRequired: false, providerAccess: "direct", snapshots: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);

    await act(async () => {
      root = createRoot(container);
      root.render(<LegacyData settings={{ baseUrl: "http://127.0.0.1:8001", token: "" }} navigate={vi.fn()} />);
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:8001/v1/chats",
      "http://127.0.0.1:8001/v1/project-memory",
      "http://127.0.0.1:8001/v1/agent-progress",
    ]);
    expect(container.textContent).toContain("Read and delete only");
    expect(container.textContent).toContain("No project attachment, project agent execution, automatic import");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent)).toEqual([]);
  });
});

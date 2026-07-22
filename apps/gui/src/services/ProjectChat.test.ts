import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectRuntimeSettings } from "./projectClient";
import { createChat, deleteChat, getChat, listChats, sendAbort, sendUserMessage } from "./runtimeClient";

const fetchMock = vi.fn();
const projectA = "prj_abcdefghijklmnopqrstuv";
const projectB = "prj_bcdefghijklmnopqrstuvw";

afterEach(() => vi.unstubAllGlobals());

describe("ProjectChat", () => {
  it("keeps overlapping chat ids inside each explicit project API base", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ chats: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
    const settingsA = createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "" }, projectA);
    const settingsB = createProjectRuntimeSettings({ baseUrl: "http://127.0.0.1:8001", token: "" }, projectB);

    await listChats(settingsA);
    await createChat(settingsA);
    await getChat(settingsA, "shared-chat");
    await deleteChat(settingsA, "shared-chat");
    await sendUserMessage(settingsA, "shared-chat", "hello");
    await sendAbort(settingsA, "shared-chat");
    await getChat(settingsB, "shared-chat");

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `http://127.0.0.1:8001/p/${projectA}/v1/chats`,
      `http://127.0.0.1:8001/p/${projectA}/v1/chats`,
      `http://127.0.0.1:8001/p/${projectA}/v1/chats/shared-chat`,
      `http://127.0.0.1:8001/p/${projectA}/v1/chats/shared-chat`,
      `http://127.0.0.1:8001/p/${projectA}/v1/chats/shared-chat/commands`,
      `http://127.0.0.1:8001/p/${projectA}/v1/chats/shared-chat/commands`,
      `http://127.0.0.1:8001/p/${projectB}/v1/chats/shared-chat`,
    ]);
  });
});

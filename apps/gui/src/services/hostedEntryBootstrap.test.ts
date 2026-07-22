import { describe, expect, it, vi } from "vitest";
import { initializeHostedEntry } from "./hostedEntryBootstrap";

describe("initializeHostedEntry", () => {
  it("accepts the wrapper challenge response before routing starts", async () => {
    const token = "abcdefghijklmnopqrstuvwxABCDEFGH";
    let listener: ((event: MessageEvent) => void) | undefined;
    const parent = {
      postMessage(message: unknown) {
        expect(message).toEqual({ type: "yet-ai.hosted-bootstrap.request", token });
        listener?.({ source: parent, data: { type: "yet-ai.hosted-bootstrap", token, entryMode: "hosted_chat" } } as MessageEvent);
      },
    };
    const replaceState = vi.fn();
    const target = {
      location: { pathname: "/vscode/hosted-chat", href: `http://127.0.0.1:5173/vscode/hosted-chat?yetAiHostedBootstrap=${token}` },
      parent,
      history: { replaceState },
      setTimeout,
      clearTimeout,
      addEventListener(_type: string, callback: (event: MessageEvent) => void) { listener = callback; },
      removeEventListener() { listener = undefined; },
    } as unknown as Window;

    await initializeHostedEntry(target);

    expect(target.__yetAiInitialRuntimeConfig).toEqual({ entryMode: "hosted_chat" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/vscode/hosted-chat");
  });

  it("leaves packaged path and flag bootstrap unchanged without a dev challenge handle", async () => {
    const target = {
      location: { pathname: "/vscode/hosted-chat", href: "http://127.0.0.1:5173/vscode/hosted-chat" },
      parent: {},
      __yetAiInitialRuntimeConfig: { entryMode: "hosted_chat" },
    } as unknown as Window;

    await initializeHostedEntry(target);

    expect(target.__yetAiInitialRuntimeConfig).toEqual({ entryMode: "hosted_chat" });
  });
});

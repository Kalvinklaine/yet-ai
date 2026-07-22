import { describe, expect, it, vi } from "vitest";
import { initializeHostedEntry } from "./hostedEntryBootstrap";

describe("initializeHostedEntry", () => {
  it("retries when the first request is dropped and accepts the wrapper response before routing starts", async () => {
    vi.useFakeTimers();
    const token = "abcdefghijklmnopqrstuvwxABCDEFGH";
    let listener: ((event: MessageEvent) => void) | undefined;
    let requestCount = 0;
    const parent = {
      postMessage(message: unknown) {
        expect(message).toEqual({ type: "yet-ai.hosted-bootstrap.request", token });
        requestCount += 1;
        if (requestCount === 1) return;
        listener?.({ source: parent, data: { type: "yet-ai.hosted-bootstrap", token, entryMode: "hosted_chat" } } as MessageEvent);
      },
    };
    const replaceState = vi.fn();
    const removeEventListener = vi.fn(() => { listener = undefined; });
    const target = {
      location: { pathname: "/vscode/hosted-chat", href: `http://127.0.0.1:5173/vscode/hosted-chat?yetAiHostedBootstrap=${token}` },
      parent,
      history: { replaceState },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      addEventListener(_type: string, callback: (event: MessageEvent) => void) { listener = callback; },
      removeEventListener,
    } as unknown as Window;

    const initialized = initializeHostedEntry(target);
    expect(requestCount).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await initialized;

    expect(requestCount).toBe(2);
    expect(target.__yetAiInitialRuntimeConfig).toEqual({ entryMode: "hosted_chat" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/vscode/hosted-chat");
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(listener).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("cleans up its request timer and listener after the deadline", async () => {
    vi.useFakeTimers();
    const token = "abcdefghijklmnopqrstuvwxABCDEFGH";
    let listener: ((event: MessageEvent) => void) | undefined;
    const parent = { postMessage: vi.fn() };
    const removeEventListener = vi.fn(() => { listener = undefined; });
    const target = {
      location: { pathname: "/vscode/hosted-chat", href: `http://127.0.0.1:5173/vscode/hosted-chat?yetAiHostedBootstrap=${token}` },
      parent,
      history: { replaceState: vi.fn() },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      addEventListener(_type: string, callback: (event: MessageEvent) => void) { listener = callback; },
      removeEventListener,
    } as unknown as Window;

    const initialized = initializeHostedEntry(target);
    await vi.advanceTimersByTimeAsync(3000);
    await initialized;

    expect(parent.postMessage).toHaveBeenCalled();
    expect(target.__yetAiInitialRuntimeConfig).toBeUndefined();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(listener).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
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

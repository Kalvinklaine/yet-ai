import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectChatContextSetupCard } from "./ProjectChatContextSetupCard";

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("ProjectChatContextSetupCard", () => {
  it.each([
    ["not_built", "Build project context", "Build the local project cache once"],
    ["stale", "Rebuild project context", "cache is stale"],
    ["migration_required", "Rebuild project context", "current format"],
    ["unavailable", "Rebuild project context", "context is unavailable"],
  ] as const)("offers explicit setup and prompt-only fallback for %s", (state, action, copy) => {
    const onBuild = vi.fn();
    const onStartWithoutContext = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    act(() => { root = createRoot(container); root.render(<ProjectChatContextSetupCard state={state} working={false} error={null} onBuild={onBuild} onStartWithoutContext={onStartWithoutContext} />); });

    expect(container.textContent).toContain(copy);
    expect(container.textContent).toContain(action);
    expect(container.textContent).toContain("Start without project context");
    expect(container.textContent).toContain("Nothing is built or sent automatically");
    expect(onBuild).not.toHaveBeenCalled();
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === action) as HTMLButtonElement).click());
    act(() => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start without project context") as HTMLButtonElement).click());
    expect(onBuild).toHaveBeenCalledOnce();
    expect(onStartWithoutContext).toHaveBeenCalledOnce();
  });
});

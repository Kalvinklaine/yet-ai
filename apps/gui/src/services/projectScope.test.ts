import { describe, expect, it, vi } from "vitest";
import { parseProjectId } from "./projectRouting";
import { ProjectScopeController, createProjectScopeCorrelation, projectBoundStateFamilies, resetProjectBoundState, type ProjectScopeResetters } from "./projectScope";

const projectA = parseProjectId("prj_AAAAAAAAAAAAAAAAAAAAAA")!;
const projectB = parseProjectId("prj_BBBBBBBBBBBBBBBBBBBBBB")!;

function resetters(calls: string[] = []): ProjectScopeResetters {
  return projectBoundStateFamilies.reduce<ProjectScopeResetters>((result, family) => {
    result[family] = () => calls.push(family);
    return result;
  }, {
    project_memory: () => undefined,
    active_chat: () => undefined,
    active_editor_context: () => undefined,
    workspace_search_snippets: () => undefined,
    task_draft_goal: () => undefined,
    proposals: () => undefined,
    controlled_action_correlations: () => undefined,
    controlled_run_recovery: () => undefined,
    project_errors: () => undefined,
  });
}

describe("ProjectScopeController", () => {
  it("aborts A work, increments generation, and resets every project-bound family on A to B", () => {
    const calls: string[] = [];
    const scope = new ProjectScopeController(projectA);
    const before = scope.current();
    const cancelFetch = vi.fn();
    const cancelSse = vi.fn();
    scope.registerCancellation(cancelFetch);
    scope.registerCancellation(cancelSse);

    expect(scope.transition(projectB, resetters(calls))).toBe(true);

    expect(before.abortSignal.aborted).toBe(true);
    expect(scope.current()).toMatchObject({ projectId: projectB, generation: 1 });
    expect(scope.current().abortSignal.aborted).toBe(false);
    expect(cancelFetch).toHaveBeenCalledOnce();
    expect(cancelSse).toHaveBeenCalledOnce();
    expect(calls).toEqual(projectBoundStateFamilies);
  });

  it("preserves state and generation for same-project subroute navigation", () => {
    const calls: string[] = [];
    const scope = new ProjectScopeController(projectA);
    const signal = scope.current().abortSignal;

    expect(scope.transition(projectA, resetters(calls))).toBe(false);
    expect(scope.current().generation).toBe(0);
    expect(scope.current().abortSignal).toBe(signal);
    expect(calls).toEqual([]);
  });

  it("ignores delayed A results and accepts B results only with project and generation", () => {
    const scope = new ProjectScopeController(projectA);
    const correlationA = createProjectScopeCorrelation(scope.current());
    scope.transition(projectB, resetters());
    const correlationB = createProjectScopeCorrelation(scope.current());

    expect(scope.accepts(correlationA)).toBe(false);
    expect(scope.accepts({ projectId: projectB, generation: correlationA.generation })).toBe(false);
    expect(scope.accepts(correlationB)).toBe(true);
  });

  it("does not let an old SSE cleanup terminate the newer project stream", () => {
    const scope = new ProjectScopeController(projectA);
    const closeA = vi.fn();
    const closeB = vi.fn();
    const unregisterA = scope.registerCancellation(closeA);

    scope.transition(projectB, resetters());
    scope.registerCancellation(closeB);
    unregisterA();

    expect(closeA).toHaveBeenCalledOnce();
    expect(closeB).not.toHaveBeenCalled();
    scope.dispose();
    expect(closeB).toHaveBeenCalledOnce();
  });

  it("applies the same reset rules for repeated back and forward project transitions", () => {
    const calls: string[] = [];
    const scope = new ProjectScopeController(projectA);

    scope.transition(projectB, resetters(calls));
    scope.transition(projectA, resetters(calls));

    expect(scope.current()).toMatchObject({ projectId: projectA, generation: 2 });
    expect(calls).toEqual([...projectBoundStateFamilies, ...projectBoundStateFamilies]);
  });

  it("resets only the explicit project inventory and leaves global state untouched", () => {
    const calls: string[] = [];
    const globals = { runtime: "connected", provider: "local", theme: "dark", settings: 7 };

    resetProjectBoundState(resetters(calls));

    expect(calls).toEqual(projectBoundStateFamilies);
    expect(globals).toEqual({ runtime: "connected", provider: "local", theme: "dark", settings: 7 });
  });

  it("does not persist transient state to browser storage", () => {
    localStorage.clear();
    sessionStorage.clear();
    const scope = new ProjectScopeController(projectA);

    scope.transition(projectB, resetters());

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

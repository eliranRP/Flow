import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { machineProblems } from "@flow/shared";
import { saveFlow } from "./save-flow";
import { useMachine } from "./use-machine";

describe("saveFlow", () => {
  it("is a sound table: every state is reached and has a way out", () => {
    expect(machineProblems(saveFlow)).toEqual([]);
  });

  it("refuses a second start while a save runs", () => {
    expect(saveFlow.can("saving", "start")).toBe(false);
    expect(saveFlow.next("saving", "start")).toBe("saving");
  });

  it("leaves saving on every ending", () => {
    expect(saveFlow.next("saving", "done")).toBe("idle");
    expect(saveFlow.next("saving", "fail")).toBe("failed");
    expect(saveFlow.next("saving", "stop")).toBe("idle");
  });

  it("starts again from a failure, and clears it", () => {
    expect(saveFlow.next("failed", "start")).toBe("saving");
    expect(saveFlow.next("failed", "clear")).toBe("idle");
  });
});

describe("useMachine", () => {
  it("answers two sends in one tick from the machine's own state, not the drawn one", () => {
    const { result } = renderHook(() => useMachine(saveFlow));
    let first = false;
    let second = true;
    act(() => {
      first = result.current.send("start");
      second = result.current.send("start");
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.state).toBe("saving");
  });

  it("draws the state an allowed event leads to, and ignores one that is not allowed", () => {
    const { result } = renderHook(() => useMachine(saveFlow));
    act(() => { result.current.send("done"); });
    expect(result.current.state).toBe("idle");
    act(() => { result.current.send("start"); result.current.send("fail"); });
    expect(result.current.state).toBe("failed");
  });
});

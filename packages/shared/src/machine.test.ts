import { describe, expect, it } from "vitest";
import { defineMachine, machineEdges, machineProblems } from "./machine.ts";

const door = defineMachine({
  name: "door",
  initial: "closed",
  final: ["sealed"],
  states: {
    closed: { open: "opened", seal: "sealed" },
    opened: { close: "closed" },
    sealed: {},
  },
});

describe("defineMachine", () => {
  it("moves on an event the state lists", () => {
    expect(door.next("closed", "open")).toBe("opened");
    expect(door.can("closed", "open")).toBe(true);
  });

  it("stays put on an event the state does not list", () => {
    expect(door.next("opened", "seal")).toBe("opened");
    expect(door.can("opened", "seal")).toBe(false);
    expect(door.next("sealed", "open")).toBe("sealed");
  });

  it("lists its transitions in the order written", () => {
    expect(machineEdges(door)).toEqual([
      { from: "closed", event: "open", to: "opened" },
      { from: "closed", event: "seal", to: "sealed" },
      { from: "opened", event: "close", to: "closed" },
    ]);
  });
});

describe("machineProblems", () => {
  it("finds nothing wrong with a sound table", () => {
    expect(machineProblems(door)).toEqual([]);
  });

  it("names a state nothing reaches", () => {
    // The types refuse a state nothing names, so the test names it for them.
    const machine = defineMachine<"off" | "on" | "broken", "flip" | "fix">({
      name: "lamp",
      initial: "off",
      states: { off: { flip: "on" }, on: { flip: "off" }, broken: { fix: "off" } },
    });
    expect(machineProblems(machine)).toEqual(['lamp: nothing reaches "broken"']);
  });

  it("names a state with no way out that is not final", () => {
    const machine = defineMachine({
      name: "trap",
      initial: "free",
      states: { free: { fall: "stuck" }, stuck: { wait: "stuck" } },
    });
    expect(machineProblems(machine)).toEqual(['trap: "stuck" has no way out and is not final']);
  });

  it("names a final state that has a way out", () => {
    const machine = defineMachine({
      name: "exit",
      initial: "in",
      final: ["out"],
      states: { in: { leave: "out" }, out: { back: "in" } },
    });
    expect(machineProblems(machine)).toEqual(['exit: "out" is final but has a way out']);
  });
});

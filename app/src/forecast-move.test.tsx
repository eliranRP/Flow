import { act, renderHook } from "@testing-library/react";
import { machineProblems } from "@flow/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORECAST_FOLD_MS, forecastMove, useForecastMoves } from "./forecast-move";
import type { ForecastWrite } from "./forecast-month";

// FLOW-1164: a forecast move is written once, whether the fold ends or the screen goes first.

const PRIOR = null;
const MOVE = { moved_out: true };
const UNDO = { reset: true };

/** The fold's own timer is held, so no test depends on real time; `end` runs the ones still held. */
let held: { run: () => void; ms: number; cleared: boolean }[] = [];
const end = () => { act(() => { for (const fold of held) if (!fold.cleared) fold.run(); }); };

type Settled = { onSuccess: () => void; onError: () => void };

function setup() {
  const sent: ForecastWrite[] = [];
  const settled: Settled[] = [];
  const send = vi.fn((write: ForecastWrite, then?: Settled) => {
    sent.push(write);
    if (then != null) settled.push(then);
  });
  const view = renderHook(() => useForecastMoves(send));
  return { sent, settled, view };
}

describe("forecastMove", () => {
  beforeEach(() => {
    held = [];
    const realTimeout = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", ((run: () => void, ms?: number) => {
      if (ms !== FORECAST_FOLD_MS) return realTimeout(run, ms);
      held.push({ run, ms: ms, cleared: false });
      return held.length - 1;
    }));
    const realClear = globalThis.clearTimeout;
    vi.stubGlobal("clearTimeout", ((id: number) => {
      const fold = held[id];
      if (fold == null) realClear(id); else fold.cleared = true;
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a sound table: every state is reached and has a way out or is final", () => {
    expect(machineProblems(forecastMove)).toEqual([]);
  });

  it("sends the write once when the fold ends, and the row stops leaving", () => {
    const { sent, view } = setup();
    act(() => { view.result.current.move("invoice:1", MOVE, PRIOR, false); });
    expect(held.map((fold) => fold.ms)).toEqual([FORECAST_FOLD_MS]);
    expect([...view.result.current.leaving]).toEqual(["invoice:1"]);
    expect(sent).toEqual([]);
    end();
    expect(sent).toEqual([{ key: "invoice:1", patch: MOVE, undo: false, prior: PRIOR }]);
    expect(view.result.current.leaving.size).toBe(0);
    // The screen going later does not send it again.
    view.unmount();
    end();
    expect(sent).toHaveLength(1);
  });

  it("unmount during the fold sends the write once, clears the timer and sets no state afterwards", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sent, view } = setup();
    act(() => { view.result.current.move("invoice:1", MOVE, PRIOR, false); });
    view.unmount();
    expect(sent).toEqual([{ key: "invoice:1", patch: MOVE, undo: false, prior: PRIOR }]);
    expect(held[0]?.cleared).toBe(true);
    // Even a timer that fires anyway sends nothing more.
    end();
    for (const fold of held) fold.run();
    expect(sent).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("unmount before the list is back (the row's page still open) sends the write once", () => {
    const { sent, view } = setup();
    act(() => { view.result.current.move("invoice:1", MOVE, PRIOR, true); });
    expect(held).toEqual([]);
    view.unmount();
    expect(sent).toEqual([{ key: "invoice:1", patch: MOVE, undo: false, prior: PRIOR }]);
  });

  it("waits for the list, then folds and sends once", async () => {
    const { sent, view } = setup();
    act(() => { view.result.current.move("invoice:1", MOVE, PRIOR, true); });
    act(() => { view.result.current.listShown(); });
    await vi.waitFor(() => { expect(held).toHaveLength(1); });
    end();
    expect(sent).toHaveLength(1);
  });

  it("ביטול during the fold sends nothing: the row is back, and the screen going or the timer firing sends nothing either", () => {
    const { sent, view } = setup();
    let cancel: () => void = () => undefined;
    act(() => { cancel = view.result.current.move("invoice:1", MOVE, PRIOR, false).undo; });
    act(() => { cancel(); });
    expect(view.result.current.leaving.size).toBe(0);
    expect(held[0]?.cleared).toBe(true);
    end();
    view.unmount();
    for (const fold of held) fold.run();
    expect(sent).toEqual([]);
  });

  it("ביטול, then the screen going, sends nothing", () => {
    const { sent, view } = setup();
    act(() => { view.result.current.move("invoice:1", MOVE, PRIOR, true).undo(); });
    view.unmount();
    expect(sent).toEqual([]);
  });

  it("ביטול after the write sends the undo once", () => {
    const { sent, view } = setup();
    let cancel: () => void = () => undefined;
    act(() => { cancel = view.result.current.move("invoice:1", MOVE, PRIOR, false).undo; });
    end();
    act(() => { cancel(); cancel(); });
    expect(sent).toEqual([
      { key: "invoice:1", patch: MOVE, undo: false, prior: PRIOR },
      { key: "invoice:1", patch: UNDO, undo: true, prior: PRIOR },
    ]);
  });

  it("ביטול after the write was answered sends the undo once", () => {
    const { sent, settled, view } = setup();
    let cancel: () => void = () => undefined;
    act(() => { cancel = view.result.current.move("invoice:1", MOVE, PRIOR, false).undo; });
    end();
    settled[0]?.onSuccess();
    cancel();
    cancel();
    expect(sent.filter((write) => write.undo)).toHaveLength(1);
  });

  it("a second move tapped during the first: both fold, each is sent once, and ביטול of one leaves the other", () => {
    const { sent, view } = setup();
    let first: () => void = () => undefined;
    act(() => {
      first = view.result.current.move("invoice:1", MOVE, PRIOR, false).undo;
      view.result.current.move("invoice:2", MOVE, PRIOR, false);
    });
    expect([...view.result.current.leaving].sort()).toEqual(["invoice:1", "invoice:2"]);
    act(() => { first(); });
    expect([...view.result.current.leaving]).toEqual(["invoice:2"]);
    end();
    expect(sent.map((write) => write.key)).toEqual(["invoice:2"]);
    view.unmount();
    expect(sent).toHaveLength(1);
  });

  it("two moves still folding when the screen goes are each sent once", () => {
    const { sent, view } = setup();
    act(() => {
      view.result.current.move("invoice:1", MOVE, PRIOR, false);
      view.result.current.move("invoice:2", MOVE, PRIOR, true);
    });
    view.unmount();
    expect(sent.map((write) => write.key).sort()).toEqual(["invoice:1", "invoice:2"]);
  });

  it("a failed write puts the row back and is not sent again; ביטول then still sends the undo once", () => {
    const { sent, settled, view } = setup();
    let cancel: () => void = () => undefined;
    act(() => { cancel = view.result.current.move("invoice:1", MOVE, PRIOR, false).undo; });
    end();
    expect(view.result.current.leaving.size).toBe(0);
    act(() => { settled[0]?.onError(); });
    end();
    expect(sent).toHaveLength(1);
    cancel();
    expect(sent.filter((write) => write.undo)).toHaveLength(1);
  });
});

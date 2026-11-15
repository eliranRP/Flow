import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { machineEdges, machineProblems } from "@flow/shared";
import { ToastProvider, useToast } from "./toast";
import { toastLife, toastTimer } from "./toast-life";

/** FLOW-1167: the toast's phases are one table (`toastLife`); an event out of order does nothing. */

function Probe({ onAction }: { onAction?: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => { toast.show({ message: "הפריט אושר", action: onAction ? "ביטול" : undefined, onAction }); }}>
        הצגה
      </button>
      <button type="button" onClick={() => { toast.dismiss(); }}>
        סגירה
      </button>
    </>
  );
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

function phase() {
  return document.querySelector(".ui-toast-host")?.getAttribute("data-phase");
}

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--motion-toast-out");
});

describe("Toast · a leaving toast", () => {
  it("stays out while its fade's fallback timer fires during the sink (it used to come back to in)", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--motion-toast-out", "400ms");
    render(<ToastProvider><Probe /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    expect(phase()).toBe("fade");
    fireEvent.click(screen.getByRole("status"));
    expect(phase()).toBe("out");
    advance(300);
    expect(phase()).toBe("out");
    advance(200);
    expect(document.querySelector(".ui-toast")).toBeNull();
  });
});

describe("Toast · an action", () => {
  it("runs once when the toast is dismissed during the sink and the action is tapped again (it used to run twice)", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--motion-toast-out", "400ms");
    const acted = vi.fn();
    render(<ToastProvider><Probe onAction={acted} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "הצגה" }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(phase()).toBe("out");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(acted).toHaveBeenCalledTimes(1);
    advance(500);
    expect(document.querySelector(".ui-toast")).toBeNull();
  });
});

type Walk = { name: string; table: typeof toastLife; events: string[]; ends: string };

describe("toastLife", () => {
  it("is a sound table", () => {
    expect(machineProblems(toastLife)).toEqual([]);
    expect(machineProblems(toastTimer)).toEqual([]);
  });

  it("walks the documented paths", () => {
    const walks: Walk[] = [
      { name: "show, timeout, leave, gone", table: toastLife, events: ["show", "fade", "shown", "leave", "cleared"], ends: "off" },
      { name: "show over a sheet: pad first", table: toastLife, events: ["show", "pad", "fade", "shown", "leave", "cleared"], ends: "off" },
      { name: "show, swipe away", table: toastLife, events: ["show", "fade", "shown", "leave", "cleared"], ends: "off" },
      { name: "replaced while shown: keeps its phase, then moves again", table: toastLife, events: ["show", "fade", "shown", "replace", "pad", "shown", "leave", "cleared"], ends: "off" },
      { name: "replaced while leaving: a fresh measure", table: toastLife, events: ["show", "fade", "shown", "leave", "show", "fade", "shown"], ends: "in" },
      { name: "show, action, done", table: toastLife, events: ["show", "fade", "shown", "act", "cleared"], ends: "off" },
    ];
    for (const walk of walks) {
      let state: string = walk.table.initial;
      for (const event of walk.events) {
        expect(walk.table.can(state as never, event as never), `${walk.name}: ${event} from ${state}`).toBe(true);
        state = walk.table.next(state as never, event as never);
      }
      expect(state, walk.name).toBe(walk.ends);
    }
    // Show, press, release, timeout: the timer pauses and resumes while the phase stays shown.
    const steps: [string, string][] = [["arm", "running"], ["pause", "paused"], ["resume", "running"], ["stop", "idle"]];
    let timer: string = toastTimer.initial;
    for (const [event, to] of steps) {
      expect(toastTimer.can(timer as never, event as never), event).toBe(true);
      timer = toastTimer.next(timer as never, event as never);
      expect(timer).toBe(to);
    }
  });

  it("does nothing for an event out of order", () => {
    expect(toastLife.next("out", "leave")).toBe("out");
    expect(toastLife.next("out", "act")).toBe("out");
    expect(toastLife.next("out", "shown")).toBe("out");
    expect(toastLife.next("out", "fade")).toBe("out");
    expect(toastLife.next("out", "pad")).toBe("out");
    expect(toastLife.next("out", "replace")).toBe("out");
    expect(toastLife.next("off", "leave")).toBe("off");
    expect(toastLife.next("off", "act")).toBe("off");
    expect(toastLife.next("off", "cleared")).toBe("off");
    expect(toastLife.next("in", "cleared")).toBe("in");
    expect(toastLife.next("in", "fade")).toBe("in");
    expect(toastLife.next("in", "show")).toBe("in");
    expect(toastLife.next("measure", "shown")).toBe("measure");
    expect(toastTimer.next("idle", "pause")).toBe("idle");
    expect(toastTimer.next("idle", "resume")).toBe("idle");
    expect(toastTimer.next("running", "resume")).toBe("running");
    expect(toastTimer.next("paused", "pause")).toBe("paused");
    // Every edge of a table ends in a state that table has.
    for (const edge of [...machineEdges(toastLife), ...machineEdges(toastTimer)]) expect(edge.to).toBeTruthy();
  });
});

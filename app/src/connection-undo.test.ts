import { afterEach, describe, expect, it, vi } from "vitest";
import { holdForUndo, UNDONE } from "./connection-undo";
import { TOP_UNDO_MS } from "./ui/top-toast";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("holdForUndo (decision 0223)", () => {
  it("lets the write through once the 5s run out, and a late ביטול does nothing", async () => {
    vi.useFakeTimers();
    const hold = holdForUndo();
    let through = false;
    void hold.done.then(() => { through = true; });
    await vi.advanceTimersByTimeAsync(TOP_UNDO_MS - 1);
    expect(through).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(through).toBe(true);
    expect(hold.cancel()).toBe(false);
  });

  it("stops the write on ביטול within the 5s", async () => {
    vi.useFakeTimers();
    const hold = holdForUndo();
    expect(hold.cancel()).toBe(true);
    await expect(hold.done).rejects.toThrow(UNDONE);
    // A second tap, or the timer, changes nothing.
    expect(hold.cancel()).toBe(false);
    await vi.advanceTimersByTimeAsync(TOP_UNDO_MS);
  });

  it("lets the write through at once when the app is left, since nobody can tap ביטול any more", async () => {
    vi.useFakeTimers();
    const hold = holdForUndo();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await expect(hold.done).resolves.toBeUndefined();
    expect(hold.cancel()).toBe(false);
  });
});

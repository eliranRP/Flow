import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_UNDO_MS, connectionToast, holdForUndo, UNDONE } from "./connection-toast";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("connectionToast (decision 0223)", () => {
  it("puts every toast under the header: an undo for 5s, a note for 4s", () => {
    expect(connectionToast({ message: "נותק", action: "ביטול" })).toMatchObject({ place: "top", durationMs: 5000 });
    expect(connectionToast({ message: "הועתק" })).toMatchObject({ place: "top", durationMs: 4000 });
  });
});

describe("holdForUndo (decision 0223)", () => {
  it("lets the write through once the 5s run out, and a late ביטול does nothing", async () => {
    vi.useFakeTimers();
    const hold = holdForUndo();
    let through = false;
    void hold.done.then(() => { through = true; });
    await vi.advanceTimersByTimeAsync(CONNECTION_UNDO_MS - 1);
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
    await vi.advanceTimersByTimeAsync(CONNECTION_UNDO_MS);
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

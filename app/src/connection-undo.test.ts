import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelDisconnects,
  flushDisconnects,
  REPLAY_MS,
  replayDisconnects,
  resetDisconnectsForTests,
  startDisconnect,
  type DisconnectJob,
} from "./connection-undo";

const STORAGE_KEY = "flow.pending-disconnects";

function job(partial: Partial<DisconnectJob> = {}): DisconnectJob & { send: ReturnType<typeof vi.fn> } {
  return { provider: "mercury", slot: 1, companyId: "c1", send: vi.fn(() => Promise.resolve()), ...partial } as DisconnectJob & { send: ReturnType<typeof vi.fn> };
}

function hide() {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
}

afterEach(() => {
  resetDisconnectsForTests();
  vi.useRealTimers();
});

describe("a disconnect's wait (decision 0223)", () => {
  it("sends nothing until the wait ends, and once when it does", async () => {
    const one = job();
    const hold = startDisconnect(one);
    expect(one.send).not.toHaveBeenCalled();
    await Promise.all([hold.end(), hold.end()]);
    expect(one.send).toHaveBeenCalledTimes(1);
    // ביטול after it went out does nothing, and says so.
    expect(hold.cancel()).toBe(false);
  });

  it("sends nothing after ביטול", async () => {
    const one = job();
    const hold = startDisconnect(one);
    expect(hold.cancel()).toBe(true);
    await hold.end();
    expect(one.send).not.toHaveBeenCalled();
  });

  it("has no timer of its own: it waits as long as its toast is on screen", async () => {
    vi.useFakeTimers();
    const one = job();
    startDisconnect(one);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(one.send).not.toHaveBeenCalled();
  });

  it("sends every wait at once when the app is left, and tells the page so it can take the toast away", async () => {
    const one = job();
    const two = job({ provider: "sumit", slot: 0 });
    const ended = vi.fn();
    startDisconnect(one).onEnd(ended);
    startDisconnect(two);
    hide();
    await vi.waitFor(() => { expect(one.send).toHaveBeenCalledTimes(1); });
    expect(two.send).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("flushes a provider's waits before a new key, and waits for them", async () => {
    let done = false;
    const one = job({ send: vi.fn(() => new Promise<void>((resolve) => { setTimeout(() => { done = true; resolve(); }, 5); })) });
    const other = job({ provider: "sumit", slot: 0 });
    startDisconnect(one);
    startDisconnect(other);
    await flushDisconnects("mercury");
    expect(done).toBe(true);
    expect(other.send).not.toHaveBeenCalled();
  });

  it("drops a provider's waits without sending when the owner becomes a viewer", async () => {
    const one = job();
    const hold = startDisconnect(one);
    cancelDisconnects("mercury");
    await hold.end();
    expect(one.send).not.toHaveBeenCalled();
  });

  it("calls onFailed when the disconnect fails, and the connection is no longer leaving", async () => {
    const onFailed = vi.fn();
    const one = job({ send: vi.fn(() => Promise.reject(new Error("down"))), onFailed });
    await startDisconnect(one).end();
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "down" }) as unknown);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("a disconnect a reload left waiting (decision 0223)", () => {
  it("is saved while it waits and cleared once it settles", async () => {
    const hold = startDisconnect(job());
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([expect.objectContaining({ provider: "mercury", slot: 1, companyId: "c1" })]);
    await hold.end();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is sent on the next start when fresh and for this company; a stale one is dropped", () => {
    const now = Date.now();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { provider: "mercury", slot: 2, companyId: "c1", at: now - 1000 },
      { provider: "sumit", slot: 0, companyId: "c1", at: now - REPLAY_MS - 1 },
      { provider: "sumit", slot: 0, companyId: "c2", at: now - 1000 },
    ]));
    const send = vi.fn(() => Promise.resolve());
    replayDisconnects("c1", send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("mercury", 2);
    // Another company's fresh one stays for that company.
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([expect.objectContaining({ companyId: "c2" })]);
  });

  it("works with storage off", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => { replayDisconnects("c1", vi.fn(() => Promise.resolve())); }).not.toThrow();
    get.mockRestore();
  });
});

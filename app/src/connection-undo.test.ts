import { afterEach, describe, expect, it, vi } from "vitest";
import { resetShownCompanyForTests, setShownCompany } from "./lib/company-header";
import { dropDisconnects, flushDisconnects, resetDisconnectsForTests, startDisconnect, type DisconnectJob } from "./connection-undo";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";

type TestJob = DisconnectJob & { send: ReturnType<typeof vi.fn<() => Promise<void>>> };

function job(partial: Partial<DisconnectJob> = {}): TestJob {
  return { provider: "mercury", slot: 1, send: vi.fn(() => Promise.resolve()), ...partial } as TestJob;
}

function hide() {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
}

afterEach(() => {
  resetDisconnectsForTests();
  resetShownCompanyForTests();
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

  it("drops waits without sending, and their toasts go (a role that cannot disconnect)", async () => {
    const one = job();
    const ended = vi.fn();
    const hold = startDisconnect(one);
    hold.onEnd(ended);
    expect(dropDisconnects("mercury")).toBe(1);
    expect(ended).toHaveBeenCalledTimes(1);
    await hold.end();
    expect(one.send).not.toHaveBeenCalled();
  });

  it("draws the connection gone before it stops being leaving, so it does not flicker back", async () => {
    const order: string[] = [];
    const one = job({ onSent: () => { order.push("drawn"); } });
    const hold = startDisconnect(one);
    await hold.end();
    order.push("settled");
    expect(order).toEqual(["drawn", "settled"]);
  });

  it("calls onFailed when the disconnect fails", async () => {
    const onFailed = vi.fn();
    const one = job({ send: vi.fn(() => Promise.reject(new Error("down"))), onFailed });
    await startDisconnect(one).end();
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "down" }) as unknown);
  });
});

describe("a wait and the company it belongs to (decision 0223)", () => {
  it("sends nothing, and says so, when the app shows another company by the time it ends", async () => {
    setShownCompany("user-1", COMPANY_A);
    const onRefused = vi.fn();
    const ended = vi.fn();
    const one = job({ onRefused });
    const hold = startDisconnect(one);
    hold.onEnd(ended);
    setShownCompany("user-1", COMPANY_B);
    await hold.end();
    expect(one.send).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the header is dropped for a new company (+ עסק חדש) before the wait ends", async () => {
    setShownCompany("user-1", COMPANY_A);
    const onRefused = vi.fn();
    const one = job({ onRefused });
    const hold = startDisconnect(one);
    setShownCompany("user-1", null);
    await hold.end();
    expect(one.send).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it("sends when the app still shows the company of the tap", async () => {
    setShownCompany("user-1", COMPANY_A);
    const one = job();
    await startDisconnect(one).end();
    expect(one.send).toHaveBeenCalledTimes(1);
  });
});

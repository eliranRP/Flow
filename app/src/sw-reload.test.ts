import { afterEach, describe, expect, it, vi } from "vitest";
import { busy, LOOP_MS, RELOADED_KEY, RETRY_MS, watchServiceWorker } from "./sw-reload";

function fakeWindow({ controller = true } = {}) {
  const sw = new EventTarget() as EventTarget & { controller: object | null; getRegistration: () => Promise<{ update: () => Promise<void> } | undefined> };
  sw.controller = controller ? {} : null;
  const update = vi.fn(() => Promise.resolve());
  sw.getRegistration = () => Promise.resolve({ update });
  const reload = vi.fn();
  let visibility: DocumentVisibilityState = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  const win = {
    navigator: { serviceWorker: sw },
    document,
    location: { reload },
    sessionStorage: window.sessionStorage,
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
  } as unknown as Window;
  let clock = 100_000;
  const now = () => clock;
  return {
    win,
    now,
    reload,
    update,
    takeControl: () => sw.dispatchEvent(new Event("controllerchange")),
    setVisibility: (state: DocumentVisibilityState) => {
      visibility = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe("FLOW-910: a new service worker reloads the open tab once", () => {
  it("reloads when a new worker replaces the one that served the page", () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOADED_KEY)).toBe(String(tab.now()));
  });

  it("keeps the page on a first install: it already runs the new bundle", () => {
    const tab = fakeWindow({ controller: false });
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    expect(tab.reload).not.toHaveBeenCalled();
    // A later deploy reloads.
    tab.takeControl();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads twice within the loop window", () => {
    const tab = fakeWindow();
    window.sessionStorage.setItem(RELOADED_KEY, String(tab.now() - LOOP_MS + 1));
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("waits while a sheet is open, then reloads once it closes", () => {
    vi.useFakeTimers();
    const tab = fakeWindow();
    document.body.innerHTML = '<div role="dialog"><input /></div>';
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    expect(tab.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RETRY_MS * 3);
    expect(tab.reload).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    vi.advanceTimersByTime(RETRY_MS);
    expect(tab.reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RETRY_MS * 3);
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads a busy page when it goes to the background", () => {
    const tab = fakeWindow();
    document.body.innerHTML = '<input id="amount" />';
    document.getElementById("amount")?.focus();
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    expect(tab.reload).not.toHaveBeenCalled();
    tab.setVisibility("hidden");
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("asks for an update when the app comes back to the front", async () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.setVisibility("hidden");
    tab.setVisibility("visible");
    await Promise.resolve();
    await Promise.resolve();
    expect(tab.update).toHaveBeenCalledTimes(1);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("does nothing without service workers", () => {
    const reload = vi.fn();
    watchServiceWorker({ navigator: {}, document, location: { reload } } as unknown as Window);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("busy", () => {
  it("is true for an open sheet or a focused field, false otherwise", () => {
    expect(busy(document)).toBe(false);
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(busy(document)).toBe(true);
    document.body.innerHTML = "<textarea></textarea>";
    document.querySelector("textarea")?.focus();
    expect(busy(document)).toBe(true);
    document.body.innerHTML = "<button>x</button>";
    document.querySelector("button")?.focus();
    expect(busy(document)).toBe(false);
  });
});

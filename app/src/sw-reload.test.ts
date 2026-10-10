import { afterEach, describe, expect, it, vi } from "vitest";
import { busy, LOOP_MS, RELOADED_KEY, watchServiceWorker } from "./sw-reload";

function fakeWindow({ controller = true } = {}) {
  const sw = new EventTarget() as EventTarget & { controller: object | null; getRegistration: () => Promise<{ update: () => Promise<void> } | undefined> };
  sw.controller = controller ? {} : null;
  const update = vi.fn(() => Promise.resolve());
  sw.getRegistration = () => Promise.resolve({ update });
  const reload = vi.fn();
  let visibility: DocumentVisibilityState = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  const target = new EventTarget();
  const pushed: unknown[] = [];
  const history = { pushState: (_state: unknown, _unused: string, url?: string | URL | null) => pushed.push(url) };
  const win = {
    navigator: { serviceWorker: sw },
    document,
    location: { reload },
    sessionStorage: window.sessionStorage,
    history,
    addEventListener: target.addEventListener.bind(target),
  } as unknown as Window;
  const clock = 100_000;
  const now = () => clock;
  return {
    win,
    now,
    reload,
    update,
    pushed,
    takeControl: () => sw.dispatchEvent(new Event("controllerchange")),
    navigate: (url: string) => {
      win.history.pushState(null, "", url);
    },
    back: () => target.dispatchEvent(new Event("popstate")),
    setVisibility: (state: DocumentVisibilityState) => {
      visibility = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  window.sessionStorage.clear();
});

describe("FLOW-910, FLOW-426: a new service worker reloads the open tab once, never under the user", () => {
  it("keeps an idle page in front, then reloads on the next move to another screen", () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    expect(tab.reload).not.toHaveBeenCalled();
    tab.navigate("/projects");
    expect(tab.pushed).toEqual(["/projects"]);
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOADED_KEY)).toBe(String(tab.now()));
    tab.navigate("/settings");
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on Back", () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    tab.back();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when the app goes to the background", () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    tab.setVisibility("hidden");
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads at once when the new worker arrives while the app is in the background", () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.setVisibility("hidden");
    tab.takeControl();
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the page on a first install: it already runs the new bundle", () => {
    const tab = fakeWindow({ controller: false });
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    tab.navigate("/projects");
    expect(tab.reload).not.toHaveBeenCalled();
    // A later deploy reloads.
    tab.takeControl();
    tab.navigate("/settings");
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads twice within the loop window", () => {
    const tab = fakeWindow();
    window.sessionStorage.setItem(RELOADED_KEY, String(tab.now() - LOOP_MS + 1));
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    tab.navigate("/projects");
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("waits while a sheet is open or a field has focus, then reloads on the next move", () => {
    const tab = fakeWindow();
    document.body.innerHTML = '<div role="dialog"></div>';
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    tab.navigate("/projects");
    tab.setVisibility("hidden");
    expect(tab.reload).not.toHaveBeenCalled();
    document.body.innerHTML = '<input id="amount" />';
    document.getElementById("amount")?.focus();
    tab.setVisibility("visible");
    tab.navigate("/settings");
    expect(tab.reload).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    tab.navigate("/");
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

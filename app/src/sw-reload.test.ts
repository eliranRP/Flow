import { afterEach, describe, expect, it, vi } from "vitest";
import { BEHIND_KEY, busy, LOOP_MS, pageBuild, RELOADED_KEY, watchServiceWorker } from "./sw-reload";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

type Registration = { update: () => Promise<void>; installing: object | null; waiting: object | null };

function fakeWindow({ controller = true, live = null as string | null, liveStatus = 200 } = {}) {
  const sw = new EventTarget() as EventTarget & { controller: object | null; getRegistration: () => Promise<Registration | undefined> };
  sw.controller = controller ? {} : null;
  const update = vi.fn(() => Promise.resolve());
  const registration: Registration = { update, installing: null, waiting: null };
  sw.getRegistration = () => Promise.resolve(registration);
  const fetch = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(live ?? "", { status: liveStatus })));
  const reload = vi.fn();
  let visibility: DocumentVisibilityState = "visible";
  // Each tab hears its own visibility events: a watch left from an earlier test must not reload.
  const visibilityEvents = new EventTarget();
  const doc = new Proxy(document, {
    get(target, key) {
      if (key === "visibilityState") return visibility;
      if (key === "addEventListener") return visibilityEvents.addEventListener.bind(visibilityEvents);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const target = new EventTarget();
  const pushed: unknown[] = [];
  const location = { reload, pathname: "/" };
  const moveTo = (url: string) => {
    location.pathname = new URL(url, "https://flow.test").pathname;
  };
  const history = {
    pushState: (_state: unknown, _unused: string, url?: string | null) => {
      pushed.push(url);
      if (url != null) moveTo(url);
    },
  };
  const win = {
    navigator: { serviceWorker: sw },
    document: doc,
    location,
    sessionStorage: window.sessionStorage,
    localStorage: window.localStorage,
    history,
    fetch,
    addEventListener: target.addEventListener.bind(target),
  } as unknown as Window;
  const clock = 100_000;
  const now = () => clock;
  return {
    win,
    now,
    reload,
    update,
    fetch,
    registration,
    pushed,
    takeControl: () => sw.dispatchEvent(new Event("controllerchange")),
    navigate: (url: string) => {
      win.history.pushState(null, "", url);
    },
    back: (url: string) => {
      moveTo(url);
      target.dispatchEvent(new Event("popstate"));
    },
    setVisibility: (state: DocumentVisibilityState) => {
      visibility = state;
      visibilityEvents.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

/** Lets the watch's update and build checks settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function stampPage(sha: string) {
  document.head.innerHTML = `<meta name="flow-build" content="${sha}" />`;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  window.localStorage.clear();
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

  it("keeps the page when a push stays on the same screen: a sheet or a query", () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    tab.navigate("/?sheet=add");
    tab.navigate("/?period=2026-09");
    tab.back("/");
    expect(tab.reload).not.toHaveBeenCalled();
    tab.navigate("/projects");
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on Back", () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    tab.takeControl();
    tab.back("/projects");
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

  it("asks for an update when it starts and each time the app comes back to the front", async () => {
    const tab = fakeWindow();
    watchServiceWorker(tab.win, tab.now);
    await settle();
    expect(tab.update).toHaveBeenCalledTimes(1);
    tab.setVisibility("hidden");
    tab.setVisibility("visible");
    await settle();
    expect(tab.update).toHaveBeenCalledTimes(2);
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("does nothing without service workers", () => {
    const reload = vi.fn();
    watchServiceWorker({ navigator: {}, document, location: { reload } } as unknown as Window);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("iPhone app: a page behind the live build reloads even when it missed the worker's takeover", () => {
  it("reloads on the next move when the live build is newer and no worker is on its way", async () => {
    stampPage(OLD);
    const tab = fakeWindow({ live: `${NEW}\n` });
    watchServiceWorker(tab.win, tab.now);
    await settle();
    expect(tab.fetch).toHaveBeenCalledWith("/build.txt", { cache: "no-store" });
    expect(tab.reload).not.toHaveBeenCalled();
    tab.navigate("/projects");
    expect(tab.reload).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(BEHIND_KEY)).toBe(NEW);
  });

  it("checks again when the app comes back to the front, and reloads when it goes to the background", async () => {
    stampPage(OLD);
    const tab = fakeWindow({ live: OLD });
    watchServiceWorker(tab.win, tab.now);
    await settle();
    tab.setVisibility("hidden");
    expect(tab.reload).not.toHaveBeenCalled();
    // A deploy lands while the app sleeps; iOS resumes the page instead of loading it again.
    tab.fetch.mockImplementation(() => Promise.resolve(new Response(NEW)));
    tab.setVisibility("visible");
    await settle();
    expect(tab.reload).not.toHaveBeenCalled();
    tab.setVisibility("hidden");
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("waits for a worker still installing: its takeover marks the reload", async () => {
    stampPage(OLD);
    const tab = fakeWindow({ live: NEW });
    tab.registration.installing = {};
    watchServiceWorker(tab.win, tab.now);
    await settle();
    expect(tab.fetch).not.toHaveBeenCalled();
    tab.navigate("/projects");
    expect(tab.reload).not.toHaveBeenCalled();
    tab.takeControl();
    tab.navigate("/settings");
    expect(tab.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once per live build, so a deploy with no app change can't reload it again", async () => {
    stampPage(OLD);
    window.localStorage.setItem(BEHIND_KEY, NEW);
    const tab = fakeWindow({ live: NEW });
    watchServiceWorker(tab.win, tab.now);
    await settle();
    tab.navigate("/projects");
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it("keeps the page when it runs the live build, or there is none to compare", async () => {
    for (const [page, live, liveStatus] of [[NEW, NEW, 200], [OLD, null, 404], [OLD, "<!doctype html>", 200]] as const) {
      stampPage(page);
      const tab = fakeWindow({ live, liveStatus });
      watchServiceWorker(tab.win, tab.now);
      await settle();
      tab.navigate(`/projects/${page}`);
      expect(tab.reload).not.toHaveBeenCalled();
    }
    // A local build has no stamp.
    document.head.innerHTML = "";
    const tab = fakeWindow({ live: NEW });
    watchServiceWorker(tab.win, tab.now);
    await settle();
    expect(tab.fetch).not.toHaveBeenCalled();
  });
});

describe("pageBuild", () => {
  it("reads the stamped build, or null without one", () => {
    expect(pageBuild(document)).toBeNull();
    stampPage(NEW);
    expect(pageBuild(document)).toBe(NEW);
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

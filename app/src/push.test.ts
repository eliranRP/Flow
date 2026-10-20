import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FLOW-516: this device's push state and every way a turn-on can stop, with the browser mocked.

const rpc = vi.fn();
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (...args: unknown[]) => rpc(...args) as unknown,
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "user-1" } } } }) },
  }),
}));

const { errorDetail, forgetThisDevice, readDevicePush, subscribeThisDevice, useDevicePushQuery } = await import("./push");
const { pushOwner, notePushOwner } = await import("./push-owner");

/** A 65-byte key of 4s, base64url, as the build carries it. */
const KEY_BYTES = new Uint8Array(65).fill(4);
const KEY = btoa(String.fromCharCode(...KEY_BYTES)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const OLD_KEY = new Uint8Array(65).fill(9).buffer;
const ENDPOINT = "https://web.push.apple.com/example-device";
const FAST = { permission: 200, worker: 20, controller: 10, lookup: 20, unsubscribe: 20, subscribe: 20, retryPause: 5, save: 20 };
const never = <T>() => new Promise<T>(() => undefined);

function subscription(key: ArrayBuffer | null = KEY_BYTES.buffer, unsubscribe: () => Promise<boolean> = () => Promise.resolve(true)) {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: key },
    unsubscribe: vi.fn(unsubscribe),
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }),
  };
}

type Browser = {
  permission?: NotificationPermission;
  request?: () => Promise<NotificationPermission>;
  ready?: Promise<unknown>;
  getSubscription?: () => Promise<unknown>;
  subscribe?: () => Promise<unknown>;
  controller?: object | null;
};

function browser(options: Browser = {}) {
  const pushManager = {
    getSubscription: vi.fn(options.getSubscription ?? (() => Promise.resolve(null))),
    subscribe: vi.fn(options.subscribe ?? (() => Promise.resolve(subscription()))),
  };
  const registration = { pushManager };
  const requestPermission = vi.fn(options.request ?? (() => Promise.resolve("granted" as NotificationPermission)));
  vi.stubGlobal("Notification", { permission: options.permission ?? "granted", requestPermission });
  Object.defineProperty(window, "PushManager", { value: function PushManager() { /* present */ }, configurable: true });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: options.ready ?? Promise.resolve(registration),
      controller: options.controller === undefined ? {} : options.controller,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getRegistration: () => Promise.resolve(registration),
    },
  });
  return { pushManager, requestPermission };
}

beforeEach(() => {
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", KEY);
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  notePushOwner(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
});

describe("readDevicePush", () => {
  it("is subscribed only with permission and a subscription made with this build's key", async () => {
    browser({ getSubscription: () => Promise.resolve(subscription()) });
    const info = await readDevicePush();
    expect(info.state).toBe("subscribed");
    expect(info.tag).toMatch(/^[0-9a-f]{16}$/);
  });

  it("reads denied, no subscription, an old key and a worker that never gets ready", async () => {
    browser({ permission: "denied" });
    expect((await readDevicePush()).state).toBe("denied");
    browser();
    expect((await readDevicePush()).state).toBe("not-subscribed");
    browser({ getSubscription: () => Promise.resolve(subscription(OLD_KEY)) });
    expect((await readDevicePush()).state).toBe("not-subscribed");
    browser({ ready: never() });
    expect((await readDevicePush(20)).state).toBe("no-worker");
    browser({ ready: Promise.resolve({ pushManager: { getSubscription: () => never() } }) });
    expect((await readDevicePush(20)).state).toBe("not-subscribed");
  });

  it("honours pushSupport: no key means not-configured", async () => {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
    browser();
    expect(await readDevicePush()).toEqual({ state: "not-configured", tag: null });
  });
});

describe("useDevicePushQuery", () => {
  // FLOW-936: a state read before the worker took control, or before a change in the iOS Settings
  // app, stayed on screen until the app was opened again.
  function watch() {
    let current: unknown = null;
    browser({ getSubscription: () => Promise.resolve(current) });
    const events = new EventTarget();
    Object.assign(navigator.serviceWorker, {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const view = renderHook(() => useDevicePushQuery(true), { wrapper });
    return { view, events, subscribe: () => { current = subscription(); } };
  }

  it("reads this device again when the service worker takes control", async () => {
    const { view, events, subscribe } = watch();
    await waitFor(() => { expect(view.result.current.data?.state).toBe("not-subscribed"); });
    subscribe();
    act(() => { events.dispatchEvent(new Event("controllerchange")); });
    await waitFor(() => { expect(view.result.current.data?.state).toBe("subscribed"); });
  });

  it("reads this device again when the app comes back to the front, and stops listening when it unmounts", async () => {
    const { view, subscribe } = watch();
    await waitFor(() => { expect(view.result.current.data?.state).toBe("not-subscribed"); });
    subscribe();
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(view.result.current.data?.state).toBe("subscribed"); });
    const remove = vi.spyOn(document, "removeEventListener");
    view.unmount();
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});

describe("subscribeThisDevice", () => {
  it("asks for permission in the same task as the tap, then saves the device and its owner", async () => {
    const { requestPermission } = browser();
    const pending = subscribeThisDevice(FAST);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ result: "ok", step: "done" });
    expect(rpc).toHaveBeenCalledWith("push_subscribe", expect.objectContaining({ p_endpoint: ENDPOINT }));
    await vi.waitFor(() => { expect(pushOwner()).toBe("user-1"); });
  });

  it("keeps a subscription made with this key instead of subscribing again", async () => {
    const { pushManager } = browser({ getSubscription: () => Promise.resolve(subscription()) });
    expect((await subscribeThisDevice(FAST)).result).toBe("ok");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("says denied, dismissed and a permission prompt that never answers apart", async () => {
    browser({ request: () => Promise.resolve("denied") });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "denied", step: "permission" });
    browser({ request: () => Promise.resolve("default") });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "dismissed", step: "permission" });
    browser({ request: () => never() });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "permission-timeout", step: "permission" });
  });

  it("times out a worker that never gets ready", async () => {
    browser({ ready: never() });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "worker-timeout", step: "worker" });
  });

  it("times out or names the error of the subscription lookup", async () => {
    browser({ getSubscription: () => never() });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "lookup-timeout", step: "lookup" });
    browser({ getSubscription: () => Promise.reject(new DOMException("The operation is insecure.", "SecurityError")) });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "lookup-threw", step: "lookup", detail: "SecurityError: The operation is insecure." });
  });

  it("times out a subscribe that never answers, and names the browser's error when it throws", async () => {
    browser({ subscribe: () => never() });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "subscribe-timeout", step: "subscribe" });
    browser({ subscribe: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")) });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "subscribe-threw", step: "subscribe", detail: "NotAllowedError: Permission denied" });
    browser({ subscribe: () => Promise.reject(new DOMException("Bad key", "InvalidAccessError")) });
    expect((await subscribeThisDevice(FAST)).detail).toBe("InvalidAccessError: Bad key");
  });

  it("says the page must be reopened when the worker does not control it and subscribe fails", async () => {
    browser({ controller: null, subscribe: () => never() });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "not-controlled", step: "subscribe" });
  });

  it("with an old key's subscription, subscribes fresh; on InvalidStateError it unsubscribes, pauses and tries once more", async () => {
    const old = subscription(OLD_KEY);
    let calls = 0;
    const { pushManager } = browser({
      getSubscription: () => Promise.resolve(old),
      subscribe: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new DOMException("A subscription with a different key exists", "InvalidStateError")) : Promise.resolve(subscription());
      },
    });
    expect((await subscribeThisDevice(FAST)).result).toBe("ok");
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(2);
  });

  it("retries on AbortError too, and names a retry that throws again", async () => {
    browser({
      getSubscription: () => Promise.resolve(subscription(OLD_KEY)),
      subscribe: () => Promise.reject(new DOMException("Registration failed", "AbortError")),
    });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "subscribe-threw", step: "subscribe", detail: "AbortError: Registration failed" });
  });

  it("times out an old subscription that never unsubscribes", async () => {
    browser({
      getSubscription: () => Promise.resolve(subscription(OLD_KEY, () => never())),
      subscribe: () => Promise.reject(new DOMException("exists", "InvalidStateError")),
    });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "unsubscribe-timeout", step: "unsubscribe", detail: "InvalidStateError: exists" });
  });

  it("times out or names a save that does not reach the server", async () => {
    browser();
    rpc.mockReturnValue(never());
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "save-timeout", step: "save" });
    rpc.mockResolvedValue({ data: null, error: { message: "invalid endpoint", code: "22023" } });
    expect(await subscribeThisDevice(FAST)).toEqual({ result: "save-failed", step: "save", detail: "Error: invalid endpoint" });
  });

  it("always settles: an outer limit backs every step", async () => {
    browser({ request: () => never() });
    expect(await subscribeThisDevice({ ...FAST, permission: 10_000 }, 30)).toEqual({ result: "subscribe-timeout", step: "subscribe", detail: "no answer" });
  });
});

describe("forgetThisDevice and errorDetail", () => {
  it("on an explicit sign-out removes the server row, then the browser's subscription and its owner", async () => {
    const current = subscription();
    browser({ getSubscription: () => Promise.resolve(current) });
    notePushOwner("user-1");
    await forgetThisDevice({ server: true });
    expect(rpc).toHaveBeenCalledWith("push_unsubscribe", { p_endpoint: ENDPOINT });
    expect(current.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushOwner()).toBeNull();
  });

  it("on a user switch drops the subscription without a server call", async () => {
    const current = subscription();
    browser({ getSubscription: () => Promise.resolve(current) });
    await forgetThisDevice();
    expect(rpc).not.toHaveBeenCalled();
    expect(current.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps the error name and a short message, without a URL", () => {
    expect(errorDetail(new DOMException(`failed for ${ENDPOINT} now`, "AbortError"))).toBe("AbortError: failed for <url> now");
    expect(errorDetail("x".repeat(300)).length).toBe(100);
  });
});

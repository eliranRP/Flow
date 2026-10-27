import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getSupabase } from "./lib/supabase";
import { notePushOwner } from "./push-owner";
import { detectInstallMode, isStandalone } from "./ui/install-prompt";

/**
 * FLOW-502 (option A): web push. The browser asks for permission only after a tap; iOS can
 * receive push only from the app on the Home Screen. The server keeps one subscription per
 * device and the three switches per user (`get_notification_prefs`, decision in #324).
 */
export type NotificationPrefs = {
  new_transaction: boolean;
  evening_reminder: boolean;
  weekly_summary: boolean;
  /** The review screen's "תזכורת בערב" card was answered, so it is asked once. */
  prompt_answered: boolean;
  /** At least one of this user's devices is subscribed (any device, not only this one). */
};

export type NotificationPrefKey = "new_transaction" | "evening_reminder" | "weekly_summary";

export const NO_PREFS: NotificationPrefs = {
  new_transaction: false,
  evening_reminder: false,
  weekly_summary: false,
  prompt_answered: false,
};

/**
 * ok: this browser can subscribe. ios-home-screen: an iPhone or iPad tab, which must be installed
 * first. not-configured: this build has no VAPID key, so nothing about push shows at all.
 */
export type PushSupport = "ok" | "ios-home-screen" | "unsupported" | "not-configured";

export const PUSH_PREFS_KEY = ["notification-prefs"] as const;

function vapidKey(): string {
  return (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() ?? "";
}

/** False until the build carries the public VAPID key: the row, the page and the card stay hidden. */
export function pushConfigured(): boolean {
  return vapidKey() !== "";
}

/** An iPhone or iPad: permission is changed in the iOS Settings app, not in a browser menu. */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const mode = detectInstallMode();
  return mode === "iphone" || mode === "iphone-other" || mode === "ipad";
}

export function pushSupport(): PushSupport {
  if (!pushConfigured()) return "not-configured";
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  if (isIosDevice() && !isStandalone()) return "ios-home-screen";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

function db() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  return supabase;
}

async function result(call: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<unknown> {
  const { data, error } = await call;
  if (error) throw Object.assign(new Error(error.message), error.code ? { code: error.code } : {});
  return data;
}

export function prefsFromData(data: unknown): NotificationPrefs {
  if (data == null || typeof data !== "object") throw new Error("validation");
  const row = data as Record<string, unknown>;
  const flag = (key: keyof NotificationPrefs) => row[key] === true;
  return {
    new_transaction: flag("new_transaction"),
    evening_reminder: flag("evening_reminder"),
    weekly_summary: flag("weekly_summary"),
    prompt_answered: flag("prompt_answered"),
  };
}

export async function readNotificationPrefs(): Promise<NotificationPrefs> {
  return prefsFromData(await result(db().rpc("get_notification_prefs")));
}

export function useNotificationPrefsQuery(enabled: boolean) {
  return useQuery({ queryKey: PUSH_PREFS_KEY, enabled, retry: false, queryFn: readNotificationPrefs });
}

/** A switch left out stays as it is. Returns the stored prefs. */
export async function saveNotificationPrefs(change: Partial<Record<NotificationPrefKey, boolean>>): Promise<NotificationPrefs> {
  return prefsFromData(await result(db().rpc("set_notification_prefs", {
    p_new_transaction: change.new_transaction,
    p_evening_reminder: change.evening_reminder,
    p_weekly_summary: change.weekly_summary,
  })));
}

/** Records the review card's answer, so it is asked once. Yes also turns on the evening reminder, and a first yes turns on תנועה חדשה. */
export async function answerPushPrompt(yes: boolean): Promise<NotificationPrefs> {
  return prefsFromData(await result(db().rpc("answer_push_prompt", { p_yes: yes })));
}

/**
 * Records the asked-once answer without waiting (FLOW-976: one push question, asked on the review card
 * or in setup's step 7). Cached at once, so a quick visit Home and back does not ask again first.
 */
export function useRecordPushAnswer(): (yes: boolean) => void {
  const client = useQueryClient();
  return (yes) => {
    client.setQueryData<NotificationPrefs>(PUSH_PREFS_KEY, (current) => current && { ...current, prompt_answered: true });
    void answerPushPrompt(yes)
      .then((saved) => { client.setQueryData(PUSH_PREFS_KEY, saved); })
      .catch(() => undefined);
  };
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (current == null) return true;
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((byte, index) => byte === wanted[index]);
}

const TIMED_OUT = Symbol("timed-out");

/** The promise's value, or TIMED_OUT after `ms`. A browser call that never settles cannot hold a screen busy. */
export async function within<T>(promise: PromiseLike<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => { resolve(TIMED_OUT); }, ms); });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * FLOW-516: how long each step after the permission prompt may take. A first visit on a slow phone
 * is still precaching the app shell; iOS can take a few seconds to subscribe. The permission prompt
 * waits on the person, so it gets the longest.
 */
export const PUSH_TIMEOUTS = {
  permission: 120_000,
  worker: 10_000,
  controller: 3_000,
  lookup: 10_000,
  unsubscribe: 10_000,
  subscribe: 20_000,
  retryPause: 500,
  save: 10_000,
} as const;

export type PushTimeouts = { [K in keyof typeof PUSH_TIMEOUTS]: number };

/** This device's push state, for Settings → התראות and the review card. */
export type DevicePush = "subscribed" | "not-subscribed" | "denied" | "no-worker" | Exclude<PushSupport, "ok">;

/** This device's state, and its endpoint's tag (to find it in the connected devices list). */
export type DeviceInfo = { state: DevicePush; tag: string | null };

export const DEVICE_PUSH_KEY = ["push-device"] as const;

/** The first 16 hex digits of the endpoint's SHA-256, as list_my_push_devices returns them. Never the endpoint. */
export async function endpointTag(endpoint: string): Promise<string | null> {
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
    return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * Reads this device's state without asking anything: the permission, then the worker's push
 * subscription made with this build's key. Never waits more than `ms` on a browser call.
 */
export async function readDevicePush(ms = 3000): Promise<DeviceInfo> {
  const support = pushSupport();
  if (support !== "ok") return { state: support, tag: null };
  if (Notification.permission === "denied") return { state: "denied", tag: null };
  try {
    const registration = await within(navigator.serviceWorker.ready, ms);
    if (registration === TIMED_OUT) return { state: "no-worker", tag: null };
    const subscription = await within(registration.pushManager.getSubscription(), ms);
    if (subscription === TIMED_OUT || subscription == null) return { state: "not-subscribed", tag: null };
    const tag = await endpointTag(subscription.endpoint);
    // Permission taken back, or a subscription made with an older key: nothing can be sent to it.
    if (Notification.permission !== "granted" || !sameKey(subscription.options.applicationServerKey, keyBytes(vapidKey()))) {
      return { state: "not-subscribed", tag };
    }
    return { state: "subscribed", tag };
  } catch {
    return { state: "not-subscribed", tag: null };
  }
}

/**
 * This device's state, read again when it can have changed outside the page (FLOW-936): when the
 * service worker takes control (a first open, while the worker still installs, reads "no-worker",
 * and that stayed while the screen was open), and each time the app comes back to the front
 * (permission changed in the iOS Settings app, or the subscription dropped).
 */
export function useDevicePushQuery(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    const reread = () => { void client.invalidateQueries({ queryKey: DEVICE_PUSH_KEY }); };
    const onVisible = () => { if (document.visibilityState === "visible") reread(); };
    container.addEventListener("controllerchange", reread);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      container.removeEventListener("controllerchange", reread);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, enabled]);
  return useQuery({ queryKey: DEVICE_PUSH_KEY, enabled, retry: false, staleTime: 0, queryFn: () => readDevicePush() });
}

/** The step a subscribe reached. Shown, with the reason and the browser's error name, when it fails. */
export type SubscribeStep = "permission" | "worker" | "controller" | "lookup" | "unsubscribe" | "subscribe" | "save" | "done";

export type SubscribeResult =
  | "ok"
  | "unsupported"
  | "denied"
  | "dismissed"
  | "permission-timeout"
  | "worker-timeout"
  | "not-controlled"
  | "lookup-timeout"
  | "lookup-threw"
  | "unsubscribe-timeout"
  | "unsubscribe-threw"
  | "subscribe-timeout"
  | "subscribe-threw"
  | "save-timeout"
  | "save-failed";

export type SubscribeOutcome = {
  result: SubscribeResult;
  step: SubscribeStep;
  /** The browser's error name and a short message ("InvalidStateError: …"). No endpoint, no key. */
  detail?: string;
};

/** "AbortError: message", at most 100 characters, with any URL taken out. */
export function errorDetail(error: unknown): string {
  const record = typeof error === "object" && error != null ? error as { name?: unknown; message?: unknown } : null;
  const name = typeof record?.name === "string" && record.name !== "" ? record.name : "Error";
  const message = record == null ? (typeof error === "string" ? error : "") : typeof record.message === "string" ? record.message : "";
  const clean = message.replace(/https?:\/\/\S+/g, "<url>").replace(/\s+/g, " ").trim();
  return (clean === "" ? name : `${name}: ${clean}`).slice(0, 100);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Waits briefly for the worker to control this page (a first open after an update is not yet). */
async function controlled(ms: number): Promise<boolean> {
  const container = navigator.serviceWorker;
  if (container.controller != null) return true;
  let listener: (() => void) | undefined;
  const change = new Promise<boolean>((resolve) => {
    listener = () => { resolve(true); };
    container.addEventListener("controllerchange", listener);
  });
  try {
    return (await within(change, ms)) === true;
  } finally {
    if (listener) container.removeEventListener("controllerchange", listener);
  }
}

/**
 * Asks for permission and subscribes this device. Call it straight from a tap, with no await
 * before it: Safari and Chrome refuse a permission request that does not come from a user gesture.
 * Every step after the prompt has its own timeout and reason, and an outer limit backs them, so it
 * always settles and a busy control always clears (FLOW-516).
 */
export function subscribeThisDevice(timeouts: PushTimeouts = PUSH_TIMEOUTS, limitMs = 240_000): Promise<SubscribeOutcome> {
  // subscribeSteps runs at once, in this same task: requestPermission is its first call.
  const pending = subscribeSteps(timeouts).catch((error: unknown): SubscribeOutcome => ({ result: "subscribe-threw", step: "subscribe", detail: errorDetail(error) }));
  return within(pending, limitMs).then((outcome) => outcome === TIMED_OUT
    ? { result: "subscribe-timeout", step: "subscribe", detail: "no answer" }
    : outcome);
}

async function subscribeSteps(timeouts: PushTimeouts): Promise<SubscribeOutcome> {
  if (pushSupport() !== "ok") return { result: "unsupported", step: "permission" };
  let permission: NotificationPermission | typeof TIMED_OUT;
  try {
    // The request runs in this same task as the tap.
    permission = await within(Notification.requestPermission(), timeouts.permission);
  } catch (error) {
    return { result: "denied", step: "permission", detail: errorDetail(error) };
  }
  if (permission === TIMED_OUT) return { result: "permission-timeout", step: "permission" };
  if (permission === "denied") return { result: "denied", step: "permission" };
  if (permission !== "granted") return { result: "dismissed", step: "permission" };

  let step: SubscribeStep = "worker";
  let isControlled = true;
  try {
    const registration = await within(navigator.serviceWorker.ready, timeouts.worker);
    if (registration === TIMED_OUT) return { result: "worker-timeout", step };
    step = "controller";
    isControlled = await controlled(timeouts.controller);
    const key = keyBytes(vapidKey());

    step = "lookup";
    let existing: PushSubscription | null | typeof TIMED_OUT;
    try {
      existing = await within(registration.pushManager.getSubscription(), timeouts.lookup);
    } catch (error) {
      return { result: "lookup-threw", step, detail: errorDetail(error) };
    }
    if (existing === TIMED_OUT) return { result: "lookup-timeout", step };

    let subscription: PushSubscription | null = existing;
    // A subscription made with an older key can no longer be sent to. Subscribe fresh first; only
    // when the browser refuses because of the old one, drop it, pause and try once more.
    if (subscription != null && !sameKey(subscription.options.applicationServerKey, key)) subscription = null;
    if (subscription == null) {
      const options = { userVisibleOnly: true, applicationServerKey: key };
      step = "subscribe";
      let made: PushSubscription | typeof TIMED_OUT;
      try {
        made = await within(registration.pushManager.subscribe(options), timeouts.subscribe);
      } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        if (name !== "InvalidStateError" && name !== "AbortError") {
          return { result: isControlled ? "subscribe-threw" : "not-controlled", step, detail: errorDetail(error) };
        }
        step = "unsubscribe";
        const old = existing ?? await within(registration.pushManager.getSubscription(), timeouts.lookup);
        if (old !== TIMED_OUT && old != null) {
          const dropped = await within(old.unsubscribe(), timeouts.unsubscribe);
          if (dropped === TIMED_OUT) return { result: "unsubscribe-timeout", step, detail: errorDetail(error) };
        }
        await pause(timeouts.retryPause);
        step = "subscribe";
        made = await within(registration.pushManager.subscribe(options), timeouts.subscribe);
      }
      if (made === TIMED_OUT) return { result: isControlled ? "subscribe-timeout" : "not-controlled", step };
      subscription = made;
    }

    step = "save";
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (json.endpoint == null || p256dh == null || auth == null) return { result: "subscribe-threw", step: "subscribe", detail: "no keys" };
    let saved: unknown;
    try {
      saved = await within(
        result(db().rpc("push_subscribe", { p_endpoint: json.endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: navigator.userAgent })),
        timeouts.save,
      );
    } catch (error) {
      return { result: "save-failed", step, detail: errorDetail(error) };
    }
    if (saved === TIMED_OUT) return { result: "save-timeout", step };
    void noteOwner();
    return { result: "ok", step: "done" };
  } catch (error) {
    // The step a throw came from (TypeScript narrows `step` to its last plain assignment here).
    const at = step as SubscribeStep;
    const result: SubscribeResult = at === "subscribe" ? (isControlled ? "subscribe-threw" : "not-controlled")
      : at === "unsubscribe" ? "unsubscribe-threw"
        : at === "lookup" ? "lookup-threw"
          : at === "save" ? "save-failed"
            : "worker-timeout";
    return { result, step: at, detail: errorDetail(error) };
  }
}

/** Remembers which user this browser's subscription belongs to, so a later user drops it. */
async function noteOwner(): Promise<void> {
  try {
    const session = await within(db().auth.getSession(), 3000);
    if (session !== TIMED_OUT) notePushOwner(session.data.session?.user.id ?? null);
  } catch {
    // Unknown: the next user's sign-in keeps the subscription, as before FLOW-516.
  }
}

/**
 * Drops this browser's subscription. `server` (an explicit sign-out, while the session still
 * works) also deletes its row, so nothing is sent to it again. A user switch drops it locally;
 * the server deletes that endpoint on its next send (410). An expired session keeps it.
 */
export async function forgetThisDevice({ server = false }: { server?: boolean } = {}): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  // The owner is forgotten only once this browser holds no subscription, so a drop that timed out
  // or was refused is tried again on the next sign-in by another user (a shared phone).
  let gone = false;
  try {
    const registration = await within(navigator.serviceWorker.getRegistration(), 3000);
    if (registration === TIMED_OUT) return;
    const subscription = registration == null ? null : await within(registration.pushManager.getSubscription(), 3000);
    if (subscription === TIMED_OUT) return;
    if (subscription == null) {
      gone = true;
    } else {
      if (server) {
        await within(result(db().rpc("push_unsubscribe", { p_endpoint: subscription.endpoint })), 5000).catch(() => undefined);
      }
      gone = (await within(subscription.unsubscribe(), 3000)) === true;
    }
  } catch {
    // The browser refused: the owner stays, so the next user's sign-in tries again.
  } finally {
    if (gone) notePushOwner(null);
  }
}

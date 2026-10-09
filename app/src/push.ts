import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";
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
  /** At least one of this user's devices is subscribed. */
  has_subscription: boolean;
};

export type NotificationPrefKey = "new_transaction" | "evening_reminder" | "weekly_summary";

export const NO_PREFS: NotificationPrefs = {
  new_transaction: false,
  evening_reminder: false,
  weekly_summary: false,
  prompt_answered: false,
  has_subscription: false,
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

export function pushSupport(): PushSupport {
  if (!pushConfigured()) return "not-configured";
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const mode = detectInstallMode();
  const ios = mode === "iphone" || mode === "iphone-other" || mode === "ipad";
  if (ios && !isStandalone()) return "ios-home-screen";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

// The push RPCs land with the FLOW-502 server PR; until the generated types carry them, call them untyped.
// Before this merges, each call names its function literally on supabase.rpc so scripts/smoke-allow-rpcs.test.mjs
// sees it (the migrations must define the functions first).
type UntypedRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const call = supabase.rpc.bind(supabase) as unknown as UntypedRpc;
  const { data, error } = await call(name, args);
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
    has_subscription: flag("has_subscription"),
  };
}

export async function readNotificationPrefs(): Promise<NotificationPrefs> {
  return prefsFromData(await rpc("get_notification_prefs"));
}

export function useNotificationPrefsQuery(enabled: boolean) {
  return useQuery({ queryKey: PUSH_PREFS_KEY, enabled, retry: false, queryFn: readNotificationPrefs });
}

/** Null leaves a switch as it is. Returns the stored prefs. */
export async function saveNotificationPrefs(change: Partial<Record<NotificationPrefKey, boolean>>): Promise<NotificationPrefs> {
  return prefsFromData(await rpc("set_notification_prefs", {
    p_new_transaction: change.new_transaction ?? null,
    p_evening_reminder: change.evening_reminder ?? null,
    p_weekly_summary: change.weekly_summary ?? null,
  }));
}

/** Records the review card's answer, so it is asked once. Yes also turns on the evening reminder. */
export async function answerPushPrompt(yes: boolean): Promise<NotificationPrefs> {
  return prefsFromData(await rpc("answer_push_prompt", { p_yes: yes }));
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/**
 * The registered worker, or null when none becomes ready (dev, or blocked). A first visit on a slow
 * phone is still precaching the app shell, so this waits well past a normal install.
 */
async function readyWorker(): Promise<ServiceWorkerRegistration | null> {
  const timeout = new Promise<null>((resolve) => { window.setTimeout(() => { resolve(null); }, 15000); });
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export type SubscribeResult = "ok" | "denied" | "failed";

/**
 * Asks for permission and subscribes this device. Call it straight from a tap: Safari and Chrome
 * refuse a permission request that does not come from a user gesture.
 */
export async function subscribeThisDevice(): Promise<SubscribeResult> {
  if (pushSupport() !== "ok") return "failed";
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return "failed";
  }
  if (permission !== "granted") return "denied";
  try {
    const registration = await readyWorker();
    if (!registration) return "failed";
    const key = keyBytes(vapidKey());
    let subscription = await registration.pushManager.getSubscription();
    // A subscription made with an older key can no longer be sent to: replace it.
    if (subscription != null && !sameKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (json.endpoint == null || p256dh == null || auth == null) return "failed";
    await rpc("push_subscribe", { p_endpoint: json.endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: navigator.userAgent });
    return "ok";
  } catch {
    return "failed";
  }
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (current == null) return true;
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((byte, index) => byte === wanted[index]);
}

/**
 * Drops this browser's subscription when its user signs out or another signs in, so the previous
 * user's reminders stop on a shared phone. The server deletes the endpoint on its next send (410).
 */
export async function forgetThisDevice(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to drop, or the browser refused: the server still drops a dead endpoint.
  }
}

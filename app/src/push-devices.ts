import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "./lib/supabase";

/**
 * FLOW-516: Settings → התראות's connected devices, from `list_my_push_devices` (the caller's own
 * subscriptions; no endpoint, no key). The tag is the start of the endpoint's SHA-256, so this
 * device can find its own row.
 */
export type PushDevice = { id: string; userAgent: string | null; createdAt: string; tag: string };

export const PUSH_DEVICES_KEY = ["push-devices"] as const;

export function devicesFromData(data: unknown): PushDevice[] {
  const list = data != null && typeof data === "object" ? (data as Record<string, unknown>).devices : undefined;
  if (!Array.isArray(list)) throw new Error("validation");
  return list.flatMap((row: unknown) => {
    if (row == null || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.created_at !== "string" || typeof item.tag !== "string") return [];
    return [{
      id: item.id,
      userAgent: typeof item.user_agent === "string" ? item.user_agent : null,
      createdAt: item.created_at,
      tag: item.tag,
    }];
  });
}

async function readPushDevices(): Promise<PushDevice[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const { data, error } = await supabase.rpc("list_my_push_devices");
  if (error) throw new Error(error.message);
  return devicesFromData(data);
}

export function usePushDevicesQuery(enabled: boolean) {
  return useQuery({ queryKey: PUSH_DEVICES_KEY, enabled, retry: false, queryFn: readPushDevices });
}

/** A short, readable name from a stored user agent: "iPhone", "Chrome במחשב", "Android". */
export function deviceName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Firefox\//.test(ua) ? "Firefox"
      : /Chrome\//.test(ua) ? "Chrome"
        : /Safari\//.test(ua) ? "Safari"
          : null;
  if (browser != null) return `${browser} במחשב`;
  return "דפדפן";
}

/** "נוסף 09/10": the day and month the device was added, in Israel time. */
export function addedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit" }).format(date);
  return `נוסף ${parts}`;
}

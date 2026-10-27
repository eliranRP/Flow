import { onlineManager } from "@tanstack/react-query";
import { BandOfflineLine, useOnline } from "../ui/band-states";
import { useTopToast } from "../ui/top-toast";

/** FLOW-972: what an offline settings page says. A write made offline waits and runs when the connection is back. */
export const SETTINGS_OFFLINE = "שינויים יישמרו כשהחיבור יחזור";
/** התראות saves through the browser and the server at once, so offline it changes nothing. */
export const NOTIFICATIONS_OFFLINE = "אפשר לשנות התראות כשהחיבור יחזור";
/** Sign-out and deleting the company must not run later by themselves, so offline they wait for the user. */
export const SIGN_OUT_OFFLINE = "אפשר להתנתק כשהחיבור יחזור";
export const DELETE_COMPANY_OFFLINE = "אפשר למחוק את העסק כשהחיבור יחזור";

/** Offline, a settings page says under its head what waits for the connection (decision 0222). */
export function SettingsOfflineLine({ words = SETTINGS_OFFLINE }: { words?: string }) {
  const online = useOnline();
  return online ? null : <BandOfflineLine onPage words={words} />;
}

/** Offline, refuses an action that cannot wait, with a note that says when it can run. Returns whether it refused. */
export function useOfflineRefusal(): (words: string) => boolean {
  const toast = useTopToast();
  return (words) => {
    if (onlineManager.isOnline()) return false;
    toast.show({ message: `אין חיבור · ${words}`, tone: "info" });
    return true;
  };
}

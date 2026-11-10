import { onlineManager } from "@tanstack/react-query";

type ConnectionTarget = Pick<Window, "addEventListener" | "removeEventListener"> & {
  navigator: { onLine: boolean };
  document?: { visibilityState: string };
};

/** True when a request gets through. */
export type Reach = () => Promise<boolean>;

/**
 * One cheap request to the app's backend, to confirm a browser that says it is offline. Opaque
 * (no-cors) and uncached: any answer means the network is there; only a network error means it isn't.
 */
export const reachBackend: Reach = async () => {
  const url = import.meta.env.VITE_SUPABASE_URL || window.location.origin;
  try {
    await fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
};

/**
 * FLOW-1140: the app's one check of the real connection. React Query's onlineManager takes the device
 * as online until the first `offline` event, so an app opened with no connection read as online: its
 * reads ran, failed and showed an error. From launch it now starts from the browser's own state and
 * follows its online and offline events; useOnline (ui/band-states.tsx), screenPhase and the skeletons'
 * offline line (ui/offline-wait.tsx) all read this one state.
 *
 * navigator.onLine can say false while the network works (some VPN or virtual adapters, WebViews,
 * WebKit standalone after a network toggle), and no `online` event would ever come. So whenever the
 * browser says offline, one request confirms it: if it gets through, the app is online. While offline,
 * coming back to the app (focus, or the page becoming visible) checks again.
 */
export function followConnection(target: ConnectionTarget = window, reach: Reach = reachBackend): void {
  onlineManager.setEventListener((setOnline) => {
    // Each online or offline event starts a new turn. A check answers only for the turn it began in:
    // one that got through while the connection was briefly back says nothing about a later offline.
    let turn = 0;
    let checking: number | null = null;
    const confirm = () => {
      if (checking === turn) return;
      const mine = turn;
      checking = mine;
      void reach().then((reached) => {
        if (checking === mine) checking = null;
        if (reached && mine === turn) setOnline(true);
      });
    };
    const online = () => {
      turn += 1;
      setOnline(true);
    };
    const offline = () => {
      turn += 1;
      setOnline(false);
      confirm();
    };
    const recheck = () => {
      if (onlineManager.isOnline()) return;
      if (target.document != null && target.document.visibilityState === "hidden") return;
      confirm();
    };
    if (target.navigator.onLine) setOnline(true);
    else offline();
    target.addEventListener("online", online);
    target.addEventListener("offline", offline);
    target.addEventListener("focus", recheck);
    target.addEventListener("visibilitychange", recheck);
    return () => {
      target.removeEventListener("online", online);
      target.removeEventListener("offline", offline);
      target.removeEventListener("focus", recheck);
      target.removeEventListener("visibilitychange", recheck);
    };
  });
}

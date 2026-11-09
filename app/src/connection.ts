import { onlineManager } from "@tanstack/react-query";

type ConnectionTarget = Pick<Window, "addEventListener" | "removeEventListener"> & { navigator: { onLine: boolean } };

/**
 * FLOW-1140: the app's one check of the real connection. React Query's onlineManager takes the device
 * as online until the first `offline` event, so an app opened with no connection read as online: its
 * reads ran, failed and showed an error, and a read started later never paused. From launch it now
 * starts from the browser's own state (navigator.onLine false means no network at all) and follows its
 * online and offline events. A read pauses only then; useOnline (ui/band-states.tsx), screenPhase and
 * the skeletons' offline line (ui/offline-wait.tsx) all read this one state.
 */
export function followConnection(target: ConnectionTarget = window): void {
  onlineManager.setEventListener((setOnline) => {
    setOnline(target.navigator.onLine);
    const online = () => {
      setOnline(true);
    };
    const offline = () => {
      setOnline(false);
    };
    target.addEventListener("online", online);
    target.addEventListener("offline", offline);
    return () => {
      target.removeEventListener("online", online);
      target.removeEventListener("offline", offline);
    };
  });
}

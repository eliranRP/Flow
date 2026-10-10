/**
 * FLOW-910. A deploy installs a new service worker that takes control at once (vite-plugin-pwa's
 * autoUpdate: skipWaiting and clientsClaim), but an open tab keeps running the old bundle until it
 * loads again: the owner's tab ran a build from before an invite fix, so its invites sent no email.
 *
 * When a new worker takes control of a page that already had one, the page reloads once. FLOW-426
 * (cycle 19, design lead): never while the page is in front and idle, which could drop a scrolled
 * list or state that is not in the URL. It reloads on the next move to another screen, onto that
 * screen, or when the app goes to the background, and never while a sheet is open or a field has
 * focus. A first install (no worker before) keeps the page: it already runs the new bundle. The app
 * also asks for an update each time it comes back to the front, so a tab left open for days finds
 * the deploy.
 */

/** sessionStorage key: when this tab last reloaded for a new worker. */
export const RELOADED_KEY = "flow-sw-reloaded";
/** A second reload this soon after one is a loop: skip it. */
export const LOOP_MS = 10_000;

/** A sheet or dialog is open, or a field has focus: a reload would lose what the user is doing. */
export function busy(doc: Document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]') != null) return true;
  const active = doc.activeElement;
  return active != null && active.matches('input, textarea, select, [contenteditable="true"]');
}

type Win = Pick<Window, "navigator" | "document" | "location" | "sessionStorage" | "history" | "addEventListener">;

export function watchServiceWorker(win: Win = window, now: () => number = Date.now): void {
  const sw = win.navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (sw == null) return;
  let hadController = sw.controller != null;
  // A new worker took control and the page still runs the old bundle.
  let pending = false;

  const tryReload = () => {
    if (!pending || busy(win.document)) return;
    pending = false;
    try {
      if (now() - Number(win.sessionStorage.getItem(RELOADED_KEY)) < LOOP_MS) return;
      win.sessionStorage.setItem(RELOADED_KEY, String(now()));
    } catch {
      // No storage (a private window): this page still reloads only once, since `pending` clears.
    }
    win.location.reload();
  };

  sw.addEventListener("controllerchange", () => {
    pending = hadController;
    hadController = true;
    if (win.document.visibilityState === "hidden") tryReload();
  });
  // The router moves between screens with pushState, and Back with popstate: the URL is already the
  // new screen's, so the reload lands there. Only a new path counts: a push that opens a sheet or
  // changes a query on the same screen comes before the sheet mounts, where busy() can't see it.
  let path = win.location.pathname;
  const onMove = () => {
    if (win.location.pathname === path) return;
    path = win.location.pathname;
    tryReload();
  };
  const push = win.history.pushState.bind(win.history);
  win.history.pushState = (...args: Parameters<History["pushState"]>) => {
    push(...args);
    onMove();
  };
  win.addEventListener("popstate", onMove);
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState === "hidden") tryReload();
    else void sw.getRegistration().then((registration) => registration?.update(), () => undefined);
  });
}

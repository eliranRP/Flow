/**
 * FLOW-910. A deploy installs a new service worker that takes control at once (vite-plugin-pwa's
 * autoUpdate: skipWaiting and clientsClaim), but an open tab keeps running the old bundle until it
 * loads again: the owner's tab ran a build from before an invite fix, so its invites sent no email.
 *
 * When a new worker takes control of a page that already had one, the page reloads once: at once
 * when nothing is open, else as soon as no sheet is open and no field has focus, or when the app
 * goes to the background. A first install (no worker before) keeps the page: it already runs the
 * new bundle. The app also asks for an update each time it comes back to the front, so a tab left
 * open for days finds the deploy.
 */

/** sessionStorage key: when this tab last reloaded for a new worker. */
export const RELOADED_KEY = "flow-sw-reloaded";
/** A second reload this soon after one is a loop: skip it. */
export const LOOP_MS = 10_000;
/** How often a deferred reload checks again whether the page is free. */
export const RETRY_MS = 2_000;

/** A sheet or dialog is open, or a field has focus: a reload would lose what the user is doing. */
export function busy(doc: Document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]') != null) return true;
  const active = doc.activeElement;
  return active != null && active.matches('input, textarea, select, [contenteditable="true"]');
}

type Win = Pick<Window, "navigator" | "document" | "location" | "sessionStorage" | "setInterval" | "clearInterval">;

export function watchServiceWorker(win: Win = window, now: () => number = Date.now): void {
  const sw = win.navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (sw == null) return;
  let hadController = sw.controller != null;
  // Set while a reload waits for the page to be free.
  let timer: number | undefined;

  const tryReload = () => {
    if (timer === undefined || (win.document.visibilityState !== "hidden" && busy(win.document))) return;
    win.clearInterval(timer);
    timer = undefined;
    try {
      if (now() - Number(win.sessionStorage.getItem(RELOADED_KEY)) < LOOP_MS) return;
      win.sessionStorage.setItem(RELOADED_KEY, String(now()));
    } catch {
      // No storage (a private window): this page still reloads only once, since `timer` clears.
    }
    win.location.reload();
  };

  sw.addEventListener("controllerchange", () => {
    if (hadController) {
      timer ??= win.setInterval(tryReload, RETRY_MS);
      tryReload();
    }
    hadController = true;
  });
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState === "visible") void sw.getRegistration().then((registration) => registration?.update(), () => undefined);
    tryReload();
  });
}

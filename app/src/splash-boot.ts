import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/**
 * FLOW-1277: the splash plays once per page load, which is a cold start of the app; a route change never
 * reaches this. An automated browser (Playwright, WebDriver) never sees it, so no test click lands on it.
 */
let started = false;

/** The longest the cover waits for the splash's code; a normal load is far shorter. */
const COVER_FAILSAFE_MS = 3000;

export function shouldPlaySplash(nav: Pick<Navigator, "webdriver">): boolean {
  return !nav.webdriver;
}

/**
 * Starts the splash over the app, which is mounted and loading under it, so its first render and its reads
 * do not wait. The splash's own code is a chunk (Home's entry stays small): until it arrives, a cover in the
 * page colour is up, so the app never shows for a moment before the splash. Returns whether it started.
 */
export function startSplash(): boolean {
  if (started || !shouldPlaySplash(navigator)) return false;
  started = true;
  const cover = document.createElement("div");
  cover.setAttribute("aria-hidden", "true");
  cover.style.cssText = "position:fixed;inset:0;z-index:100;background:var(--color-bg)";
  document.body.append(cover);
  // A chunk that stalls (neither loads nor fails) must not leave the cover up: the page colour would hide the
  // app for good. This applies to the cover only; a splash that arrives in time is not cut short by it.
  let abandoned = false;
  const failsafe = window.setTimeout(() => {
    abandoned = true;
    cover.remove();
  }, COVER_FAILSAFE_MS);
  void import("./ui/splash").then(
    ({ Splash }) => {
      if (abandoned) return;
      const host = document.createElement("div");
      document.body.append(host);
      const dispose = () => {
        try {
          root.unmount();
        } catch {
          // Already gone.
        }
        host.remove();
      };
      // React reports a render that throws here (flushSync does not rethrow it): the splash leaves, the app shows.
      const root = createRoot(host, {
        onUncaughtError: (error) => {
          console.error(error);
          dispose();
        },
      });
      try {
        // Committed at once, so the cover leaves in the same frame the splash arrives.
        flushSync(() => {
          root.render(createElement(Splash, { onDone: dispose }));
        });
      } catch {
        dispose();
      } finally {
        window.clearTimeout(failsafe);
        cover.remove();
      }
    },
    () => {
      window.clearTimeout(failsafe);
      cover.remove();
    },
  );
  return true;
}

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/**
 * FLOW-1277: the splash plays once per page load, which is a cold start of the app; a route change never
 * reaches this. An automated browser (Playwright, WebDriver) never sees it, so no test click lands on it.
 */
let started = false;

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
  void import("./ui/splash").then(
    ({ Splash }) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const done = () => {
        root.unmount();
        host.remove();
      };
      // Committed at once, so the cover leaves in the same frame the splash arrives.
      flushSync(() => {
        root.render(createElement(Splash, { onDone: done }));
      });
      cover.remove();
    },
    () => {
      cover.remove();
    },
  );
  return true;
}

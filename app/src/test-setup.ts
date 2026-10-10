import { readFileSync } from "node:fs";
import { afterEach, expect } from "vitest";
import { pinReviewLine } from "./review-pin";

// A file under `// @vitest-environment node` tests logic only: it skips the DOM setup below
// (Testing Library, the jest-dom matchers, the CSS and the sheet history), about half a second a file.
const dom = typeof document !== "undefined";

// The app's CSS is 180 KB: jsdom parses it for each file and matches it on every getByRole, about
// a fifth of the unit run. Only a file that reads styles loads it: one that measures or checks
// visibility, uses the style helpers in ui/test-support, or says `vitest-css` because its queries
// rely on CSS hiding (a hidden copy of a control). Without the CSS, a hidden element counts as
// visible, so a check that something is hidden fails loudly rather than passing by mistake. The
// other way round, a file without it no longer notices CSS that hides a control it finds by role;
// Storybook and e2e check what is really visible.
const readsStyles = /getComputedStyle|styleSheets|toBeVisible|toHaveStyle|test-support|vitest-css/;
const testPath = expect.getState().testPath;
const css = dom && (testPath == null || readsStyles.test(readFileSync(testPath, "utf8")));

if (dom) {
  await Promise.all([
    import("@testing-library/jest-dom/vitest"),
    ...(css ? [import("../../design/system/implementation-tokens.css"), import("./ui/ui.css")] : []),
  ]);
}
const library = dom ? await import("@testing-library/react") : null;
const back = dom ? await import("./ui/back") : null;

if (dom && typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (dom && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// CI runs every jsdom file at once, and a screen now mounts a few ticks after its lazy import
// resolves (FLOW-804). The 1 s default for findBy/waitFor ran out on a loaded runner (red main
// on 6aaf93a); a test that expects nothing to appear passes its own short timeout.
library?.configure({ asyncUtilTimeout: 3_000 });

if (dom) {
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
}

afterEach(() => {
  library?.cleanup();
  back?.resetSheetHistoryLock();
  // The review pin is module state; a pin from one test must not reorder the next queue.
  pinReviewLine(null);
  if (!dom) return;
  // Tests stamp a fake browser index. A leftover idx makes the next test pop
  // the memory stack as if it were the browser.
  window.history.replaceState(null, "");
  document.documentElement.dataset.theme = "light";
});

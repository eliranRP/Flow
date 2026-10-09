import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { resetSheetHistoryLock } from "./ui/back";
import { pinReviewLine } from "./review-pin";
import "../../design/system/implementation-tokens.css";
import "./ui/ui.css";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window.matchMedia !== "function") {
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
configure({ asyncUtilTimeout: 3_000 });

document.documentElement.lang = "he";
document.documentElement.dir = "rtl";

afterEach(() => {
  cleanup();
  resetSheetHistoryLock();
  // The review pin is module state; a pin from one test must not reorder the next queue.
  pinReviewLine(null);
  // Tests stamp a fake browser index. A leftover idx makes the next test pop
  // the memory stack as if it were the browser.
  window.history.replaceState(null, "");
  document.documentElement.dataset.theme = "light";
});

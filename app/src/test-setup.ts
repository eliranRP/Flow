import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { resetSheetHistoryLock } from "./ui/back";
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

document.documentElement.lang = "he";
document.documentElement.dir = "rtl";

afterEach(() => {
  cleanup();
  resetSheetHistoryLock();
  // Tests stamp a fake browser index. A leftover idx makes the next test pop
  // the memory stack as if it were the browser.
  window.history.replaceState(null, "");
  document.documentElement.dataset.theme = "light";
});

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import "../../design/system/implementation-tokens.css";
import "./ui/ui.css";

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
  document.documentElement.dataset.theme = "light";
});

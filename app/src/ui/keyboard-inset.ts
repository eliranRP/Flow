import { useEffect } from "react";

const IPHONE_IPAD = /iP(hone|ad)/;

/** Keeps sheet height and tab bar in sync with the on-screen keyboard (visualViewport). */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const on = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--vvh", `${String(vv.height)}px`);
      root.style.setProperty("--kb", `${String(kb)}px`);
      const open = kb > 120;
      if (open !== (root.dataset.kb === "open")) {
        if (open) root.dataset.kb = "open";
        else delete root.dataset.kb;
        const active = document.activeElement;
        if (
          open
          && active instanceof HTMLElement
          && active.closest(".ui-sheet-body")
          && !IPHONE_IPAD.test(navigator.userAgent)
        ) {
          active.scrollIntoView({ block: "nearest" });
        }
      }
    };
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
      delete root.dataset.kb;
      root.style.removeProperty("--vvh");
      root.style.removeProperty("--kb");
    };
  }, []);
}

import { useEffect } from "react";

const IPHONE_IPAD = /iP(hone|ad)/;

/** Keeps sheet height and tab bar in sync with the on-screen keyboard (visualViewport). */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const on = () => {
      // Space below the visual viewport, for insets. On iOS it drops to 0 when the
      // visual viewport is panned down with the keyboard still up, so it can't detect the keyboard.
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Screen height the visual viewport doesn't cover. Panning (offsetTop) and
      // pinch-zoom (scale) leave it unchanged; only the keyboard takes it away.
      const scale = vv.scale > 0 ? vv.scale : 1;
      const covered = Math.max(0, window.innerHeight - vv.height * scale);
      root.style.setProperty("--vvh", `${String(vv.height)}px`);
      root.style.setProperty("--kb", `${String(kb)}px`);
      const open = covered > 120;
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

import { useEffect } from "react";

const IPHONE_IPAD = /iP(hone|ad)/;

/** Keeps sheet height and tab bar in sync with the on-screen keyboard (visualViewport). */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    // The tallest layout height seen at this width. A browser that ignores
    // `interactive-widget` shrinks the layout viewport with the keyboard too, so
    // innerHeight alone would hide the keyboard (FLOW-310). A width change is a rotation.
    let fullHeight = window.innerHeight;
    let fullWidth = window.innerWidth;
    const on = () => {
      if (window.innerWidth !== fullWidth) {
        fullWidth = window.innerWidth;
        fullHeight = window.innerHeight;
      } else {
        fullHeight = Math.max(fullHeight, window.innerHeight);
      }
      // Space below the visual viewport, for insets. On iOS it drops to 0 when the
      // visual viewport is panned down with the keyboard still up, so it can't detect the keyboard.
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Screen height the visual viewport doesn't cover. Panning (offsetTop) and
      // pinch-zoom (scale) leave it unchanged; only the keyboard takes it away.
      const scale = vv.scale > 0 ? vv.scale : 1;
      const covered = Math.max(0, fullHeight - vv.height * scale);
      root.style.setProperty("--vvh", `${String(vv.height)}px`);
      root.style.setProperty("--kb", `${String(kb)}px`);
      const open = covered > 120;
      if (open !== (root.dataset.kb === "open")) {
        if (open) root.dataset.kb = "open";
        else {
          delete root.dataset.kb;
          clearDrawerLift();
        }
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

/**
 * Vaul lifts an open drawer above the keyboard with an inline `bottom`, and flips its own
 * keyboard flag on every jump over 60px. A keyboard that opens or closes in several steps
 * leaves that flag wrong, and with focus already off the field Vaul stops updating: the sheet
 * stays lifted over an empty gap (FLOW-310). Once the keyboard is gone, drop the lift.
 */
function clearDrawerLift(): void {
  for (const drawer of document.querySelectorAll<HTMLElement>("[data-vaul-drawer]")) {
    if (drawer.style.bottom !== "" && drawer.style.bottom !== "0px") drawer.style.bottom = "0px";
  }
}

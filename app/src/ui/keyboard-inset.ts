import { useEffect } from "react";

const IPHONE_IPAD = /iP(hone|ad)/;

/** Keeps sheet height and tab bar in sync with the on-screen keyboard (visualViewport). */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    // The layout height from before a field took focus. A browser that ignores
    // `interactive-widget` shrinks the layout viewport with the keyboard too, so innerHeight
    // alone would hide the keyboard (FLOW-310). Without a focused field there is no keyboard:
    // a shorter window, a rotation or a hidden URL bar only resets it.
    let fullHeight = window.innerHeight;
    let fullWidth = window.innerWidth;
    const on = () => {
      if (window.innerWidth !== fullWidth || !editableFocused()) {
        fullWidth = window.innerWidth;
        fullHeight = window.innerHeight;
      } else {
        fullHeight = Math.max(fullHeight, window.innerHeight);
      }
      // Space below the visual viewport: the sheet's lift above the keyboard (FLOW-1024). On iOS
      // it drops to 0 when the visual viewport is panned down with the keyboard still up, which
      // is right for the lift (the panned view already ends at the keyboard) but can't detect it.
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // Screen height the visual viewport doesn't cover. Panning (offsetTop) and
      // pinch-zoom (scale) leave it unchanged; only the keyboard takes it away.
      const scale = vv.scale > 0 ? vv.scale : 1;
      const covered = Math.max(0, fullHeight - vv.height * scale);
      root.style.setProperty("--vvh", `${String(vv.height)}px`);
      root.style.setProperty("--kb", `${String(kb)}px`);
      // FLOW-1074: no focused field, no keyboard. iOS can close the keyboard without a visualViewport
      // resize (the app sent to the background, a field blurred by a route change), which left
      // data-kb "open" and the tab bar hidden on every page until the next resize.
      const open = covered > 120 && editableFocused();
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
    // Focus leaving a field, the window resizing and the app coming back from the background each
    // re-read the keyboard. Focus moves after focusout, so that read waits a frame.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(on);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") on();
    };
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    document.addEventListener("focusin", later);
    document.addEventListener("focusout", later);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("resize", on);
    window.addEventListener("pageshow", on);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
      document.removeEventListener("focusin", later);
      document.removeEventListener("focusout", later);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("resize", on);
      window.removeEventListener("pageshow", on);
      delete root.dataset.kb;
      root.style.removeProperty("--vvh");
      root.style.removeProperty("--kb");
    };
  }, []);
}

function editableFocused(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
  return active instanceof HTMLInputElement
    && !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image"].includes(active.type);
}

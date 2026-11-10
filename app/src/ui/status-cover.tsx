import "./lazy.css";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/** A pull to refresh's violet gap (the screen held down while it refreshes: the band is below the room then, the gap under it). */
const BAND_GAP = ".ui-pull-gap[data-tone^='band']";

/** A page's violet bands in the screens, not a sheet's. */
function pageBands(screens: Element): Element[] {
  return [...screens.querySelectorAll(".ui-band")].filter((band) => band.closest("[role='dialog']") == null);
}

/**
 * The status bar's room (--safe-top, under the clock on an iPhone) in the page's colour, over what scrolls under
 * it: a month's pinned head sits just below the room, and the rows passed under the clock (owner's screenshot,
 * 2026-11-07). A page's violet band runs under the status bar itself (and a pull to refresh's gap takes its
 * colour), so the room stays open while a band is there. It is a sibling of the screens, whose entry animation
 * leaves them a stacking context, so a z-index on the band could not lift it above this.
 *
 * FLOW-1158: it reads no layout as the page changes. An IntersectionObserver over the room's strip says which
 * bands are under it, a MutationObserver on the screens' container alone finds the bands and the gap as they come
 * and go, and a ResizeObserver gives the room's height.
 */
export function StatusCover() {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const cover = ref.current;
    if (cover == null) return;
    // The screens' container (the route's outlet), the cover's sibling; the shell as a fallback.
    const shell = cover.parentElement;
    const screens = shell?.querySelector<HTMLElement>(":scope > .below-tabbar") ?? shell;
    if (screens == null || typeof IntersectionObserver === "undefined" || typeof ResizeObserver === "undefined") {
      cover.toggleAttribute("data-open", true);
      return;
    }
    let room = cover.offsetHeight;
    // Whether each band is under the room; null until the observer's first word on it.
    const under = new Map<Element, boolean | null>();
    let sight: IntersectionObserver | null = null;
    const show = () => {
      const states = [...under.values()];
      const open = room === 0 || screens.querySelector(BAND_GAP) != null || states.includes(true);
      // A band not yet seen keeps the room as it is, so it never flickers before the observer's first word.
      if (!open && states.includes(null)) return;
      cover.toggleAttribute("data-open", open);
    };
    const observe = (band: Element) => {
      under.set(band, null);
      sight?.observe(band);
    };
    // The viewport cut to the room's strip at its top; the document as root, so a story's frame is its own viewport.
    const watch = () => {
      sight?.disconnect();
      under.clear();
      sight = room === 0 ? null : new IntersectionObserver((entries) => {
        for (const entry of entries) if (under.has(entry.target)) under.set(entry.target, entry.isIntersecting);
        show();
      }, { root: document, rootMargin: `0px 0px ${String(room - window.innerHeight)}px 0px` });
      for (const band of pageBands(screens)) observe(band);
      show();
    };
    // A screen loads after the route changes, and a band or the gap can come or go without a scroll.
    const found = new MutationObserver(() => {
      const now = pageBands(screens);
      for (const band of [...under.keys()]) {
        if (now.includes(band)) continue;
        sight?.unobserve(band);
        under.delete(band);
      }
      for (const band of now) if (!under.has(band)) observe(band);
      show();
    });
    found.observe(screens, { childList: true, subtree: true });
    // The room (--safe-top) and the viewport's height set the strip.
    const sized = new ResizeObserver((entries) => {
      const next = entries[0]?.borderBoxSize[0]?.blockSize ?? room;
      if (next === room) return;
      room = next;
      watch();
    });
    sized.observe(cover);
    const resized = () => { watch(); };
    window.addEventListener("resize", resized);
    watch();
    return () => {
      found.disconnect();
      sized.disconnect();
      sight?.disconnect();
      window.removeEventListener("resize", resized);
    };
  }, [pathname]);
  return <div ref={ref} className="ui-status-cover" aria-hidden="true" data-open="" />;
}

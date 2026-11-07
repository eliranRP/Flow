import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/** Whether a page's violet band (not a sheet's) is under the status bar's room. */
function bandUnder(room: number): boolean {
  for (const band of document.querySelectorAll<HTMLElement>(".ui-band")) {
    if (band.closest("[role='dialog']") != null) continue;
    const box = band.getBoundingClientRect();
    if (box.top < room && box.bottom > 0) return true;
  }
  return false;
}

/**
 * The status bar's room (--safe-top, under the clock on an iPhone) in the page's colour, over what scrolls under
 * it: a month's pinned head sits just below the room, and the rows passed under the clock (owner's screenshot,
 * 2026-11-07). A page's violet band runs under the status bar itself (and a pull to refresh's gap takes its
 * colour), so the room stays open while a band is there. It is a sibling of the screens, whose entry animation
 * leaves them a stacking context, so a z-index on the band could not lift it above this.
 */
export function StatusCover() {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const cover = ref.current;
    if (cover == null) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const room = cover.offsetHeight;
      cover.toggleAttribute("data-open", room === 0 || bandUnder(room));
    };
    const queue = () => { if (frame === 0) frame = requestAnimationFrame(update); };
    update();
    // A screen loads after the route changes, and a band can come or go without a scroll.
    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
    };
  }, [pathname]);
  return <div ref={ref} className="ui-status-cover" aria-hidden="true" data-open="" />;
}

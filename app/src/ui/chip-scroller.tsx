import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { cx } from "./cx";

/** How far from the row's end a chip still counts as hidden, so a rounding pixel never fades it. */
const SLACK = 2;

/**
 * A row of chips that scrolls sideways (FLOW-347). When more chips wait past the inline end, the
 * row's end fades, so a cut chip reads as "there is more" instead of a sliver. RTL scrollLeft runs
 * negative, so the remaining distance uses its magnitude.
 */
export function ChipScroller({
  label,
  className,
  scrollerRef,
  children,
}: {
  label: string;
  className?: string;
  scrollerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const row = own.current;
    if (!row) return;
    setMore(row.scrollWidth - row.clientWidth - Math.abs(row.scrollLeft) > SLACK);
  }, []);

  // A chip whose label grows ("פרויקט" to a long name) changes the row's scroll width without
  // resizing the row, so every render measures again.
  useLayoutEffect(measure);

  useEffect(() => {
    const row = own.current;
    if (!row) return;
    row.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(row);
    for (const chip of row.children) observer?.observe(chip);
    // The web font can land after the first measure and widen every chip.
    if ("fonts" in document) void document.fonts.ready.then(measure);
    return () => {
      row.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure]);

  const setRow = useCallback((node: HTMLDivElement | null) => {
    own.current = node;
    if (typeof scrollerRef === "function") scrollerRef(node);
    else if (scrollerRef) scrollerRef.current = node;
  }, [scrollerRef]);

  return (
    <div
      className={cx("ui-chip-scroller", className)}
      role="group"
      aria-label={label}
      data-more={more ? "end" : undefined}
      ref={setRow}
    >
      {children}
    </div>
  );
}

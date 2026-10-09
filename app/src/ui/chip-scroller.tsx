import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
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

  useEffect(() => {
    const row = own.current;
    if (!row) return;
    const measure = () => {
      setMore(row.scrollWidth - row.clientWidth - Math.abs(row.scrollLeft) > SLACK);
    };
    measure();
    row.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(row);
    return () => {
      row.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      className={cx("ui-chip-scroller", className)}
      role="group"
      aria-label={label}
      data-more={more ? "end" : undefined}
      ref={(node) => {
        own.current = node;
        if (typeof scrollerRef === "function") scrollerRef(node);
        else if (scrollerRef) scrollerRef.current = node;
      }}
    >
      {children}
    </div>
  );
}

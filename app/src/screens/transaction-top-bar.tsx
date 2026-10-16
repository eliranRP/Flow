import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BackButton } from "../ui/back";
import { cx } from "../ui/cx";

/**
 * FLOW-366 (Lines.dc 87–100): the transaction page's own top bar, in place of the compact header.
 * At rest it is the page's background with no border; past 110px it takes the surface and a line,
 * and "<supplier> · <amount>" fades in. The change is read from a sentinel 110px down, not a scroll
 * listener (110px, the board). Back reads "יצא" or "נכנס" when the list it came from is a month's lines.
 */
export function TransactionTopBar({
  fallback,
  backLabel,
  title,
  end,
}: {
  fallback: string;
  /** Back's words when the list is a month's lines; otherwise BackButton's own label. */
  backLabel: string | null;
  /** "<supplier> · <amount>". */
  title: string;
  /** The ⋯ menu on a manual line, or the reserved slot. */
  end: ReactNode;
}) {
  const sentinel = useRef<HTMLSpanElement>(null);
  const past = useSentinelPast(sentinel);
  return (
    <>
      <span ref={sentinel} className="ui-txn-sentinel" aria-hidden="true" />
      <header className={cx("ui-txn-top", past && "ui-txn-top-past")}>
        <div className="ui-txn-top-start">
          <BackButton fallback={fallback} text={backLabel ?? undefined} />
        </div>
        <p className="ui-txn-top-title" aria-hidden={!past || undefined}>{title}</p>
        <div className="ui-txn-top-end">{end}</div>
      </header>
    </>
  );
}

/** True once the sentinel, 110px down the page, has scrolled above the top of the screen. */
function useSentinelPast(mark: RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const node = mark.current;
    if (node == null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [mark]);
  return past;
}

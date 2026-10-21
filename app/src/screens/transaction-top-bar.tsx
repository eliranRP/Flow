import type { ReactNode } from "react";
import { BackButton } from "../ui/back";
import { cx } from "../ui/cx";
import { useScrolledPast } from "../ui/screen-header";

/**
 * FLOW-366 (Lines.dc 87–100): the transaction page's own top bar, in place of the compact header.
 * At rest it is the page's background with no border; once the page's head has scrolled under it, it
 * takes the surface and a line, and "<supplier> · <amount>" fades in. FLOW-942: the head, not a fixed
 * 110px, so the line never cuts the head's figure or its last line. Back reads "יצא" or "נכנס" when the
 * list it came from is a month's lines.
 */
export function TransactionTopBar({
  fallback,
  backLabel,
  title,
  end,
  head,
}: {
  fallback: string;
  /** Back's words when the list is a month's lines; otherwise BackButton's own label. */
  backLabel: string | null;
  /** "<supplier> · <amount>". */
  title: string;
  /** The ⋯ menu on a manual line, or the reserved slot. */
  end: ReactNode;
  /** The page's head (its name, figure and lines). Null while there is none: the bar stays at rest. */
  head: HTMLElement | null;
}) {
  const past = useScrolledPast(head, true);
  return (
    <header className={cx("ui-txn-top", past && "ui-txn-top-past")}>
      <div className="ui-txn-top-start">
        <BackButton fallback={fallback} text={backLabel ?? undefined} />
      </div>
      <p className="ui-txn-top-title" aria-hidden={!past || undefined}>{title}</p>
      <div className="ui-txn-top-end">{end}</div>
    </header>
  );
}

import type { ReactNode } from "react";
import { KeptOutIcon } from "./icons";

/**
 * FLOW-124 and FLOW-125 (decision 0135): what a transaction row shows of the line itself. A line
 * out of the P&L carries the ⊘ after its title, the same mark as a kept-out category; a bank
 * line shows the bank icon, every other source the document icon.
 */
export function KeptOutTag({ label }: { label: string }) {
  return (
    <span className="ui-cat-out" role="img" aria-label={label}>
      <KeptOutIcon size={18} />
    </span>
  );
}

/** The row icon for a line's source: Mercury is a bank line; SUMIT, manual and photo lines are documents. */
export function rowSource(source: string | null | undefined): "bank" | "invoice" {
  return source === "mercury" ? "bank" : "invoice";
}

/**
 * FLOW-366: a row's tag line. "ממתין לאישור" while the line has an open review; "<reason> · לא נספר ברווח"
 * when the line is out of profit. Both join with " · ", pending first. Null when neither applies.
 */
export function lineTagText({ pending, inPnl, reason }: { pending: boolean; inPnl: boolean; reason: string | null }): ReactNode {
  if (!pending && inPnl) return null;
  return (
    <>
      {pending ? <span className="ui-tag-pending">ממתין לאישור</span> : null}
      {pending && !inPnl ? " · " : null}
      {inPnl ? null : <span className="ui-tag-aside">{[reason, "לא נספר ברווח"].filter((part) => part != null && part !== "").join(" · ")}</span>}
    </>
  );
}

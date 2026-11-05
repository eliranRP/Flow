import { cx } from "./cx";
import { CheckIcon } from "./icons";

export type StatusMarkKind = "due" | "late" | "paid" | "once";

/**
 * FLOW-1043 (BUILD-PLAN §3.6): the 24px mark at the start of a row, passed as a ListRow `icon`. Shape tells the
 * kinds apart: a dashed ring (due, in the signal colour when late), a check on a tint disc (paid), a 6px dot
 * (once). It is decorative: the row's own text says the state in words ("איחר", "צפוי ב-15").
 */
export function StatusMark({ kind }: { kind: StatusMarkKind }) {
  return (
    <span className={cx("ui-status-mark", `ui-status-mark-${kind}`)} aria-hidden="true">
      {kind === "paid" ? <CheckIcon size={14} stroke={2.6} /> : null}
      {kind === "once" ? <span className="ui-status-mark-dot" /> : null}
    </span>
  );
}

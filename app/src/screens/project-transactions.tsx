import { formatAmountText, type ProjectDetail } from "@flow/shared";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useHeldOrder } from "../list-hold";
import { txnListState } from "../txn-nav";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { DocumentIcon } from "../ui/icons";
import { KeptOutHint } from "../ui/split-parts-hint";
import { rowSource } from "../ui/line-marks";
import { ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { loanRowProps, useLoanMarks } from "./loan-marks";
import { PROJECT_RECENT_CAP } from "./project-overview";
import { KEPT_OUT_SHORT } from "./screen-shared";

type ProjectLine = NonNullable<ProjectDetail>["transactions"][number];

/**
 * What a project line adds to its month head. A kept-out line adds nothing (0099). A split line
 * adds this project's share, `parts_minor`, taken as it comes: signed in the line's own terms, a
 * reversal part already minus (decision 0138). Plus is the line's own way, so the share moves
 * money the way the line does; a share the reversals push below zero moves it the other way.
 */
export function projectMonthAmount(txn: ProjectLine): { minor: bigint; currency: string; direction: "income" | "expense" } {
  const direction = txn.direction === "income" ? "income" : "expense";
  const currency = txn.currency ?? "ILS";
  if (txn.kept_out === true) return { minor: 0n, currency, direction };
  if (txn.parts_minor != null) {
    const share = txn.parts_minor;
    if (share >= 0n) return { minor: direction === "income" ? share : -share, currency, direction };
    const other = direction === "income" ? "expense" : "income";
    return { minor: other === "income" ? -share : share, currency, direction: other };
  }
  return { minor: txn.amount_net, currency, direction };
}

/**
 * The row's amount: a split line leads with this project's part, and its hint says "מתוך" the whole
 * line, so a $250 part of a $3,170 payment never reads as $3,170 landing here (owner, 2026-10-09).
 */
export function projectLineRow(txn: ProjectLine): { agorot: bigint; sign: "in" | "out"; whole: string | null } {
  const currency = txn.currency ?? "ILS";
  if (txn.parts_minor == null || txn.kept_out === true) {
    return { agorot: txn.amount_net, sign: txn.direction === "income" ? "in" : "out", whole: null };
  }
  const part = projectMonthAmount(txn);
  const whole = txn.amount_net < 0n ? -txn.amount_net : txn.amount_net;
  return { agorot: part.minor, sign: part.direction === "income" ? "in" : "out", whole: `מתוך ${formatAmountText(whole, currency)}` };
}

/**
 * "לא נספר ברווח · מתוך $3,170 · category · date". The marker leads, so a kept-out line reads as one
 * at a glance, and only the marker holds its width (FLOW-424).
 */
function projectLineHint(txn: ProjectLine, whole: string | null): ReactNode {
  const parts = [whole, txn.category, formatDayMonth(txn.doc_date)].filter((part): part is string => part != null && part !== "");
  return txn.kept_out === true ? <KeptOutHint parts={[KEPT_OUT_SHORT, ...parts]} /> : parts.join(" · ");
}

/** FLOW-340 C: the project's lines for the period, opened from the overview's תנועות row. */
export function ProjectTransactions({
  transactions,
  search,
  live,
}: {
  transactions: readonly ProjectLine[];
  search: string;
  live: boolean;
}) {
  const location = useLocation();
  const held = useHeldOrder(transactions, (txn) => txn.id);
  const heldIds = held.map((txn) => txn.id);
  const listFrom = `${location.pathname}${location.search}`;
  const marks = useLoanMarks(heldIds, live);
  return (
    <>
      {held.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין תנועות בתקופה הזו" body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן." />
      ) : (
        <MonthList
          rows={held}
          keyOf={(txn) => txn.id}
          dateOf={(txn) => txn.doc_date}
          amountOf={projectMonthAmount}
          complete={held.length < PROJECT_RECENT_CAP}
          net
          renderRow={(txn) => {
            const row = projectLineRow(txn);
            return (
              <ListRow
                variant="transaction"
                title={txn.description}
                {...loanRowProps(marks.get(txn.id), projectLineHint(txn, row.whole))}
                agorot={row.agorot}
                sign={row.sign}
                currency={txn.currency ?? "ILS"}
                setAside={txn.kept_out === true}
                source={rowSource(txn.source)}
                href={`/transactions/${txn.id}${search}`}
                state={txnListState(heldIds, txn.id, listFrom)}
              />
            );
          }}
        />
      )}
    </>
  );
}

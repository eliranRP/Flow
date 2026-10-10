import type { CashLine } from "@flow/shared";
import { NOT_IN_PROFIT_LABEL, cashLineSplit } from "../cash";
import { formatDayMonth } from "./date-math";
import { rowSource } from "./line-marks";
import { List, ListRow } from "./list-row";
import { KeptOutHint, SplitPartsHint } from "./split-parts-hint";

/**
 * FLOW-438: a cash list's lines, as the נכנס, יצא and לא נספר ברווח pages draw them, so a month
 * page can list them in the same rows. "counted" is the lines the profit counts, in and out
 * together; "kept" the lines it leaves out, which read quiet.
 */
export type CashLineList = "in" | "out" | "kept" | "counted";

/** Money in is green; money out reads as a cost on יצא and the counted list, and with its minus on לא נספר ברווח. */
export function cashLineSign(list: CashLineList, row: Pick<CashLine, "amount_minor" | "side">): "in" | "out" | "cost" {
  const back = row.amount_minor < 0n;
  if (list === "in") return back ? "out" : "in";
  if (list === "out") return back ? "in" : "cost";
  const incoming = (row.side === "in") !== back;
  if (list === "counted") return incoming ? "in" : "cost";
  return incoming ? "in" : "out";
}

export function cashLineKey(row: Pick<CashLine, "transaction_id" | "part">): string {
  return `${row.transaction_id}:${row.part ?? ""}`;
}

export function CashLineRows({ rows, list, search }: { rows: readonly CashLine[]; list: CashLineList; search: string }) {
  return (
    <List>
      {rows.map((row) => {
        // One project's lines, so the hint names the category; a shared bill's amount is the project's share.
        const hint = [formatDayMonth(row.cash_month_date), row.category_name]
          .filter((part): part is string => part != null && part !== "")
          .join(" · ");
        // FLOW-432: a split line names the parts this list counts, out of the whole line.
        const split = cashLineSplit(row);
        return (
          <ListRow
            key={cashLineKey(row)}
            variant="transaction"
            title={row.supplier_name ?? row.description}
            hint={split == null ? hint : <SplitPartsHint parts={split.parts} total={split.total} date={formatDayMonth(row.cash_month_date)} />}
            wrapHint={split != null}
            agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
            currency={row.currency}
            sign={cashLineSign(list, row)}
            inWord={list === "out" ? "זיכוי" : undefined}
            setAside={list === "kept"}
            source={rowSource(row.source)}
            href={`/transactions/${row.transaction_id}${search}`}
          />
        );
      })}
    </List>
  );
}

/**
 * FLOW-438 (owner, 2026-10-10): a month's lines under its figures, in the project's תנועות rows:
 * newest first, money in green and money out with its minus, and a line the profit leaves out in
 * place, quiet, its hint led by "לא נספר ברווח".
 */
export function CashMonthLines({ counted, kept, search }: { counted: readonly CashLine[]; kept: readonly CashLine[]; search: string }) {
  const rows = [
    ...counted.map((row) => ({ row, keptOut: false })),
    ...kept.map((row) => ({ row, keptOut: true })),
  ].sort((a, b) => (a.row.cash_month_date < b.row.cash_month_date ? 1 : a.row.cash_month_date > b.row.cash_month_date ? -1 : 0));
  return (
    <List>
      {rows.map(({ row, keptOut }) => {
        const date = formatDayMonth(row.cash_month_date);
        const parts = [row.category_name, date].filter((part): part is string => part != null && part !== "");
        const split = keptOut ? null : cashLineSplit(row);
        const incoming = (row.side === "in") !== row.amount_minor < 0n;
        return (
          <ListRow
            key={`${keptOut ? "k" : "c"}:${cashLineKey(row)}`}
            variant="transaction"
            title={row.supplier_name ?? row.description}
            hint={
              keptOut ? <KeptOutHint parts={[NOT_IN_PROFIT_LABEL, ...parts]} />
                : split == null ? parts.join(" · ")
                  : <SplitPartsHint parts={split.parts} total={split.total} date={date} />
            }
            wrapHint={split != null}
            agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
            currency={row.currency}
            sign={incoming ? "in" : "out"}
            setAside={keptOut}
            source={rowSource(row.source)}
            href={`/transactions/${row.transaction_id}${search}`}
          />
        );
      })}
    </List>
  );
}

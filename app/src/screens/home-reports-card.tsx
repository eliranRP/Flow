import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { equityTotal, reportsTo, type BalanceSheet, type Statement } from "../reports";
import { Amount } from "../ui/amount";
import { useOnline } from "../ui/band-states";
import { FailureLine } from "../ui/empty-state";
import { ChevronIcon, DocumentIcon } from "../ui/icons";
import { useBalanceSheet, useStatement } from "../use-reports";

/** A fixture: the two reads as they would come back. */
export type HomeReportsSample = { statement?: Statement; balance?: BalanceSheet };

const YEAR_PNL = { kind: "pnl", period: { kind: "year" }, asOf: { kind: "today" }, scope: { kind: "all" } } as const;
const TODAY_BALANCE = { ...YEAR_PNL, kind: "balance" } as const;

/** A half's figure: the two share one size, stepping down from card size until the longer one fits its half. */
function Figure({ minor, currency, onFit, minStep }: { minor: bigint | null; currency: string; onFit: (step: number) => void; minStep: number }) {
  if (minor == null) return <span className="ui-home-rep-figure ui-home-rep-figure-empty" aria-hidden="true">—</span>;
  return (
    <span className="ui-home-rep-figure">
      <Amount agorot={minor} currency={currency} size="column" loss={minor < 0n} onFit={onFit} minStep={minStep} />
    </span>
  );
}

/**
 * FLOW-161 (board "Option 2 · Home, דוחות card last", owner's pick 2026-10-28): the last card on Home. Two
 * halves open the reports: רווח והפסד with this year's net profit, מאזן with today's equity. A figure is a
 * dash until its read lands; a failed read says so in the foot, with נסו שוב. A `sample` reads nothing.
 */
export function HomeReportsCard({ today, search, sample }: { today: string; search: string; sample?: HomeReportsSample }) {
  const online = useOnline();
  const statementRead = useStatement(YEAR_PNL, today, sample == null);
  const balanceRead = useBalanceSheet(TODAY_BALANCE, today, sample == null);
  const failed = sample == null && ((statementRead.failed && statementRead.data == null) || (balanceRead.failed && balanceRead.data == null));
  const statement = sample?.statement ?? statementRead.data ?? null;
  const balance = sample?.balance ?? balanceRead.data ?? null;
  const pnl = statement?.currencies[0] ?? null;
  const sheet = balance?.currencies[0] ?? null;
  // At 320 a figure such as "$285,000" is wider than its half at card size; both halves step down together.
  const [fits, setFits] = useState<[number, number]>([0, 0]);
  const shared = Math.max(fits[0], fits[1]);
  const fitPnl = useCallback((step: number) => { setFits((held) => (held[0] === step ? held : [step, held[1]])); }, []);
  const fitBalance = useCallback((step: number) => { setFits((held) => (held[1] === step ? held : [held[0], step])); }, []);
  return (
    <section className="ui-home-rep" aria-labelledby="home-rep-title">
      <div className="ui-home-rep-head">
        <span className="ui-home-rep-icon" aria-hidden="true"><DocumentIcon size={22} /></span>
        <h2 id="home-rep-title" className="ui-home-rep-title">דוחות</h2>
      </div>
      <div className="ui-home-rep-halves">
        <Link className="ui-home-rep-half ui-amount-fit m-press" to={reportsTo("pnl", { kind: "all" }, search)}>
          <span className="ui-home-rep-label">
            רווח והפסד
            <ChevronIcon size={16} />
          </span>
          <Figure minor={pnl?.net_minor ?? null} currency={pnl?.currency ?? "ILS"} onFit={fitPnl} minStep={shared} />
          <span className="ui-home-rep-sub">רווח נקי · השנה</span>
        </Link>
        <span className="ui-home-rep-divider" aria-hidden="true" />
        <Link className="ui-home-rep-half ui-amount-fit m-press" to={reportsTo("balance", { kind: "all" }, search)}>
          <span className="ui-home-rep-label">
            מאזן
            <ChevronIcon size={16} />
          </span>
          <Figure minor={sheet == null ? null : equityTotal(sheet)} currency={sheet?.currency ?? "ILS"} onFit={fitBalance} minStep={shared} />
          <span className="ui-home-rep-sub">הון עצמי · היום</span>
        </Link>
      </div>
      {failed ? (
        <FailureLine offline={!online} onRetry={() => { statementRead.refetch(); balanceRead.refetch(); }} />
      ) : (
        <p className="ui-home-rep-foot">תאריכים, פרויקטים, פירוט ושיתוף PDF בתוך הדוח</p>
      )}
    </section>
  );
}

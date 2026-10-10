import type { LoanSplitPart } from "@flow/shared";
import { useId, useState } from "react";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { CalendarIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ShareAmount } from "../ui/share-amount";
import { TextLink } from "../ui/text-link";
import { LOAN_PART_LABEL } from "./loan-copy";
import { loanParts, type LoanCategory, type LoanDetail } from "./loan-detail-data";
import { formatLoanMoney } from "./loan-form";
import { partCategoryHint, partShares, wholeMinor, type LoanOutlook, type PartTotals } from "./loan-outlook";

/**
 * FLOW-434 (owner's pick A): the loan page's תשלומים הבאים page, one year (or the rest of the
 * loan) under it, and the part rows they share with "שולם השנה".
 */

const PART_KEYS = ["interest", "escrow", "principal", "fees"] as const;

/**
 * Each part in whole units, rounded so the parts on screen add up to the rounded total (the
 * part with the largest remainder takes the leftover unit).
 */
export function roundTotals(totals: PartTotals): PartTotals {
  const target = wholeMinor(PART_KEYS.reduce((sum, key) => sum + totals[key], 0n));
  const out: PartTotals = { interest: 0n, escrow: 0n, principal: 0n, fees: 0n };
  for (const key of PART_KEYS) out[key] = (totals[key] / 100n) * 100n;
  let left = target - PART_KEYS.reduce((sum, key) => sum + out[key], 0n);
  for (const key of [...PART_KEYS].sort((a, b) => Number((totals[b] % 100n) - (totals[a] % 100n)))) {
    if (left <= 0n) break;
    out[key] += 100n;
    left -= 100n;
  }
  return out;
}

/** The rounded total, equal to the rounded parts on screen. */
export function periodTotal(totals: PartTotals): bigint {
  const rounded = roundTotals(totals);
  return PART_KEYS.reduce((sum, key) => sum + rounded[key], 0n);
}

/** "תשלום אחד", "2 תשלומים". */
export function paymentsWord(count: number): string {
  return count === 1 ? "תשלום אחד" : `${String(count)} תשלומים`;
}

/** "12 חודשים", or "3 התשלומים האחרונים" near the end. */
export function aheadLabel(count: number): string {
  return count === 12 ? "12 חודשים" : count === 1 ? "התשלום האחרון" : `${String(count)} התשלומים האחרונים`;
}

/**
 * One row per part: its share and amount; with `onOpen`, its category as the hint and a tap that
 * opens its sheet. A part at $0 is left out once anything was paid (design r1).
 */
export function LoanPartRows({ loan, categories, totals, onOpen }: {
  loan: LoanDetail;
  categories: readonly LoanCategory[];
  totals: PartTotals;
  onOpen: ((part: LoanSplitPart) => void) | null;
}) {
  const all = partShares(roundTotals(totals), loanParts(loan));
  const total = all.reduce((sum, item) => sum + item.minor, 0n);
  const shares = total > 0n ? all.filter((item) => item.minor > 0n) : all;
  return (
    <List>
      {shares.map((item) => {
        const money = formatLoanMoney(item.minor, loan.currency);
        const meta = <ShareAmount percent={total > 0n ? item.percent : null}><bdi className="ui-num" dir="ltr">{money}</bdi></ShareAmount>;
        const label = `${LOAN_PART_LABEL[item.part]}, ${money}${total > 0n ? `, ${String(item.percent)}%` : ""}`;
        if (onOpen == null) return <ListRow key={item.part} variant="static" title={LOAN_PART_LABEL[item.part]} meta={meta} label={label} />;
        const hint = partCategoryHint(loan, categories, item.part) ?? undefined;
        return <ListRow key={item.part} variant="button" title={LOAN_PART_LABEL[item.part]} hint={hint} meta={meta} label={label} chevron onClick={() => { onOpen(item.part); }} />;
      })}
    </List>
  );
}

function Figure({ loan, label, minor, meta }: { loan: LoanDetail; label: string; minor: bigint; meta?: string }) {
  return (
    <div className="ui-page-pad ui-loan-next">
      <p className="t-label">{label}</p>
      <p className="t-display"><BigNumber agorot={minor} currency={loan.currency} size="display" /></p>
      {meta == null ? null : <p className="t-meta">{meta}</p>}
    </div>
  );
}

function NoSchedule({ loan, loanPath, search }: { loan: LoanDetail; loanPath: string; search: string }) {
  return (
    <EmptyState
      icon={<CalendarIcon />}
      title="אין לוח תשלומים להלוואה הזו"
      body={loan.kind === "demand" ? "בהלוואה בלי לוח הריבית נצברת כל יום." : "ההלוואה לא פתוחה, או שחסרים בה פרטים."}
      action={<Button variant="pill" to={`${loanPath}${search}`}>לעמוד ההלוואה</Button>}
    />
  );
}

type ViewProps = { loan: LoanDetail; outlook: LoanOutlook | null; back: string; loanPath: string; search: string };

/** Year rows shown before "לכל השנים": this year and the next four. */
export const YEARS_SHOWN = 5;

/** `/settings/loans/:id/future`: the next 12 months split by part, the rest of the loan, then one row per year. */
export function LoanFutureView({ loan, outlook, back, loanPath, search }: ViewProps) {
  const [allYears, setAllYears] = useState(false);
  const yearsId = useId();
  const header = <ScreenHeader title="תשלומים הבאים" kicker={loan.name} backTo={back} />;
  if (outlook == null) return <>{header}<NoSchedule loan={loan} loanPath={loanPath} search={search} /></>;
  const money = (minor: bigint) => <bdi className="ui-num t-amount" dir="ltr">{formatLoanMoney(minor, loan.currency)}</bdi>;
  return (
    <>
      {header}
      <Figure loan={loan} label={outlook.ahead.payments === 12 ? "12 החודשים הבאים" : aheadLabel(outlook.ahead.payments)} minor={periodTotal(outlook.ahead.totals)} />
      <LoanPartRows loan={loan} categories={[]} totals={outlook.ahead.totals} onOpen={null} />
      <List className="ui-loan-more">
        <ListRow variant="item" href={`${loanPath}/future/end${search}`} title="עד סוף ההלוואה" hint={paymentsWord(outlook.toEnd.payments)} meta={money(periodTotal(outlook.toEnd.totals))} chevron />
      </List>
      <SectionHead title="לפי שנה" />
      <div id={yearsId}>
        <List>
          {(allYears ? outlook.years : outlook.years.slice(0, YEARS_SHOWN)).map((item, index) => (
            <ListRow
              key={item.key}
              variant="item"
              href={`${loanPath}/future/${item.key}${search}`}
              title={<bdi className="ui-num" dir="ltr">{item.key}</bdi>}
              label={`${item.key}, ${formatLoanMoney(periodTotal(item.totals), loan.currency)}`}
              hint={item.payments >= 12 ? undefined : index === 0 ? `נותרו ${paymentsWord(item.payments)}` : paymentsWord(item.payments)}
              meta={money(periodTotal(item.totals))}
              chevron
            />
          ))}
        </List>
      </div>
      {allYears || outlook.years.length <= YEARS_SHOWN ? null : (
        <div className="ui-page-pad">
          <TextLink tone="quiet" chevron={false} expanded={false} controls={yearsId} onClick={() => { setAllYears(true); }}>לכל השנים</TextLink>
        </div>
      )}
    </>
  );
}

/** `/settings/loans/:id/future/:period`: one year, or "end" for the rest of the loan, split by part. */
export function LoanPeriodView({ loan, outlook, period, back, loanPath, search }: ViewProps & { period: string }) {
  const shown = outlook == null ? null : period === "end" ? outlook.toEnd : outlook.years.find((item) => item.key === period) ?? null;
  const header = <ScreenHeader title={period === "end" ? "עד סוף ההלוואה" : period} kicker="תשלומים הבאים" backTo={back} />;
  if (outlook == null || shown == null) return <>{header}<NoSchedule loan={loan} loanPath={loanPath} search={search} /></>;
  return (
    <>
      {header}
      <Figure loan={loan} label={period === "end" ? `לתשלום עד ${outlook.endYear}` : "לתשלום בשנה"} minor={periodTotal(shown.totals)} meta={paymentsWord(shown.payments)} />
      <LoanPartRows loan={loan} categories={[]} totals={shown.totals} onOpen={null} />
    </>
  );
}

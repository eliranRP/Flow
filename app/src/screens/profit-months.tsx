import { formatAmountText, type ProfitMonth, type ProfitMonths } from "@flow/shared";
import type { ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { monthPeriod, periodFromSearch, windowLabel, type PeriodChoice } from "../period";
import { withPeriodSearch } from "../project-period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCompanyCurrency } from "../company-currency";
import { useBooks, useProfitMonthsQuery, useProjectQuery } from "../use-books";
import { StatusPill } from "../ui/chip";
import { HEBREW_MONTHS } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { ChartIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";

type MonthCurrency = ProfitMonth["by_currency"][number];

/**
 * The currencies the period has figures in, the company currency first (the server's order). A period with no
 * figures at all falls back to the company's currency, so a USD company never reads ₪0.
 */
export function rangeCurrencies(data: Pick<NonNullable<ProfitMonths>, "by_currency" | "months">, emptyCurrency: string): string[] {
  const used = new Set<string>();
  for (const row of data.by_currency) {
    if (row.income_minor !== 0n || row.expense_minor !== 0n) used.add(row.currency);
  }
  for (const month of data.months) {
    for (const row of month.by_currency) {
      if (row.income_minor !== 0n || row.expense_minor !== 0n) used.add(row.currency);
    }
  }
  const ordered = data.by_currency.map((row) => row.currency).filter((currency) => used.has(currency));
  for (const currency of used) if (!ordered.includes(currency)) ordered.push(currency);
  return ordered.length > 0 ? ordered : [emptyCurrency];
}

/** The month's overhead share in the company currency (0147). An older payload has it in ILS only. */
function monthShare(month: ProfitMonth, baseCurrency: string): bigint | null {
  if (month.overhead_share_minor !== undefined) return month.overhead_share_minor;
  return baseCurrency === "ILS" ? (month.overhead_share_agorot ?? null) : null;
}

/**
 * A month's figures as the row shows them: every currency the period uses, in order, a zero row
 * when the month has none in it. Only the company currency's row takes the overhead share.
 */
function shownCurrencies(month: ProfitMonth, afterOverhead: boolean, currencies: readonly string[], baseCurrency: string): MonthCurrency[] {
  const rows = currencies.map((currency) => month.by_currency.find((row) => row.currency === currency)
    ?? { currency, income_minor: 0n, expense_minor: 0n, profit_minor: 0n });
  const share = monthShare(month, baseCurrency);
  return rows.map((row) => {
    if (row.currency !== baseCurrency || !afterOverhead || month.overhead_weighted !== true || share == null) return row;
    return { ...row, expense_minor: row.expense_minor + share, profit_minor: row.profit_minor - share };
  });
}

function monthWord(key: string): string {
  return HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/** The month name; another year than the newest month's adds the year. */
function monthTitle(key: string, newestYear: string): string {
  const year = key.slice(0, 4);
  return year === newestYear ? monthWord(key) : `${monthWord(key)} ${year}`;
}

function countWords(count: number, one: string, many: string): string {
  return count === 1 ? one : `${String(count)} ${many}`;
}

/**
 * The "לפי חודש" row on the project: "6 חודשים · 2 ברווח, 3 בהפסד, 1 בתהליך". The open month is
 * counted as בתהליך, not as a profit or a loss; a month with no lines is not counted.
 */
export function profitMonthsSummary(data: ProfitMonths | null, emptyCurrency = "ILS"): string | undefined {
  if (data == null) return undefined;
  const total = data.months.length;
  if (total === 0) return "אין חודשים בתקופה הזו";
  let profit = 0;
  let loss = 0;
  let open = 0;
  const currencies = rangeCurrencies(data, emptyCurrency);
  for (const month of data.months) {
    const main = shownCurrencies(month, data.after_overhead === true, currencies, data.base_currency ?? "ILS")[0];
    if (month.open) open += 1;
    else if (main != null && main.profit_minor > 0n) profit += 1;
    else if (main != null && main.profit_minor < 0n) loss += 1;
  }
  const parts = [
    profit > 0 ? `${String(profit)} ברווח` : null,
    loss > 0 ? `${String(loss)} בהפסד` : null,
    open > 0 ? `${String(open)} בתהליך` : null,
  ].filter((part): part is string => part != null);
  const head = countWords(total, "חודש אחד", "חודשים");
  return parts.length === 0 ? head : `${head} · ${parts.join(", ")}`;
}

export type ProfitMonthsSample = { projectName: string; data: NonNullable<ProfitMonths> };

/**
 * The project's months for its period, newest first (profit by period, option A, plan §4). Each
 * row is the month, "נכנס · יצא", and the month's profit; a loss is `bad` with a minus. A tap
 * opens the same project screen with that month as its period. No chart (DESIGN-RULES §5).
 */
export function ProfitMonthsScreen({ sample }: { sample?: ProfitMonthsSample } = {}) {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const books = useBooks();
  const companyCurrency = useCompanyCurrency();
  const period: PeriodChoice = periodFromSearch(new URLSearchParams(location.search)) ?? books.period;
  const months = useProfitMonthsQuery(sample ? "" : projectId, period);
  const project = useProjectQuery(sample ? "" : projectId, period);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, months);
  const data = sample?.data ?? months.data ?? null;
  const projectName = sample?.projectName ?? project.data?.name ?? undefined;
  const afterOverhead = data?.after_overhead === true;
  const baseCurrency = data?.base_currency ?? "ILS";
  const rows = data?.months ?? [];
  const newestYear = rows[0]?.month.slice(0, 4) ?? "";
  const currencies = data == null ? [companyCurrency] : rangeCurrencies(data, data.base_currency ?? companyCurrency);
  const shownTotal = rows.reduce((sum, month) => sum + (shownCurrencies(month, afterOverhead, currencies, baseCurrency)[0]?.profit_minor ?? 0n), 0n);
  const mainCurrency = currencies[0] ?? companyCurrency;
  const subtitle = data == null
    ? undefined
    : `${windowLabel(period, undefined, "project")} · ${shownTotal < 0n ? "הפסד" : "רווח"} ${formatAmountText(shownTotal, mainCurrency)}${afterOverhead ? " · אחרי הוצאות כלליות" : ""}`;
  const projectPath = `/projects/${projectId || (data?.project_id ?? "")}`;
  return (
    <ScreenState
      title="לפי חודש"
      kicker={projectName}
      subtitle={subtitle}
      backTo={`${projectPath}${withPeriodSearch(search, period)}`}
      phase={phase.kind === "ready" && data == null ? { kind: "empty" } : phase}
      onRetry={() => { void months.refetch(); }}
      empty={<EmptyState icon={<ChartIcon />} title="אין חודשים בתקופה הזו" body="חודשים עם הכנסות או הוצאות של הפרויקט יופיעו כאן." />}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<ChartIcon />} title="אין חודשים בתקופה הזו" body="חודשים עם הכנסות או הוצאות של הפרויקט יופיעו כאן." />
      ) : (
        <>
          <List>
            {rows.map((month) => (
              <MonthRow
                key={month.month}
                month={month}
                title={monthTitle(month.month, newestYear)}
                afterOverhead={afterOverhead}
                currencies={currencies}
                baseCurrency={baseCurrency}
                href={`${projectPath}${withPeriodSearch(search, monthPeriod(month.month))}`}
              />
            ))}
          </List>
          <p className="ui-page-pad t-hint ui-months-note">הקשה על חודש פותחת את הפרויקט עם החודש הזה, והתנועות שלו מתחת לסיכום.</p>
        </>
      )}
    </ScreenState>
  );
}

function MonthRow({ month, title, afterOverhead, currencies: rangeShown, baseCurrency, href }: { month: ProfitMonth; title: string; afterOverhead: boolean; currencies: readonly string[]; baseCurrency: string; href: string }) {
  const currencies = shownCurrencies(month, afterOverhead, rangeShown, baseCurrency);
  const main = currencies[0];
  const profit = main?.profit_minor ?? 0n;
  const loss = profit < 0n;
  // A month with no project income has no overhead share: its figure is before overhead (0129).
  const beforeOverhead = afterOverhead && month.overhead_weighted !== true;
  const hint: ReactNode = (
    <>
      {currencies.map((row, index) => (
        <span key={row.currency}>
          {index > 0 ? " · " : null}
          נכנס{" "}
          <bdi dir="ltr" className={row.income_minor > 0n ? "ui-num ui-income" : "ui-num"}>{formatAmountText(row.income_minor, row.currency)}</bdi>
          {" · "}יצא{" "}
          <bdi dir="ltr" className="ui-num">{formatAmountText(row.expense_minor < 0n ? -row.expense_minor : row.expense_minor, row.currency)}</bdi>
        </span>
      ))}
      {beforeOverhead ? " · לפני הוצאות כלליות" : null}
    </>
  );
  const label = [
    title,
    month.open ? "בתהליך" : null,
    ...currencies.map((row) => `${row.profit_minor < 0n ? "הפסד" : "רווח"} ${formatAmountText(row.profit_minor, row.currency)}, נכנס ${formatAmountText(row.income_minor, row.currency)}, יצא ${formatAmountText(row.expense_minor < 0n ? -row.expense_minor : row.expense_minor, row.currency)}`),
    beforeOverhead ? "לפני הוצאות כלליות" : null,
  ].filter((part): part is string => part != null).join(", ");
  return (
    <ListRow
      variant="project"
      title={title}
      tag={month.open ? <StatusPill>בתהליך</StatusPill> : undefined}
      hint={hint}
      wrapHint
      label={label}
      agorot={profit}
      currency={main?.currency ?? "ILS"}
      amounts={currencies.length > 1 ? currencies.map((row) => ({ minor: row.profit_minor, currency: row.currency })) : undefined}
      loss={loss}
      chevron
      href={href}
    />
  );
}

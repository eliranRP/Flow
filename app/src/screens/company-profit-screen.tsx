import { formatAmountText } from "@flow/shared";
import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { onlineManager } from "@tanstack/react-query";
import { lineDayTitle, lineInitials } from "../cash-lines-groups";
import { useCompanyCurrency } from "../company-currency";
import { homeMonthKey, homeMonthPath } from "../home-month";
import { customRange, monthPeriod } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { HEBREW_MONTHS, israelToday } from "../ui/date-math";
import { Amount } from "../ui/amount";
import { Card } from "../ui/card";
import { Chip } from "../ui/chip";
import { List, ListRow } from "../ui/list-row";
import type { ScreenPhase } from "../ui/screen-phase";
import { ScreenHeader } from "../ui/screen-header";
import { ProfitSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { rowSource } from "../ui/line-marks";
import { BASIS_PROFIT_COPY, basisChoiceLabel } from "../ui/company-choices";
import { buildProfitModel, useCompanyProfitRead, type ProfitInputs, type ProfitLine, type ProfitModel } from "../use-company-profit";
import { CompanyBasisSheet } from "./company-basis-sheet";
import { countWord, ProfitCategories, profitCategoryGroups, type ProfitCategoryGroup } from "./profit-categories";
import { useBlockedPreview } from "./screen-shared";

/** A fixture: the reads' inputs for the page, plus the day heads' today and the month it shows. */
export type CompanyProfitSample = ProfitInputs & { today: string; monthKey: string; openFirst?: boolean; sheetOpen?: boolean };

const ORDERS = [
  { value: "project", label: "לפי פרויקט" },
  { value: "category", label: "לפי קטגוריה" },
  { value: "date", label: "לפי תאריך" },
  { value: "amount", label: "לפי סכום" },
] as const;
type Order = (typeof ORDERS)[number]["value"];

/** The order in the URL (`?by=`). Project is the absent value. */
function orderOf(value: string | null): Order {
  return value === "category" || value === "date" || value === "amount" ? value : "project";
}

/** A signed figure as text: a plus on money in, a minus on money out (or a loss). */
function signedText(minor: bigint, currency: string): string {
  if (minor === 0n) return formatAmountText(0n, currency);
  return minor < 0n ? `−${formatAmountText(-minor, currency)}` : `+${formatAmountText(minor, currency)}`;
}

/** `dd/mm` of an ISO date. */
function dayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** A project's page with its `from` back to this page, keeping the preview flag. */
function projectProfitPath(projectId: string, search: string): string {
  return `/projects/${projectId}/profit?from=profit${search === "" ? "" : `&${search.slice(1)}`}`;
}

/** The biggest amount first, by its size (a refund counts by its size too). */
function bySizeOnly(a: ProfitLine, b: ProfitLine): number {
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const diff = abs(b.amount) - abs(a.amount);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

/** Lines newest first, then the biggest first within a day. */
function byDateThenSize(a: ProfitLine, b: ProfitLine): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return bySizeOnly(a, b);
}

/** The month's categories as the board's two groups; a category's lines come newest first. */
function companyCategoryGroups(model: ProfitModel): ProfitCategoryGroup<ProfitLine>[] {
  const inputs = (direction: "income" | "expense") => model.categories
    .filter((row) => row.direction === direction)
    .map((row) => ({
      key: row.key,
      name: row.name,
      total: direction === "income" ? row.amount : -row.amount,
      count: row.count,
      projects: row.projects,
      lines: model.lines.filter((line) => line.direction === direction && line.categoryKey === row.key).sort(byDateThenSize),
    }));
  return profitCategoryGroups(inputs("income"), inputs("expense"));
}

/**
 * The company's profit page (FLOW-140c1, board Profit and ProfitBasis): the month's profit with income
 * and counted expenses, the year to date, then the rows in the order `?by=` picks (project, category,
 * date or amount), and the basis sheet. `sample` is the dev fixture; otherwise the page reads the books.
 */
export function CompanyProfitScreen({ sample }: { sample?: CompanyProfitSample } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const blocked = useBlockedPreview();
  const companyCurrency = useCompanyCurrency();
  const by = orderOf(params.get("by"));
  const today = sample?.today ?? israelToday();
  const currentKey = today.slice(0, 7);
  // Home's ?month= picks an earlier month; its year to date then ends with that month.
  const monthKey = sample?.monthKey ?? homeMonthKey(location.search, today, null);
  const year = monthKey.slice(0, 4);
  const month = monthPeriod(monthKey);
  const live = useCompanyProfitRead({
    enabled: sample == null,
    month,
    ytd: customRange(`${year}-01-01`, month.to ?? today),
    currency: companyCurrency,
    linesOn: by !== "project",
  });
  const model: ProfitModel | null = sample ? buildProfitModel(sample) : live.model;
  const phase: ScreenPhase = sample != null ? { kind: "ready" } : preview !== "off" ? screenPhase(preview) : live.failed ? { kind: "error", offline: !onlineManager.isOnline() } : model == null ? { kind: "loading" } : { kind: "ready" };
  const [sheetState, setSheetOpen] = useState<boolean | undefined>(undefined);
  const basisRef = useRef<HTMLButtonElement>(null);
  const back = homeMonthPath(monthKey, search, currentKey);
  if (phase.kind !== "ready" || model == null) {
    // The board's loading frame names the month in the title: the stacked header's own bar, Back labelled בית.
    return <ScreenState stacked headerClassName="ui-state-header" title={phase.kind === "loading" ? `רווח ${HEBREW_MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey}` : "רווח"} kicker="בית" backTo={back} phase={phase} onRetry={live.refetch} loading={<ProfitSkeleton />} />;
  }
  const currency = model.currency;
  const sheetOpen = sheetState ?? sample?.sheetOpen === true;
  const setBy = (next: Order) => {
    const nextParams = new URLSearchParams(location.search);
    if (next === "project") nextParams.delete("by");
    else nextParams.set("by", next);
    const text = nextParams.toString();
    void navigate({ pathname: location.pathname, search: text === "" ? "" : `?${text}` }, { replace: true });
  };
  const chips = (
    <div className="ui-cp-chips" role="group" aria-label="סידור">
      {ORDERS.map((option) => (
        <Chip key={option.value} pressed={by === option.value} onClick={() => { setBy(option.value); }}>{option.label}</Chip>
      ))}
    </div>
  );
  const profit = model.profit;
  // The bars scale to the larger of the two figures.
  const largest = model.income > model.expense ? model.income : model.expense;
  const widthOf = (value: bigint) => (largest <= 0n ? 0 : Number((value * 1000n) / largest) / 10);
  const incomeWidth = widthOf(model.income);
  const expenseWidth = widthOf(model.expense);
  const subtitle = `${HEBREW_MONTHS[Number(monthKey.slice(5, 7)) - 1] ?? monthKey} ${year} · ${monthKey === currentKey ? "עד היום" : "חודש סגור"}`;
  const figure = (
    <p className="ui-cp-figure">
      <Amount agorot={profit} currency={currency} size="display" loss={profit < 0n} direction={profit > 0n ? "income" : undefined} />
    </p>
  );
  const ytdLine = model.ytdProfit == null ? null : (
    <p className="ui-cp-ytd t-caption t-muted">מתחילת השנה <bdi dir="ltr">{signedText(model.ytdProfit, currency)}</bdi></p>
  );
  const summary = (
    <Card className="ui-cp-card">
      <div className="ui-cp-bar-row">
        <div className="ui-cp-bar-top"><span className="ui-pp-label">הכנסות</span><Amount agorot={model.income} currency={currency} income /></div>
        <span className="ui-pp-bar"><span className="ui-cp-bar-income" style={{ width: `${String(incomeWidth)}%` }} /></span>
      </div>
      <div className="ui-cp-bar-row">
        <div className="ui-cp-bar-top"><span className="ui-pp-label">הוצאות שנספרות ברווח</span><Amount agorot={model.expense} currency={currency} /></div>
        <span className="ui-pp-bar"><span className="ui-cp-bar-expense" style={{ width: `${String(expenseWidth)}%` }} /></span>
      </div>
    </Card>
  );
  const lineRow = (line: ProfitLine, hint: string) => (
    <ListRow
      key={line.id}
      layout="flat"
      variant="transaction"
      title={line.title}
      hint={hint}
      agorot={line.amount < 0n ? -line.amount : line.amount}
      currency={currency}
      sign={line.direction === "income" ? "in" : "cost"}
      source={rowSource(line.source)}
      initials={lineInitials(line.title)}
      href={`/transactions/${line.transactionId}${search}`}
    />
  );
  let body: ReactNode;
  if (by === "project") {
    body = (
      <List layout="flat" className="ui-cp-list">
        {model.projects.map((row) => {
          const content = (
            <>
              <span className="ui-cp-top">
                <span className="ui-cp-name">{row.name}</span>
                <Amount agorot={row.profit} currency={currency} loss={row.profit < 0n} direction={row.profit > 0n ? "income" : undefined} />
              </span>
              <span className="ui-cp-meta t-caption t-muted">{countWord(row.count)}</span>
            </>
          );
          return (
            <li key={row.key} className="ui-cp-row">
              {row.shared || row.key === "" ? <div className="ui-cp-link">{content}</div> : <Link className="ui-cp-link" to={projectProfitPath(row.key, search)}>{content}</Link>}
            </li>
          );
        })}
      </List>
    );
  } else if (by === "category") {
    const groups = companyCategoryGroups(model);
    const firstOpen = sample?.openFirst === true ? groups[0]?.categories[0]?.key ?? null : null;
    body = (
      <ProfitCategories
        groups={groups}
        currency={currency}
        initialOpen={firstOpen}
        renderLine={(line) => lineRow(line, `${dayMonth(line.date)} · ${line.project ?? "בלי פרויקט"}`)}
      />
    );
  } else {
    const sorted = [...model.lines].sort(byDateThenSize);
    const groups: Array<{ key: string; title: string; sum: bigint | null; lines: ProfitLine[] }> = by === "amount"
      ? [{ key: "amount", title: "מהגדול לקטן", sum: null, lines: [...model.lines].sort(bySizeOnly) }]
      : [...new Set(sorted.map((line) => line.date))].map((date) => {
          const lines = sorted.filter((line) => line.date === date);
          return { key: date, title: lineDayTitle(date, today), sum: lines.reduce((acc, line) => acc + line.amount, 0n), lines };
        });
    body = (
      <>
        {groups.map((group) => (
          <section key={group.key} className="ui-lines-group" aria-label={group.title}>
            <div className="ui-lines-group-head">
              <h2 className="t-section ui-lines-group-title">{group.title}</h2>
              {group.sum != null ? (
                <bdi className="t-line2 ui-lines-group-sum" dir="ltr" style={group.sum < 0n ? { color: "var(--color-signal)" } : undefined}>{signedText(group.sum, currency)}</bdi>
              ) : (
                <span className="t-caption t-muted">{countWord(group.lines.length)}</span>
              )}
            </div>
            <List layout="flat" className="ui-cp-list">
              {group.lines.map((line) => lineRow(line, by === "amount" ? `${dayMonth(line.date)} · ${line.project ?? "בלי פרויקט"}` : [line.project ?? "בלי פרויקט", line.category].join(" · ")))}
            </List>
          </section>
        ))}
      </>
    );
  }
  return (
    <div className="ui-cp-screen">
      <ScreenHeader
        layout="stacked"
        title="רווח"
        backTo={back}
        backText="בית"
        subtitle={subtitle}
        compactFigure={signedText(profit, currency)}
        panel={chips}
        below={<div className="ui-cp-head">{figure}{ytdLine}{summary}{chips}</div>}
      />
      {body}
      <p className="ui-cp-foot t-caption t-muted">לא נספר ברווח: קנייה ושיפוץ של נכס, קרן של הלוואות, הון בעלים והעברות בין חשבונות.</p>
      <button type="button" ref={basisRef} className="ui-cp-basis" onClick={() => { setSheetOpen(true); }}>
        נספר לפי {basisChoiceLabel(model.basis)} · <span className="ui-cp-change">שינוי</span>
      </button>
      <CompanyBasisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        basis={model.basis}
        blocked={() => blocked(sample != null ? "empty" : undefined)}
        returnFocusRef={basisRef}
        copy={BASIS_PROFIT_COPY}
      />
    </div>
  );
}

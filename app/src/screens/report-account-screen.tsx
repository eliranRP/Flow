import "../ui/lazy.css";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { lineInitials } from "../cash-lines-groups";
import { getSupabase } from "../lib/supabase";
import { loadReadSchemas } from "../load-read-schemas";
import { useHomePreview, usePreviewSearch } from "../preview";
import type { AccountLines } from "../report-schemas";
import { accountName, balanceDate, ltr, reportStateOf } from "../reports";
import { Amount, formatAmount } from "../ui/amount";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { formatDisplay, HEBREW_MONTHS, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { ChevronIcon, DocumentIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { LOAN_PART_LABEL, type LoanPartKey } from "../ui/loan-part-terms";
import { ScreenHeader } from "../ui/screen-header";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { SegmentedControl } from "../ui/segmented-control";
import { DelayedSkeleton } from "../ui/skeleton";
import { waitForAccessToken } from "../wait-for-session";
import { linesByMonth } from "./report-lines-screen";
import { ReportRow, ReportSection, ReportSummary } from "./reports-parts";

type AccountRow = AccountLines["rows"][number];

/** A fixture: the read's first page as it would come back (null: the account is not found; none: loading). */
export type ReportAccountSample = { today: string; page?: AccountLines | null; failed?: boolean; offlineSince?: number };

const PAGE = 50;
const TYPE_LABEL: Record<AccountLines["type"], string> = { asset: "נכס", liability: "התחייבות", equity: "הון" };

/** FLOW-171: the movements' period: the as-of date's year (the default), or the account's whole history (`span=all`). */
type Span = "year" | "all";

/** What the page shows, from its query string: the reports screen's date and project, the account, currency and period. */
function accountArgs(params: URLSearchParams, today: string) {
  const state = reportStateOf(params);
  const currency = params.get("cur") ?? "";
  const span: Span = params.get("span") === "all" ? "all" : "year";
  return {
    accountId: params.get("account") ?? "",
    asOf: balanceDate(state.asOf, today),
    projectId: state.scope.kind === "project" ? state.scope.id : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    span,
  };
}

async function fetchPage(args: ReturnType<typeof accountArgs>, offset: number): Promise<AccountLines | null> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  const { data, error } = await supabase.rpc("get_account_lines", {
    p_account_id: args.accountId,
    p_as_of: args.asOf,
    ...(args.projectId != null ? { p_project_id: args.projectId } : {}),
    ...(args.currency != null ? { p_currency: args.currency } : {}),
    ...(args.span === "all" ? { p_from_start: true } : {}),
    p_limit: PAGE,
    p_offset: offset,
  });
  if (error) throw error;
  return (await loadReadSchemas()).accountLinesSchema.parse(data);
}

/** A movement's title: its party, else its description. */
function rowTitle(row: AccountRow): string {
  return row.party_name ?? row.description ?? "תנועה";
}

/** The hint's parts, each whole or dropped at the end: the loan part first (so a narrow row keeps it), the date, the project. */
function rowHint(row: AccountRow): string[] {
  const part = row.part != null && row.part in LOAN_PART_LABEL ? LOAN_PART_LABEL[row.part as LoanPartKey] : null;
  const day = `${row.doc_date.slice(8, 10)}/${row.doc_date.slice(5, 7)}`;
  return [part, day, row.project_name].filter((item): item is string => item != null);
}

/** The whole payment, on its own line, when the account holds only part of the line. */
function rowWhole(row: AccountRow): ReactNode {
  const abs = (value: bigint) => (value < 0n ? -value : value);
  if (row.line_amount_minor === 0n || abs(row.line_amount_minor) === abs(row.amount_minor)) return null;
  return <>{"מתוך תשלום "}<bdi dir="ltr">{formatAmount(abs(row.line_amount_minor), "summary", row.currency)}</bdi></>;
}

/** The loan page a principal account opens: its one loan, or the loans list when it holds several. */
function loanLink(page: AccountLines, search: string): { href: string; label: string } | null {
  const principal = page.is_system && page.name === "Loan principal";
  const [only] = page.loan_ids;
  if (page.loan_ids.length === 1 && only != null) return { href: `/loans/${only}${search}`, label: "לדף ההלוואה" };
  if (page.loan_ids.length > 1 || principal) return { href: `/loans${search}`, label: "להלוואות" };
  return null;
}

type MonthGroup = ReturnType<typeof linesByMonth<AccountRow>>[number];

/** FLOW-171: from the start, the month groups under a heading per year, newest first. */
function groupsByYear(groups: MonthGroup[]): { year: string; count: number; months: MonthGroup[] }[] {
  const years: { year: string; count: number; months: MonthGroup[] }[] = [];
  for (const group of groups) {
    const year = group.key.slice(0, 4);
    const last = years.at(-1);
    if (last?.year === year) {
      last.months.push(group);
      last.count += group.rows.length;
    } else {
      years.push({ year, count: group.rows.length, months: [group] });
    }
  }
  return years;
}

function movesLabel(count: number, principal: boolean): string | undefined {
  if (count === 0) return undefined;
  if (count === 1) return principal ? "תשלום אחד" : "תנועה אחת";
  return `${String(count)} ${principal ? "תשלומים" : "תנועות"}`;
}

/** One month's movements; from the start its heading is the month alone, under its year's heading. */
function MonthMoves({ group, search, inYear }: { group: MonthGroup; search: string; inYear: boolean }) {
  const Heading = inYear ? "h3" : "h2";
  return (
    <section className="ui-lines-group" aria-label={group.title}>
      <div className="ui-lines-group-head">
        <Heading className="t-section ui-lines-group-title">{inYear ? (HEBREW_MONTHS[Number(group.key.slice(5, 7)) - 1] ?? group.title) : group.title}</Heading>
      </div>
      <List layout="flat">
        {group.rows.map((row) => (
          <ListRow
            key={`${row.transaction_id}:${row.currency}`}
            layout="flat"
            variant="transaction"
            title={rowTitle(row)}
            hintParts={rowHint(row)}
            tagLine={rowWhole(row)}
            agorot={row.amount_minor}
            currency={row.currency}
            sign="moved-in"
            wholeCents
            source="bank"
            initials={lineInitials(row.party_name ?? row.description ?? "")}
            href={`/transactions/${row.transaction_id}${search}`}
          />
        ))}
      </List>
    </section>
  );
}

/**
 * FLOW-165 (board ReportAccountDrill): one balance-sheet account from the reports screen: its balance on the
 * report's date, the opening balance on 1 January, the year's movement and its movements by month, each
 * opening the transaction page. A loan's principal links its loan page. FLOW-171: a period choice beside the
 * movements, the year or from the start (`span=all`: no opening, every movement under a heading per year).
 */
export function ReportAccountScreen({ sample }: { sample?: ReportAccountSample } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const online = useOnline();
  const today = sample?.today ?? israelToday();
  const params = new URLSearchParams(location.search);
  const args = accountArgs(params, today);
  const [open, setOpen] = useState(true);
  const read = useInfiniteQuery({
    queryKey: ["balance-sheet", "account-lines", preview, args.accountId, args.asOf, args.projectId ?? "", args.currency ?? "", args.span],
    enabled: sample == null && preview === "off",
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage(args, pageParam),
    getNextPageParam: (last, pages) => (last?.has_more === true ? pages.length * PAGE : undefined),
  });
  const pages = sample != null ? (sample.page === undefined ? undefined : [sample.page]) : read.data?.pages;
  const first = pages?.[0];
  // Back to the balance sheet with its own choices; the account's keys stay here.
  const backParams = new URLSearchParams(params);
  backParams.delete("account");
  backParams.delete("cur");
  backParams.delete("span");
  const back = `/reports${backParams.size > 0 ? `?${backParams.toString()}` : ""}`;
  const title = first != null ? accountName(first) : "חשבון";
  const header = <ScreenHeader layout="stacked" title={title} backTo={back} backText="דוחות" />;
  if (first === undefined) {
    return (
      <div className="ui-rep-screen">
        {header}
        {(sample?.failed ?? read.isError) ? <PageLoadFailed title="החשבון לא נטען" offline={!online} onRetry={() => { void read.refetch(); }} /> : <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>}
      </div>
    );
  }
  if (first === null) {
    return (
      <div className="ui-rep-screen">
        {header}
        <EmptyState icon={<DocumentIcon size={28} />} title="החשבון לא נמצא" body="ייתכן שאוחד לחשבון אחר או שהוא שייך לחברה אחרת." action={<Button variant="secondary" to={back}>חזרה למאזן</Button>} />
      </div>
    );
  }
  const rows = (pages ?? []).flatMap((page) => page?.rows ?? []);
  const summary = first.currencies.find((item) => item.currency === args.currency) ?? first.currencies[0];
  const currency = summary?.currency ?? args.currency ?? "ILS";
  const balance = summary?.balance_minor ?? 0n;
  const count = summary?.count ?? rows.length;
  const hasMore = sample != null ? sample.page?.has_more === true : read.hasNextPage;
  const loan = loanLink(first, search);
  const principal = first.is_system && first.name === "Loan principal";
  const all = first.from_start;
  const year = first.as_of.slice(0, 4);
  const thisYear = year === today.slice(0, 4);
  const from = first.from ?? `${year}-01-01`;
  const opening = `${String(Number(from.slice(8, 10)))}/${String(Number(from.slice(5, 7)))}/${from.slice(0, 4)}`;
  const changeLabel = all ? "שינוי מההתחלה" : thisYear ? (principal ? "שולם השנה" : "שינוי השנה") : `${principal ? "שולם" : "שינוי"} ב־${year}`;
  const pickSpan = (span: Span) => {
    if (span === args.span) return;
    const next = new URLSearchParams(params);
    if (span === "all") next.set("span", "all");
    else next.delete("span");
    // In the URL, so Back from a movement comes back to the same period; a replace, as the reports' own choices.
    void navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true });
  };
  const months = linesByMonth(rows);
  const when = first.as_of === today ? "יתרה היום" : `יתרה ב־${ltr(formatDisplay(first.as_of))}`;
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (read.dataUpdatedAt || null) : null;
  return (
    <div className="ui-rep-screen">
      {header}
      <div className="ui-rep-content">
        <ReportSummary label={when} amount={balance} currency={currency} loss={false} sub={[TYPE_LABEL[first.type], first.project_name].filter(Boolean).join(" · ")} />
        {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
        <div className="ui-rep-account-span">
          <SegmentedControl<Span>
            label="תקופה"
            showLabel={false}
            radius="input"
            value={args.span}
            onChange={pickSpan}
            options={[{ value: "year", label: thisYear ? "השנה" : year, numeric: !thisYear, name: thisYear ? undefined : `שנת ${year}` }, { value: "all", label: "מההתחלה" }]}
          />
        </div>
        <ul className="ui-rep-rows">
          {all ? null : <ReportRow name={`יתרה ב־${ltr(opening)}`} amount={<Amount agorot={summary?.opening_minor ?? 0n} currency={currency} />} />}
          <ReportRow
            name={changeLabel}
            meta={movesLabel(count, principal && !all)}
            amount={<Amount agorot={summary?.movement_minor ?? 0n} currency={currency} />}
          />
        </ul>
        <ReportSection id="moves" title="תנועות" total={count > 0 ? <span className="t-muted">{String(count)}</span> : null} collapse={{ isOpen: () => open, onToggle: () => { setOpen((value) => !value); } }}>
          {rows.length === 0 ? <p className="ui-rep-note">{all ? "אין תנועות בחשבון." : `אין תנועות מתחילת ${year}.`}</p> : null}
          {all
            ? groupsByYear(months).map((item) => (
                <section key={item.year} className="ui-rep-account-year" aria-label={item.year}>
                  <div className="ui-rep-account-year-head">
                    <h2 className="t-section ui-rep-account-year-title"><bdi dir="ltr">{item.year}</bdi></h2>
                    <span className="ui-rep-account-year-count">{movesLabel(item.count, false)}</span>
                  </div>
                  {item.months.map((group) => <MonthMoves key={group.key} group={group} search={search} inYear />)}
                </section>
              ))
            : months.map((group) => <MonthMoves key={group.key} group={group} search={search} inYear={false} />)}
          {hasMore ? (
            <div className="ui-rep-more-wrap">
              <Button variant="secondary" busy={read.isFetchingNextPage} onClick={() => { void read.fetchNextPage(); }}>
                {count > rows.length ? `עוד ${String(count - rows.length)} תנועות` : "עוד תנועות"}
              </Button>
            </div>
          ) : null}
        </ReportSection>
        {loan != null ? (
          <Link className="ui-rep-more m-press" to={loan.href}>
            {loan.label}
            <ChevronIcon size={16} />
          </Link>
        ) : null}
        <p className="ui-rep-note">דוח ניהולי, לא דוח כספי מבוקר.</p>
      </div>
    </div>
  );
}

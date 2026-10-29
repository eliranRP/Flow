import "../ui/lazy.css";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { lineInitials } from "../cash-lines-groups";
import { getSupabase } from "../lib/supabase";
import { loadReadSchemas } from "../load-read-schemas";
import { useHomePreview, usePreviewSearch } from "../preview";
import type { AccountLines } from "../report-schemas";
import { accountName, balanceDate, ltr, reportStateOf } from "../reports";
import { Amount, formatAmount } from "../ui/amount";
import { BandOfflineLine, PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { formatDisplay, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { ChevronIcon, DocumentIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { LOAN_PART_LABEL, type LoanPartKey } from "../ui/loan-part-terms";
import { ScreenHeader } from "../ui/screen-header";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { waitForAccessToken } from "../wait-for-session";
import { linesByMonth } from "./report-lines-screen";
import { ReportRow, ReportSection, ReportSummary } from "./reports-parts";

type AccountRow = AccountLines["rows"][number];

/** A fixture: the read's first page as it would come back (null: the account is not found; none: loading). */
export type ReportAccountSample = { today: string; page?: AccountLines | null; failed?: boolean; offlineSince?: number };

const PAGE = 50;
const TYPE_LABEL: Record<AccountLines["type"], string> = { asset: "נכס", liability: "התחייבות", equity: "הון" };

/** What the page shows, from its query string: the reports screen's date and project, the account and currency. */
function accountArgs(params: URLSearchParams, today: string) {
  const state = reportStateOf(params);
  const currency = params.get("cur") ?? "";
  return {
    accountId: params.get("account") ?? "",
    asOf: balanceDate(state.asOf, today),
    projectId: state.scope.kind === "project" ? state.scope.id : null,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
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

/**
 * FLOW-165 (board ReportAccountDrill): one balance-sheet account from the reports screen: its balance on the
 * report's date, the opening balance on 1 January, the year's movement and its movements by month, each
 * opening the transaction page. A loan's principal links its loan page.
 */
export function ReportAccountScreen({ sample }: { sample?: ReportAccountSample } = {}) {
  const location = useLocation();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const online = useOnline();
  const today = sample?.today ?? israelToday();
  const params = new URLSearchParams(location.search);
  const args = accountArgs(params, today);
  const [open, setOpen] = useState(true);
  const read = useInfiniteQuery({
    queryKey: ["balance-sheet", "account-lines", preview, args.accountId, args.asOf, args.projectId ?? "", args.currency ?? ""],
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
  const year = first.year_start.slice(0, 4);
  const opening = `${String(Number(first.year_start.slice(8, 10)))}/${String(Number(first.year_start.slice(5, 7)))}/${year}`;
  const when = first.as_of === today ? "יתרה היום" : `יתרה ב־${ltr(formatDisplay(first.as_of))}`;
  const offlineSince = sample != null ? (sample.offlineSince ?? null) : !online && preview === "off" ? (read.dataUpdatedAt || null) : null;
  return (
    <div className="ui-rep-screen">
      {header}
      <div className="ui-rep-content">
        <ReportSummary label={when} amount={balance} currency={currency} loss={false} sub={[TYPE_LABEL[first.type], first.project_name].filter(Boolean).join(" · ")} />
        {offlineSince == null ? null : <BandOfflineLine since={offlineSince} onPage />}
        <ul className="ui-rep-rows">
          <ReportRow name={`יתרה ב־${ltr(opening)}`} amount={<Amount agorot={summary?.opening_minor ?? 0n} currency={currency} />} />
          <ReportRow
            name={principal ? "שולם השנה" : "שינוי השנה"}
            meta={count === 0 ? undefined : count === 1 ? (principal ? "תשלום אחד" : "תנועה אחת") : `${String(count)} ${principal ? "תשלומים" : "תנועות"}`}
            amount={<Amount agorot={summary?.movement_minor ?? 0n} currency={currency} />}
          />
        </ul>
        <ReportSection id="moves" title="תנועות" total={count > 0 ? <span className="t-muted">{String(count)}</span> : null} collapse={{ isOpen: () => open, onToggle: () => { setOpen((value) => !value); } }}>
          {rows.length === 0 ? <p className="ui-rep-note">{`אין תנועות מתחילת ${year}.`}</p> : null}
          {linesByMonth(rows).map((group) => (
            <section key={group.key} className="ui-lines-group" aria-label={group.title}>
              <div className="ui-lines-group-head">
                <h2 className="t-section ui-lines-group-title">{group.title}</h2>
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
          ))}
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

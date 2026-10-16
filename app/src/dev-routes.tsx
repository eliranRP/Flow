import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { type Dashboard, type ProjectsCashMonth, type TransactionDetail } from "@flow/shared";
import { defaultPeriod } from "./period";
import { useHomePreview } from "./preview";
import { transactionQueryOptions } from "./use-books";
export { DevTxnList, DevTxnPagedList } from "./dev/txn-lists";
export { DevExpense, DevProject, DevProjectCategory } from "./dev-routes-projects";
import type { LineSplitRead } from "./line-split";
import { SAMPLE_ASSISTANT_SECRET as assistantSampleSecret } from "./assistant-sample";
import { InstallScreen, type InstallMode } from "./ui/install-screen";
import { ChangeAssignment } from "./ui/change-sheet";
import { BackButton, useGoBack } from "./ui/back";
import { BandCompany } from "./ui/top-band";
import { Button } from "./ui/button";
import { ActionBar, ActionBarRow } from "./ui/action-bar";
import { CheckIcon } from "./ui/icons";
import { ProgressBar } from "./ui/progress-bar";
import { ReviewCard } from "./ui/review-card";
import { ScreenHeader } from "./ui/screen-header";
import { useToast } from "./ui/toast";
import { attentionRows, CashEmptyHome, CashHome, HomeBooks } from "./screens/HomeScreen";
import { chargeChangeViews } from "./forecast";
import { CashLinesScreen } from "./screens/cash-lines-screen";
import { CashMonthScreen } from "./screens/cash-screens";
import { sampleCashLines, sampleCashMonths, sampleCashToDay, sampleCashUsdLoss, sampleCashUsdToDay, sampleCashUsdYear, sampleCashYearMonths, sampleCashYears } from "./dev/cash-sample";
import { cash as devCash, investment as devInvestment, project as devProject } from "./dev/project-cash-sample";
import { CashHistoryScreen, CashYearScreen } from "./screens/cash-history";
import { cashMonthKey } from "./cash";
import {
  CategoriesScreen,
  ConnectionsScreen,
  DEV_FILED_ROWS,
  LoansScreen,
  ReviewQueue,
  FiledTodayScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  SettingsScreen,
  SplitScreen,
  TransactionScreen,
  UnpaidScreen,
} from "./screens/flow-screens";
import { ProfitMonthsScreen } from "./screens/profit-months";
import { LoanDetailScreen, type LoanView } from "./screens/loan-detail-screen";
import { useMemoryLoanStore } from "./screens/loan-detail-store";
import { devLoanStore, resetDevLoanStore, SAMPLE_LOAN_PROJECTS } from "./dev/loan-detail-sample";
import { MissingBillsScreen } from "./screens/missing-bills-screen";
import { SAMPLE_EXPECTED, SAMPLE_EXPECTED_EMPTY, SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME, SAMPLE_MISSING_RENAMED, SAMPLE_RECURRING_CHANGES, SAMPLE_RECURRING_THIS_MONTH } from "./forecast-sample";

const devReviewItems = [
  {
    id: "1",
    supplier: "חומרי בניין לדוגמה בע״מ",
    project: "שיפוץ הרצל 12",
    category: "חומרים",
    netAgorot: -1_600_000n,
  },
  {
    id: "2",
    supplier: "הובלות לדוגמה",
    project: "וילה רעננה",
    category: "הובלה",
    netAgorot: -400_000n,
  },
];

/** The saved rows, in a node outside React so they stay readable after the screen leaves. */
function splitSavedNode(): HTMLElement {
  let node = document.getElementById("e2e-split-saved");
  if (node == null) {
    node = document.createElement("div");
    node.id = "e2e-split-saved";
    node.hidden = true;
    document.body.append(node);
  }
  return node;
}

export function DevSplit() {
  const [params] = useSearchParams();
  const fail = params.get("save") === "fail";
  useEffect(() => {
    splitSavedNode().textContent = "";
  }, []);
  return (
    <SplitScreen
      sampleAmount={1001n}
      sampleProjects={[
        { id: "a", name: "שיפוץ הרצל 12" },
        { id: "b", name: "שיפוץ דירה ביאליק 8 חולון" },
        { id: "c", name: "פרגולה בית כהן" },
      ]}
      onSave={(rows) => {
        if (fail) throw new Error("save");
        splitSavedNode().textContent = JSON.stringify(rows);
        return undefined;
      }}
    />
  );
}

/** A local queue so the skip toast can be tested without writing a review row. */
export function DevReview() {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [change, setChange] = useState(false);
  const item = devReviewItems[index];
  const total = devReviewItems.length;
  return (
    <div className="ui-review-queue" data-bar="">
      <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" />
      <div className="ui-review-meter">
        <ProgressBar
          variant="thin"
          label="התקדמות התור"
          value={Math.min(index + 1, total)}
          max={total}
          caption={
            <span className="t-hint">
              <bdi dir="ltr">{String(Math.min(index + 1, total))}</bdi>
              {" מתוך "}
              <bdi dir="ltr">{String(total)}</bdi>
            </span>
          }
        />
      </div>
      {item ? (
        <div className="ui-review-motion" data-motion={index === 0 ? undefined : "in"} key={item.id}>
          <ReviewCard
            supplier={item.supplier}
            sourceLine="הוצאה · 20/06/2026"
            netAgorot={item.netAgorot}
            vatLine="לפני מע״מ"
            suggestion={{ project: item.project, category: item.category }}
          />
        </div>
      ) : (
        <p className="ui-page-pad t-title-3">אין פריטים לאישור</p>
      )}
      <ActionBar>
        <Button
          full
          icon={<CheckIcon />}
          disabled={!item}
          onClick={() => {
            if (!item) return;
            const next = index + 1;
            toast.show({
              message: "הפריט אושר",
              action: "ביטול",
              place: "bar",
              onAction: () => {
                setIndex(next - 1);
              },
            });
            setIndex(next);
          }}
        >
          אישור
        </Button>
        <ActionBarRow>
          <Button variant="secondary" onClick={() => { setChange(true); }}>שינוי</Button>
          <Button
            variant="ghost"
            disabled={!item}
            onClick={() => {
              if (!item) return;
              const next = index + 1;
              // FLOW-327: the skip toast offers ביטול, as on the live queue, for the shots.
              toast.show({
                message: "דילגנו על הפריט",
                action: "ביטול",
                place: "bar",
                onAction: () => {
                  setIndex(next - 1);
                },
              });
              setIndex(next);
            }}
          >
            דלג
          </Button>
        </ActionBarRow>
      </ActionBar>
      {change ? <p className="ui-page-pad">השינוי נפתח</p> : null}
    </div>
  );
}

export function DevReviewBanner() {
  return (
    <ReviewQueue
      sample
      search="?preview=1&sample=1"
      rows={[{
        id: "q1",
        transaction_id: "t1",
        description: "מלט",
        doc_date: "2026-09-29",
        amount_net: -350_000n,
        direction: "expense",
        reason: "missing_category",
        project_id: "p1",
        category_id: "c1",
        supplier_name: "מנופים לדוגמה בע״מ",
        project_name: "שיפוץ הרצל 12",
        category_name: "חומרים",
        // FLOW-309: the banner counts the rows the list it opens shows, as live does.
        auto_approved_today: DEV_FILED_ROWS.length,
      }]}
    />
  );
}

/** Two projects and a line with none, so the list shows its project heads (FLOW-334). */
export function DevFiled() {
  return (
    <FiledTodayScreen
      sample={[
        { id: "t-filed", description: "מלט", doc_date: "2026-09-29", amount_net: -350_000n, direction: "expense", supplier_name: "מנופים לדוגמה בע״מ", project_name: "שיפוץ הרצל 12", category_name: "חומרים" },
        { id: "t-filed-2", description: "הובלה", doc_date: "2026-09-29", amount_net: -120_000n, direction: "expense", supplier_name: "הובלות לדוגמה", project_name: "וילה רעננה", category_name: "הובלה" },
        { id: "t-filed-3", description: "צבע", doc_date: "2026-09-29", amount_net: -84_050n, direction: "expense", supplier_name: "צבעים לדוגמה", project_name: "שיפוץ הרצל 12", category_name: "חומרים" },
        { id: "t-filed-4", description: "עמלה", doc_date: "2026-09-29", amount_net: -2_500n, direction: "expense", supplier_name: "עמלת בנק", project_name: null, category_name: "עמלות" },
      ]}
    />
  );
}

const devDashboard: Dashboard = {
  company_id: "e2e",
  name: "בדיקה",
  vat_registered: true,
  basis: "cash",
  from: "2026-09-01",
  to: "2026-09-29",
  income_agorot: 1_000n,
  direct_agorot: 400n,
  shared_agorot: 0n,
  overhead_agorot: 0n,
  expense_agorot: 400n,
  net_profit_agorot: 600n,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 2,
  review_count: 2,
  after_overhead: false,
  by_currency: [],
  projects: [
    { id: "p1", name: "שיפוץ הרצל 12", status: "active", income_agorot: 1_000n, direct_agorot: 400n, shared_agorot: 0n, profit_before_shared_agorot: 600n, profit_agorot: 600n, by_currency: [] },
    { id: "p2", name: "וילה רעננה", status: "active", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
    { id: "p3", name: "פרויקט ישן", status: "finished", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
  ],
};

export function DevHome() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [params] = useSearchParams();
  return (
    <HomeBooks
      // FLOW-413: `?back=1` draws the profit view as /profit opens it, with its way back to the cash.
      back={params.get("back") === "1" ? <BackButton fallback="/e2e/cash" onBand text="תזרים" label="חזרה לתזרים" /> : undefined}
      data={devDashboard}
      previewing
      search="?preview=1"
      unpaidGross={50_000n}
      unpaidCount={1}
      missingCount={SAMPLE_MISSING_BILLS.length}
      missingTo="/e2e/missing-bills"
      period={period}
      onPeriod={setPeriod}
    />
  );
}

/**
 * FLOW-413: Home's cash with invented figures (frame b). `?box=none` hides the attention box,
 * as a month with nothing waiting does.
 */
export function DevCash() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // FLOW-364: `?state=usd-loss` is the board's negative month in dollars (its past frame with `?month=past`).
  const usdLoss = params.get("state") === "usd-loss";
  const past = params.get("month") === "past";
  const data = usdLoss ? sampleCashUsdLoss(past) : sampleCashMonths();
  const currentKey = cashMonthKey(data.months[0]?.month ?? "");
  // The board's drawer lists the year from January; the usd-loss year carries those months.
  const yearMonths = usdLoss ? sampleCashUsdYear() : undefined;
  // FLOW-364: `?month=past` shows the previous month (the darker band); `?drawer=1` opens the month drawer.
  const monthKey = past ? cashMonthKey(data.months[1]?.month ?? "") : currentKey;
  return (
    <CashHome
      data={data}
      monthKey={monthKey}
      currentKey={currentKey}
      firstKey={cashMonthKey(yearMonths?.months[0]?.month ?? data.months.at(-1)?.month ?? currentKey)}
      previewing={false}
      search="?preview=1"
      attention={params.get("box") === "none" ? [] : attentionRows({
        pending: 7,
        unpaidCount: 3,
        unpaidGross: 460_000n,
        // FLOW-415: `?recurring=1` adds the late bills and a charge above its usual amount.
        missingCount: params.get("recurring") === "1" ? SAMPLE_MISSING_BILLS.length : 0,
        missingTo: "/e2e/missing-bills",
        changes: params.get("recurring") === "1" ? chargeChangeViews(SAMPLE_RECURRING_CHANGES, "?preview=1") : [],
        search: "?preview=1",
      })}
      sameDay={usdLoss ? (past ? null : sampleCashUsdToDay()) : sampleCashToDay()}
      forecast={usdLoss ? -574_100n : -6_810_000n}
      company={<BandCompany name="Acme Test Co" onOpen={() => { void navigate("/settings?preview=1"); }} />}
      onStepMonth={(key) => {
        void navigate(`/e2e/cash?month=${key}`, { replace: true });
      }}
      initialDrawerOpen={params.get("drawer") === "1"}
      drawerYearMonths={yearMonths}
    />
  );
}

/** FLOW-364 (board, StatesHomeEmpty): the signed-in company with no books yet, in dollars, not preview. */
export function DevCashEmpty() {
  const navigate = useNavigate();
  return (
    <CashEmptyHome
      leading={<BandCompany name="Acme Test Co" onOpen={() => { void navigate("/settings?preview=1"); }} />}
      search="?preview=1"
      holdWrites={false}
      currency="USD"
      avatarInitial="A"
    />
  );
}

/** FLOW-413: the earlier month's cash page. */
export function DevCashMonth() {
  const data = sampleCashMonths();
  return <CashMonthScreen sample={data} monthKey={cashMonthKey(data.months[1]?.month ?? "")} />;
}

/** FLOW-413: this month's יצא lines; `?side=in` shows נכנס, `?side=kept` לא נספר ברווח (FLOW-418). */
export function DevCashLines() {
  const [params] = useSearchParams();
  const asked = params.get("side");
  const side = asked === "in" || asked === "kept" ? asked : "out";
  const data = sampleCashMonths();
  return (
    <CashLinesScreen
      sample={{ months: data, lines: sampleCashLines(side) }}
      at={{ month: cashMonthKey(data.months[0]?.month ?? ""), side, currency: "ILS" }}
    />
  );
}

/** FLOW-417: the cash history, years then months. `?currencies=two` adds a USD line. */
export function DevCashHistory() {
  const [params] = useSearchParams();
  return <CashHistoryScreen sample={sampleCashYears(new Date(), params.get("currencies") === "two" ? "two" : "one")} />;
}

/** FLOW-417: last year's page: its net, נכנס, יצא and its months. */
export function DevCashYear() {
  const months = sampleCashYearMonths();
  return <CashYearScreen sample={{ years: sampleCashYears(), months }} year={Number(months.months[0]?.month.slice(0, 4))} />;
}

/** FLOW-445: the list's month cash for the same three projects, and one line with no project. */
const devProjectsCash: NonNullable<ProjectsCashMonth> = {
  month: "2026-09-01",
  base_currency: "ILS",
  basis: "paid",
  projects: [
    { id: "p1", name: "שיפוץ הרצל 12", type: "flip", status: "active", is_overhead: false, group_id: null, created_at: "2026-08-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "ILS", in_minor: 100_000, out_minor: 40_000, net_minor: 60_000 }], profit_month_minor: 60_000, profit_all_minor: 60_000, first_month: "2026-09-01", pending_count: 0, deletable: false },
    { id: "p2", name: "וילה רעננה", type: "השכרה", status: "active", is_overhead: false, group_id: null, created_at: "2026-09-20T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [], profit_month_minor: 0, profit_all_minor: 0, first_month: null, pending_count: 0, deletable: true },
    { id: "p3", name: "פרויקט ישן", type: null, status: "finished", is_overhead: false, group_id: null, created_at: "2026-06-01T08:00:00Z", finished_on: "2026-08-30", budget_minor: null, spent_minor: 0, cash: [], profit_month_minor: 0, profit_all_minor: 0, first_month: "2026-06-01", pending_count: 0, deletable: false },
  ],
  unassigned: { count: 1, cash: [{ currency: "ILS", in_minor: 0, out_minor: 2_500, net_minor: -2_500 }] },
};

export function DevProjects() {
  return <ProjectsScreen sample={devDashboard} cashSample={devProjectsCash} />;
}

/** Dev-only. A production build drops the sample secret with this flag. */
const devAssistantSecret = import.meta.env.DEV ? assistantSampleSecret : undefined;

export function DevSettings() {
  return <SettingsScreen sample={useDevSettingsSample()} />;
}

export function DevConnections() {
  return <ConnectionsScreen sample={useDevSettingsSample()} sampleSecret={devAssistantSecret} />;
}

/** FLOW-106 B: the list reads the dev loan store, so a status change or a delete on a loan's page shows here. `?loans=none` is empty. */
export function DevLoans() {
  const [params] = useSearchParams();
  const sample = useDevSettingsSample();
  const store = devLoanStore();
  useMemoryLoanStore(store);
  return (
    <LoansScreen
      sample={sample == null ? undefined : {
        ...sample,
        loanProjects: SAMPLE_LOAN_PROJECTS,
        loans: params.get("loans") === "none" ? [] : store.rows(),
      }}
    />
  );
}

/** FLOW-106 B / FLOW-110: a loan's page on fake data. `?reset=1` starts the dev store over. */
export function DevLoanDetail({ view }: { view?: LoanView } = {}) {
  const [params] = useSearchParams();
  // StrictMode runs the initializer twice, so the page reads the current store, not the returned one.
  useState(() => (params.get("reset") === "1" ? resetDevLoanStore() : null));
  const store = devLoanStore();
  const preview = params.get("preview");
  return <LoanDetailScreen store={store} view={view} listPath={`/e2e/loans${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`} />;
}

/** The dev Settings fixture. `?connected=1|auth`, `?assistant=…`, `?nocompany=1`, `?email=none|long`, `?loans=none`. */
function useDevSettingsSample(): NonNullable<Parameters<typeof SettingsScreen>[0]>["sample"] {
  const [params] = useSearchParams();
  const mode = params.get("connected");
  const connected = mode === "1" || mode === "auth";
  const assistant = params.get("assistant");
  const noCompany = params.get("nocompany") === "1";
  const emailParam = params.get("email");
  // FLOW-601 (mockup a-1-settings): ?team=3 shows the owner's צוות row with that count.
  const teamParam = params.get("team");
  const email = emailParam === "none"
    ? ""
    : emailParam === "long"
      ? "owner.with.a.very.long.mailbox.name@example.com"
      : "owner@example.com";
  return {
        name: noCompany ? null : "בדיקה",
        connected: noCompany ? false : connected,
        companyId: connected ? 1001 : null,
        lastError: mode === "auth" ? "sumit_auth" : null,
        email,
        noCompany,
        teamCount: teamParam == null || noCompany ? undefined : Number(teamParam),
        assistant: noCompany
          ? { state: "no-company" }
          : assistant === "connected"
          ? { state: "connected", scope: "read_write", lastUsedAt: "2026-09-30T11:05:00.000Z", id: "mcp-1" }
          : assistant === "expired"
            ? { state: "expired", scope: "read", id: "mcp-1" }
            : assistant === "loading"
              ? { state: "loading" }
              : assistant === "error"
                ? { state: "error" }
                : assistant === "nocompany"
                  ? { state: "no-company" }
                  : { state: "empty" },
        loanProjects: [
          { id: "p1", name: "שיפוץ הרצל 12", status: "active" },
          { id: "p2", name: "פרגולה בית כהן", status: "active" },
        ],
        loans: params.get("loans") === "none" ? [] : [
          { id: "l1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "p1", projectName: "שיפוץ הרצל 12" },
          { id: "l2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: null, projectName: null },
        ],
  };
}

export function DevCategories() {
  return (
    <CategoriesScreen
      listPath="/e2e/categories"
      sample={[
        { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false, count: 2 },
        // FLOW-406: a parent with two sub-categories (mockups cat-b, cat-b-2).
        { id: "c5", name: "תחזוקה", kind: "expense", hidden: false, is_default: false, count: 0, rollup_lines: 3, children_count: 2 },
        { id: "c6", name: "חשמל", kind: "expense", hidden: false, is_default: false, count: 2, parent_id: "c5" },
        { id: "c7", name: "ניקיון", kind: "expense", hidden: false, is_default: false, count: 1, parent_id: "c5" },
        // A second visible expense category, so חומרים has somewhere to move (FLOW-347).
        { id: "c4", name: "קבלנים", kind: "expense", hidden: false, is_default: false, count: 1 },
        { id: "c2", name: "ישנה", kind: "expense", hidden: true, is_default: false, count: 0 },
        { id: "c3", name: "עבודה", kind: "income", hidden: false, is_default: false, count: 1 },
      ]}
    />
  );
}

/** `?marked=1` adds a row already marked paid, waiting for the sync (review-cycle fixture, FLOW-335). */
export function DevUnpaid() {
  const [params] = useSearchParams();
  const marked = params.get("marked") === "1";
  // FLOW-335: `?doc=1` gives the first row SUMIT's document link (an invented path).
  const doc = params.get("doc") === "1" ? { document_url: "https://pay.sumit.co.il/example/doc-1" } : {};
  return (
    <UnpaidScreen
      sample={[{
        id: "u1",
        description: "חשבונית פתוחה",
        doc_date: "2026-09-01",
        customer_name: "לקוח לדוגמה",
        project_name: "שיפוץ הרצל 12",
        open_gross_agorot: 50_000n,
        open_net_agorot: 40_000n,
        ...doc,
      }, ...(marked ? [{
        id: "u2",
        description: "חשבונית שסומנה",
        doc_date: "2026-08-20",
        customer_name: "לקוח שני לדוגמה",
        project_name: null,
        open_gross_agorot: 120_000n,
        open_net_agorot: 100_000n,
        marked_paid_at: "2026-10-06T09:00:00Z",
      }] : [])]}
    />
  );
}

/** FLOW-403. The late-bills list with invented rows; `?empty=1` has none. */
export function DevMissingBills() {
  const [params] = useSearchParams();
  if (params.get("empty") === "1") return <MissingBillsScreen sample={{ late: [] }} />;
  // FLOW-415 (b-2): `?income=1` adds a late payment from a customer.
  const base = params.get("income") === "1" ? [...SAMPLE_MISSING_BILLS, SAMPLE_MISSING_INCOME] : SAMPLE_MISSING_BILLS;
  // FLOW-430: `?match=1` adds a late bill that suggests a renamed supplier.
  const late = params.get("match") === "1" ? [...base, SAMPLE_MISSING_RENAMED] : base;
  return <MissingBillsScreen sample={{ late, arrived: SAMPLE_RECURRING_THIS_MONTH, changes: SAMPLE_RECURRING_CHANGES }} />;
}

export function DevTransactionGate() {
  const { transactionId = "" } = useParams();
  if (transactionId === "t-filed") return <DevTransaction />;
  const step = /^t-step-(\d+)$/.exec(transactionId);
  if (step) return <DevStepTransaction n={Number(step[1])} />;
  return <TransactionScreen />;
}

/** A tall list whose rows open sample cards, for the prev and next e2e. */
function stepSample(n: number): NonNullable<TransactionDetail> {
  return {
    id: `t-step-${String(n)}`,
    description: `תנועה ${String(n)}`,
    direction: "expense",
    doc_date: "2026-09-29",
    amount_gross: BigInt(-n * 11_800),
    amount_net: BigInt(-n * 10_000),
    vat_amount: BigInt(-n * 1_800),
    vat_status: "assumed",
    source: "manual",
    project_id: "p1",
    project_name: "שיפוץ הרצל 12",
    category_id: "c1",
    category_name: "חומרים",
    supplier_name: `ספק ${String(n)}`,
    customer_name: null,
    paid: true,
    open_gross_agorot: null,
    allocations: [],
  };
}

/** FLOW-345: `?long=1` splits the card into eight categories, so its content runs on under the step row. */
function longSplit(n: number): LineSplitRead {
  const names = ["חומרים", "עבודה", "הובלה", "ציוד והשכרה", "חשמל", "אינסטלציה", "צבע", "ניקיון"];
  return {
    transactionId: `t-step-${String(n)}`,
    currency: "ILS",
    lineMinor: BigInt(-n * 10_000),
    partsMatch: true,
    parts: names.map((name, i) => ({
      category_id: `c${String(i + 1)}`,
      category_name: name,
      project_id: "p1",
      project_name: "שיפוץ הרצל 12",
      amount_minor: BigInt(-n * 1_250),
      percent: null,
      rest: i === names.length - 1,
    })),
  };
}

function DevStepTransaction({ n }: { n: number }) {
  // FLOW-345: the cache holds the neighbours, as the live card's prefetch leaves it, so a drag peeks their names.
  const client = useQueryClient();
  const preview = useHomePreview();
  const [params] = useSearchParams();
  useEffect(() => {
    for (const side of [n - 1, n + 1]) {
      if (side >= 1 && side <= 24) client.setQueryData(transactionQueryOptions(preview, `t-step-${String(side)}`).queryKey, stepSample(side));
    }
  }, [client, preview, n]);
  return (
    <TransactionScreen
      sample={stepSample(n)}
      sampleProjects={[{ id: "p1", name: "שיפוץ הרצל 12" }]}
      sampleCategories={[{ id: "c1", name: "חומרים" }]}
      sampleLineSplit={params.get("long") === "1" ? longSplit(n) : undefined}
    />
  );
}

/** The scroll the board's scrolled frame shows the page at (CSS px). */
const DEV_SCROLLED_Y = 320;

export function DevProjectDetail() {
  const [params] = useSearchParams();
  const section = params.get("section");
  // The fixture company is in dollars: the preview's company-currency read answers USD.
  const queryClient = useQueryClient();
  const preview = useHomePreview();
  useState(() => { queryClient.setQueryData(["company-currency", preview], "USD"); });
  // `?scrolled=1` is the board's scrolled frame: the page is scrolled past the band, so the compact bar shows.
  useEffect(() => {
    if (params.get("scrolled") !== "1") return;
    const timer = window.setTimeout(() => { window.scrollTo(0, DEV_SCROLLED_Y); }, 0);
    return () => { window.clearTimeout(timer); };
  }, [params]);
  return (
    <ProjectDetailScreen
      // FLOW-340 C: `?section=` draws the screen a row opens, on the same sample (FLOW-419: `profit` too).
      section={section === "profit" || section === "expenses" || section === "investment" || section === "loans" || section === "transactions" ? section : "overview"}
      sectionTo={(target) => (target === "overview" ? "/e2e/project-detail?preview=1" : `/e2e/project-detail?preview=1&section=${target}`)}
      sampleExpected={params.get("expected") === "none" ? SAMPLE_EXPECTED_EMPTY : SAMPLE_EXPECTED}
      // `?budget=1` draws the flip with its budget (the board's flip frame, invented names and figures).
      sample={{ ...devProject, budget_agorot: params.get("budget") === "1" ? devProject.budget_agorot : null }}
      sampleCash={devCash}
      sampleInvestment={devInvestment}
      categoryTo="/e2e/project-category"
    />
  );
}

/** Dev-only months for the "לפי חודש" page: one open month, a loss and a profit. */
/** `?empty=1` is a project with no month yet (review-cycle fixture, FLOW-335). */
export function DevProjectMonths() {
  const [params] = useSearchParams();
  if (params.get("empty") === "1") {
    return (
      <ProfitMonthsScreen
        sample={{
          projectName: "שיפוץ הרצל 12",
          data: { basis: "invoiced", from: null, to: null, project_id: "p1", after_overhead: false, months: [], by_currency: [] },
        }}
      />
    );
  }
  return (
    <ProfitMonthsScreen
      sample={{
        projectName: "שיפוץ הרצל 12",
        data: {
          basis: "invoiced",
          from: "2026-08-01",
          to: "2026-10-08",
          project_id: "p1",
          after_overhead: false,
          months: [
            { month: "2026-10", from: "2026-10-01", to: "2026-10-08", open: true, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 40_000n, profit_minor: -40_000n }] },
            { month: "2026-09", from: "2026-09-01", to: "2026-09-30", open: false, by_currency: [{ currency: "ILS", income_minor: 0n, expense_minor: 120_000n, profit_minor: -120_000n }] },
            { month: "2026-08", from: "2026-08-01", to: "2026-08-31", open: false, by_currency: [{ currency: "ILS", income_minor: 1_000_000n, expense_minor: 300_000n, profit_minor: 700_000n }] },
          ],
          by_currency: [{ currency: "ILS", income_minor: 1_000_000n, expense_minor: 460_000n, profit_minor: 540_000n }],
        },
      }}
    />
  );
}

export function DevChange() {
  const toast = useToast();
  const [projectId, setProjectId] = useState("p1");
  const [categoryId, setCategoryId] = useState("c1");
  const [remember, setRemember] = useState(true);
  const [projects, setProjects] = useState([
    { id: "p1", name: "שיפוץ הרצל 12" },
    { id: "p2", name: "וילה רעננה" },
  ]);
  return (
    <ChangeAssignment
      host="route"
      closeTo="/review?preview=1"
      supplier="מנופים לדוגמה בע״מ"
      amount="₪3,500"
      direction="expense"
      projects={projects}
      categories={[
        { id: "c1", name: "חומרים" },
        { id: "c2", name: "הובלה" },
      ]}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId="p1"
      suggestionCategoryId="c1"
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      remember={remember}
      onRemember={setRemember}
      pending={!remember}
      onCommitPick={() => {
        toast.show({ message: "השיוך נשמר" });
        return Promise.resolve(undefined);
      }}
      onCommitPending={() => {
        toast.show({ message: "השיוך נשמר" });
        return Promise.resolve();
      }}
      onSplit={() => {
        toast.show({ message: "הפיצול נעשה ממסך התנועה, אחרי השיוך." });
      }}
      onCreateProject={(name) => {
        const created = { id: `new-${name}`, name, status: "active" as const };
        setProjects((list) => [...list, created]);
        toast.show({ message: "הפרויקט נשמר" });
        return Promise.resolve(created);
      }}
    />
  );
}

export function DevInstall({ mode }: { mode: InstallMode }) {
  const goBack = useGoBack();
  const toast = useToast();
  return (
    <InstallScreen
      mode={mode}
      onDismiss={() => {
        goBack("/settings?preview=1");
      }}
      onInstall={() => {
        toast.show({ message: "ההתקנה נפתחה" });
      }}
    />
  );
}

export function DevTransaction() {
  return (
    <TransactionScreen
      sample={{
        id: "t-manual",
        description: "רשומה ידנית",
        direction: "expense",
        doc_date: "2026-09-12",
        amount_gross: -118n,
        amount_net: -100n,
        vat_amount: -18n,
        vat_status: "assumed",
        source: "manual",
        project_id: "p1",
        project_name: "שיפוץ הרצל 12",
        category_id: "c1",
        category_name: "חומרים",
        supplier_name: "ספק",
        customer_name: null,
        paid: true,
        open_gross_agorot: null,
        allocations: [],
      }}
      sampleProjects={[{ id: "p1", name: "שיפוץ הרצל 12" }, { id: "p2", name: "וילה רעננה" }]}
      sampleCategories={[{ id: "c1", name: "חומרים" }, { id: "c2", name: "הובלה" }]}
    />
  );
}

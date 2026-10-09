import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type Dashboard, type TransactionDetail } from "@flow/shared";
import { defaultPeriod } from "./period";
import { useHomePreview } from "./preview";
import { transactionQueryOptions } from "./use-books";
import type { LineSplitRead } from "./line-split";
import { SAMPLE_ASSISTANT_SECRET as assistantSampleSecret } from "./assistant-sample";
import { InstallScreen, type InstallMode } from "./ui/install-screen";
import { ChangeAssignment } from "./ui/change-sheet";
import { BackButton, useGoBack } from "./ui/back";
import { Button } from "./ui/button";
import { ActionBar, ActionBarRow } from "./ui/action-bar";
import { CheckIcon } from "./ui/icons";
import { ProgressBar } from "./ui/progress-bar";
import { ReviewCard } from "./ui/review-card";
import { ScreenHeader } from "./ui/screen-header";
import { useToast } from "./ui/toast";
import { HomeBooks } from "./screens/HomeScreen";
import {
  CategoriesScreen,
  ConnectionsScreen,
  DEV_FILED_ROWS,
  LoansScreen,
  ReviewQueue,
  FiledTodayScreen,
  ProjectCategoryScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  SettingsScreen,
  SplitScreen,
  TransactionScreen,
  UnpaidScreen,
} from "./screens/flow-screens";
import { ProfitMonthsScreen } from "./screens/profit-months";
import { LoanDetailScreen } from "./screens/loan-detail-screen";
import { useMemoryLoanStore } from "./screens/loan-detail-store";
import { devLoanStore, resetDevLoanStore, SAMPLE_LOAN_PROJECTS } from "./dev/loan-detail-sample";
import { MissingBillsScreen } from "./screens/missing-bills-screen";
import { SAMPLE_EXPECTED, SAMPLE_EXPECTED_EMPTY, SAMPLE_MISSING_BILLS } from "./forecast-sample";

const devLinks: Array<[string, string]> = [
  ["/e2e/expense", "הוצאה לבדיקה"],
  ["/projects/herzl?preview=1", "פרויקט לדוגמה"],
  ["/transactions/1?preview=1", "תנועה לדוגמה"],
  ["/transactions/1/split?preview=1", "פיצול לדוגמה"],
  ["/settings/categories?preview=1", "קטגוריות לדוגמה"],
  ["/settings/connections?preview=1", "חיבורים לדוגמה"],
  ["/settings/loans?preview=1", "הלוואות לדוגמה"],
  ["/unpaid?preview=1", "חשבוניות לדוגמה"],
  ["/onboarding?preview=1", "הצטרפות לדוגמה"],
  ["/install?preview=1", "התקנה לדוגמה"],
  ["/review/change?preview=1", "שינוי לדוגמה"],
  ["/e2e/split?save=fail", "פיצול שנכשל"],
];

export function DevProject() {
  return (
    <main className="ui-page-pad">
      <h1 className="t-title-1">פרויקט לבדיקה</h1>
      <div style={{ blockSize: "1800px" }} />
      <nav className="ui-stack">
        {devLinks.map(([to, label]) => (
          <Link key={to} to={to}>{label}</Link>
        ))}
      </nav>
    </main>
  );
}

export function DevExpense() {
  return (
    <main className="ui-page-pad">
      <h1 className="t-title-1">הוצאה לבדיקה</h1>
      <BackButton fallback="/projects?preview=1" />
    </main>
  );
}

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
  return (
    <HomeBooks
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

export function DevProjects() {
  return <ProjectsScreen sample={devDashboard} />;
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
export function DevLoanDetail() {
  const [params] = useSearchParams();
  // StrictMode runs the initializer twice, so the page reads the current store, not the returned one.
  useState(() => (params.get("reset") === "1" ? resetDevLoanStore() : null));
  const store = devLoanStore();
  const preview = params.get("preview");
  return <LoanDetailScreen store={store} listPath={`/e2e/loans${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`} />;
}

/** The dev Settings fixture. `?connected=1|auth`, `?assistant=…`, `?nocompany=1`, `?email=none|long`, `?loans=none`. */
function useDevSettingsSample(): NonNullable<Parameters<typeof SettingsScreen>[0]>["sample"] {
  const [params] = useSearchParams();
  const mode = params.get("connected");
  const connected = mode === "1" || mode === "auth";
  const assistant = params.get("assistant");
  const noCompany = params.get("nocompany") === "1";
  const emailParam = params.get("email");
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
      sample={[
        { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false, count: 2 },
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
  return <MissingBillsScreen sample={params.get("empty") === "1" ? [] : SAMPLE_MISSING_BILLS} />;
}

export function DevTransactionGate() {
  const { transactionId = "" } = useParams();
  if (transactionId === "t-filed") return <DevTransaction />;
  const step = /^t-step-(\d+)$/.exec(transactionId);
  if (step) return <DevStepTransaction n={Number(step[1])} />;
  return <TransactionScreen />;
}

/** A tall list whose rows open sample cards, for the prev and next e2e. */
export function DevTxnList() {
  return (
    <FiledTodayScreen
      backTo="/e2e/project"
      sample={Array.from({ length: 24 }, (_, i) => ({
        id: `t-step-${String(i + 1)}`,
        description: `תנועה ${String(i + 1)}`,
        doc_date: "2026-09-29",
        amount_net: BigInt(-(i + 1) * 10_000),
        direction: "expense" as const,
        supplier_name: `ספק ${String(i + 1)}`,
        project_name: "שיפוץ הרצל 12",
        category_name: "חומרים",
      }))}
    />
  );
}

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

export function DevProjectDetail() {
  const [params] = useSearchParams();
  const section = params.get("section");
  return (
    <ProjectDetailScreen
      // FLOW-340 C: `?section=` draws the screen a row opens, on the same sample.
      section={section === "expenses" || section === "investment" || section === "loans" || section === "transactions" ? section : "overview"}
      sectionTo={(target) => (target === "overview" ? "/e2e/project-detail?preview=1" : `/e2e/project-detail?preview=1&section=${target}`)}
      sampleExpected={params.get("expected") === "none" ? SAMPLE_EXPECTED_EMPTY : SAMPLE_EXPECTED}
      sample={{
        id: "p1",
        name: "שיפוץ הרצל 12",
        status: "active",
        state_label: "פעיל",
        budget_agorot: null,
        income_agorot: 1_000n,
        direct_agorot: 400n,
        shared_agorot: 0n,
        profit_agorot: 600n,
        after_overhead: false,
        overhead_share_agorot: 0n,
        profit_after_overhead_agorot: 600n,
        overhead_weighted: true,
        categories: [{ id: "c1", name: "חומרים", amount_agorot: 400n }],
        pending_count: 1,
        pending_agorot: 200n,
        transactions: [{
          id: "t1",
          description: "מלט",
          doc_date: "2026-09-12",
          amount_net: -400n,
          direction: "expense",
          category: "חומרים",
        }],
      }}
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

export function DevProjectCategory() {
  return (
    <ProjectCategoryScreen
      backTo="/e2e/project-detail"
      sample={{
        categoryName: "חומרים",
        projectName: "שיפוץ הרצל 12",
        rows: [{
          id: "t1",
          description: "מלט",
          doc_date: "2026-09-12",
          amount_net: -400n,
        }],
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

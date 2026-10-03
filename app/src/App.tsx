import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { homeSummarySchema, type Dashboard } from "@flow/shared";
import { thisMonth } from "./period";
import { AuthProvider, useAuth } from "./auth";
import { HomeSkeleton } from "./screens/home-skeleton";
import { TabBar } from "./ui/tab-bar";
import { ThemeColor } from "./components/ThemeColor";
import { SAMPLE_ASSISTANT_SECRET as assistantSampleSecret } from "./assistant-sample";
import { getSupabase } from "./lib/supabase";
import { usePreviewMode } from "./preview";
import { readSheetBackground } from "./sheet-background";
import { LedgerFocusRefresh } from "./books-focus";
import { ListHoldRoot } from "./list-hold";
import { BooksProvider } from "./use-books";
import { detectInstallMode, isStandalone, listenForInstallPrompt } from "./ui/install-prompt";
import { InstallScreen, type InstallMode } from "./ui/install-screen";
import { ChangeAssignment } from "./ui/change-sheet";
import { BackButton, DropRestoredSheet, ScrollMemory, useGoBack } from "./ui/back";
import { Button } from "./ui/button";
import { CheckIcon } from "./ui/icons";
import { ProgressBar } from "./ui/progress-bar";
import { ReviewCard } from "./ui/review-card";
import { ScreenHeader } from "./ui/screen-header";
import { ToastProvider, useToast } from "./ui/toast";
import { HelpScreen } from "./screens/HelpScreen";
import { HomeBooks, HomeScreen } from "./screens/HomeScreen";
import { LegalScreen } from "./screens/PlaceholderScreen";
import {
  AddForm,
  CategoriesScreen,
  ChangeForm,
  NotificationsScreen,
  ReviewQueue,
  OnboardingScreen,
  FiledTodayScreen,
  ProjectCategoryScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  ReviewScreen,
  SettingsScreen,
  SplitScreen,
  TransactionScreen,
  UnpaidScreen,
} from "./screens/flow-screens";
import { SignInScreen } from "./screens/SignInScreen";

export function App() {
  useEffect(() => {
    listenForInstallPrompt();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Tab") document.documentElement.dataset.keyboard = "true";
    }
    function onPointer() {
      delete document.documentElement.dataset.keyboard;
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);
  return (
    <ToastProvider>
    <AuthProvider>
      <BooksProvider>
        <ThemeColor />
        <LedgerFocusRefresh />
        <ListHoldRoot />
        <ScrollMemory />
        <DropRestoredSheet />
        <div className="mx-auto min-h-dvh w-full max-w-content bg-bg text-text">
          <AppRoutes />
        </div>
      </BooksProvider>
    </AuthProvider>
    </ToastProvider>
  );
}

function AppRoutes() {
  const location = useLocation();
  const background = readSheetBackground(location.state);
  return (
    <>
      <Routes location={background ?? location}>
          <Route path="/sign-in" element={<SignInScreen />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/preview" element={<Navigate to="/?preview=1" replace />} />
          <Route
            path="/terms"
            element={
              <LegalScreen
                title="תנאי השימוש"
                body="Flow שומר את נתוני העסק שלכם אצלכם. תנאי השימוש המלאים יפורסמו לפני ההשקה."
              />
            }
          />
          <Route
            path="/privacy"
            element={
              <LegalScreen
                title="מדיניות הפרטיות"
                body="בכניסה עם Google אנחנו מקבלים רק שם ואימייל. אין גישה לתיבת הדואר."
              />
            }
          />
          <Route path="/help" element={<HelpScreen />} />
          {import.meta.env.DEV ? (
            <>
              <Route path="/e2e/project" element={<DevProject />} />
              <Route path="/e2e/expense" element={<DevExpense />} />
              <Route path="/e2e/review" element={<DevReview />} />
              <Route path="/e2e/review-banner" element={<DevReviewBanner />} />
              <Route path="/e2e/filed" element={<DevFiled />} />
              <Route path="/e2e/home" element={<DevHome />} />
              <Route path="/e2e/projects" element={<DevProjects />} />
              <Route path="/e2e/settings" element={<DevSettings />} />
              <Route path="/e2e/categories" element={<DevCategories />} />
              <Route path="/e2e/unpaid" element={<DevUnpaid />} />
              <Route path="/e2e/txn" element={<DevTransaction />} />
              <Route path="/e2e/project-detail" element={<DevProjectDetail />} />
              <Route path="/e2e/project-category" element={<DevProjectCategory />} />
              <Route path="/e2e/change" element={<DevChange />} />
              <Route path="/e2e/install-android" element={<DevInstall mode="android-prompt" />} />
              <Route path="/e2e/install-other" element={<DevInstall mode="iphone-other" />} />
              <Route path="/e2e/split" element={<DevSplit />} />
              <Route path="/reviewer/*" element={<ReviewerPreviewRoute />} />
            </>
          ) : import.meta.env.VITE_REVIEWER_BUILD === "1" ? (
            <Route path="/reviewer/*" element={<ReviewerPreviewRoute />} />
          ) : null}
          <Route element={<RequireAuth />}>
            <Route element={<FullScreen />}>
              <Route path="onboarding" element={<OnboardingScreen />} />
              <Route path="transactions/:transactionId" element={<TransactionRoute />} />
              <Route path="transactions/:transactionId/split" element={<SplitScreen />} />
              <Route path="install" element={<InstallRoute />} />
            </Route>
            <Route element={<Shell />}>
              <Route element={<HomeWithSheet />}>
                <Route index element={null} />
                <Route path="add" element={<AddForm />} />
              </Route>
              <Route path="projects" element={<ProjectsScreen />} />
              <Route path="projects/:projectId" element={<ProjectDetailScreen />} />
              <Route path="projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen />} />
              <Route element={<ReviewWithSheet />}>
                <Route path="review" element={null} />
                <Route path="review/all" element={null} />
                <Route path="review/change" element={<ChangeForm />} />
              </Route>
              <Route path="review/filed" element={<FiledTodayScreen />} />
              <Route path="unpaid" element={<UnpaidScreen />} />
              <Route path="notifications" element={<NotificationsScreen />} />
              <Route path="settings" element={<SettingsScreen />} />
              <Route path="settings/categories" element={<CategoriesScreen />} />
            </Route>
          </Route>
        </Routes>
        {background ? (
          <Routes>
            <Route path="add" element={<AddForm />} />
            <Route path="review/change" element={<ChangeForm />} />
          </Routes>
        ) : null}
      </>
    );
}

function RequireAuth() {
  const preview = usePreviewMode();
  const { status } = useAuth();
  if (preview) return <Outlet />;
  if (status === "loading") return <HomeSkeleton />;
  if (status !== "authed") return <Navigate to="/sign-in" replace />;
  return <Outlet />;
}

function HomeWithSheet() {
  return (
    <>
      <HomeScreen />
      <Outlet />
    </>
  );
}

function ReviewWithSheet() {
  return (
    <>
      <ReviewScreen />
      <Outlet />
    </>
  );
}

function InstallRoute() {
  const location = useLocation();
  const goBack = useGoBack();
  const search = location.search;
  if (isStandalone()) return <Navigate to={`/settings${search}`} replace />;
  return (
    <InstallScreen
      mode={detectInstallMode()}
      onDismiss={() => {
        goBack(`/settings${search}`);
      }}
    />
  );
}

const devLinks: Array<[string, string]> = [
  ["/e2e/expense", "הוצאה לבדיקה"],
  ["/projects/herzl?preview=1", "פרויקט לדוגמה"],
  ["/transactions/1?preview=1", "תנועה לדוגמה"],
  ["/transactions/1/split?preview=1", "פיצול לדוגמה"],
  ["/settings/categories?preview=1", "קטגוריות לדוגמה"],
  ["/notifications?preview=1", "התראות לדוגמה"],
  ["/unpaid?preview=1", "חשבוניות לדוגמה"],
  ["/onboarding?preview=1", "הצטרפות לדוגמה"],
  ["/install?preview=1", "התקנה לדוגמה"],
  ["/review/change?preview=1", "שינוי לדוגמה"],
  ["/e2e/split?save=fail", "פיצול שנכשל"],
];

function DevProject() {
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

function DevExpense() {
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
    supplier: "חומרי בניין השרון בע״מ",
    project: "שיפוץ הרצל 12",
    category: "חומרים",
    netAgorot: -1_600_000n,
  },
  {
    id: "2",
    supplier: "הובלות הגליל",
    project: "וילה רעננה",
    category: "הובלה",
    netAgorot: -400_000n,
  },
];

/** A local split so each mode can be saved without writing a ledger row. */
function ReviewerPreviewRoute() {
  const preview = useRef<LazyExoticComponent<ComponentType> | null>(null);
  if (preview.current == null) {
    preview.current = lazy(() => import("./reviewer-preview").then((mod) => ({ default: mod.ReviewerPreview })));
  }
  const Preview = preview.current;
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}

function DevSplit() {
  const [params] = useSearchParams();
  const [saved, setSaved] = useState("");
  const fail = params.get("save") === "fail";
  return (
    <>
      <SplitScreen
        sampleAmount={1001n}
        sampleProjects={[
          { id: "a", name: "שיפוץ הרצל 12", incomeAgorot: 3_000n },
          { id: "b", name: "שיפוץ דירה ביאליק 8 חולון", incomeAgorot: 1_000n },
          { id: "c", name: "פרגולה בית כהן", incomeAgorot: 1_000n },
        ]}
        onSave={(rows) => {
          if (fail) throw new Error("save");
          setSaved(JSON.stringify(rows));
          return undefined;
        }}
      />
      <div id="e2e-split-saved" hidden>{saved}</div>
    </>
  );
}

/** A local queue so the skip toast can be tested without writing a review row. */
function DevReview() {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [change, setChange] = useState(false);
  const item = devReviewItems[index];
  const total = devReviewItems.length;
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" />
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
      <div className="ui-review-actions">
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
              onAction: () => {
                setIndex(next - 1);
              },
            });
            setIndex(next);
          }}
        >
          אישור
        </Button>
        <div className="ui-review-actions-row">
          <Button variant="secondary" onClick={() => { setChange(true); }}>שינוי</Button>
          <Button
            variant="ghost"
            disabled={!item}
            onClick={() => {
              if (!item) return;
              toast.show({ message: "דילגנו על הפריט" });
              setIndex((current) => current + 1);
            }}
          >
            דלג
          </Button>
        </div>
      </div>
      {change ? <p className="ui-page-pad">השינוי נפתח</p> : null}
    </div>
  );
}

function DevReviewBanner() {
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
        supplier_name: "מנופי המרכז בע״מ",
        project_name: "שיפוץ הרצל 12",
        category_name: "חומרים",
        auto_approved_today: 39,
      }]}
    />
  );
}

function DevFiled() {
  return (
    <FiledTodayScreen
      sample={[{
        id: "t-filed",
        description: "מלט",
        doc_date: "2026-09-29",
        amount_net: -350_000n,
        direction: "expense",
        supplier_name: "מנופי המרכז בע״מ",
        project_name: "שיפוץ הרצל 12",
        category_name: "חומרים",
      }]}
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
  projects: [
    { id: "p1", name: "שיפוץ הרצל 12", status: "active", income_agorot: 1_000n, direct_agorot: 400n, shared_agorot: 0n, profit_before_shared_agorot: 600n, profit_agorot: 600n },
    { id: "p2", name: "וילה רעננה", status: "active", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n },
    { id: "p3", name: "פרויקט ישן", status: "finished", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n },
  ],
};

function DevHome() {
  const [period, setPeriod] = useState(thisMonth());
  return (
    <HomeBooks
      data={devDashboard}
      previewing
      search="?preview=1"
      unpaidGross={50_000n}
      unpaidCount={1}
      period={period}
      onPeriod={setPeriod}
    />
  );
}

function DevProjects() {
  return <ProjectsScreen sample={devDashboard} />;
}

/** Dev-only. A production build drops the sample secret with this flag. */
const devAssistantSecret = import.meta.env.DEV ? assistantSampleSecret : undefined;

function DevSettings() {
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
  return (
    <SettingsScreen
      sample={{
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
      }}
      sampleSecret={devAssistantSecret}
    />
  );
}

function DevCategories() {
  return (
    <CategoriesScreen
      sample={[
        { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false, count: 2 },
        { id: "c2", name: "ישנה", kind: "expense", hidden: true, is_default: false, count: 0 },
        { id: "c3", name: "עבודה", kind: "income", hidden: false, is_default: false, count: 1 },
      ]}
    />
  );
}

function DevUnpaid() {
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
      }]}
    />
  );
}

function TransactionRoute() {
  if (import.meta.env.DEV) return <DevTransactionGate />;
  return <TransactionScreen />;
}

function DevTransactionGate() {
  const { transactionId } = useParams();
  if (transactionId === "t-filed") return <DevTransaction />;
  return <TransactionScreen />;
}

function DevProjectDetail() {
  return (
    <ProjectDetailScreen
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

function DevProjectCategory() {
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

function DevChange() {
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
      supplier="מנופי המרכז בע״מ"
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

function DevInstall({ mode }: { mode: InstallMode }) {
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

function DevTransaction() {
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

function Shell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="below-tabbar flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}

function FullScreen() {
  return (
    <div className="safe-bottom min-h-dvh">
      <Outlet />
    </div>
  );
}

function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("מתחברים…");
  const cancelled = useRef(false);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      console.error("Auth callback has no Supabase client.");
      void navigate("/sign-in?error=config", { replace: true });
      return;
    }
    cancelled.current = false;
    const stopped = (): boolean => cancelled.current;
    client.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (stopped()) return;
        if (error || !data.session) {
          const params = new URLSearchParams(window.location.search);
          const code = params.get("error") ?? "server_error";
          console.error("Auth callback session error", code);
          void navigate(`/sign-in?error=${encodeURIComponent(code)}`, { replace: true });
          return;
        }
        const home = await client.rpc("get_home");
        if (stopped()) return;
        if (home.error) {
          console.error("Auth callback get_home failed", home.error.message);
          void navigate("/sign-in?error=server_error", { replace: true });
          return;
        }
        const summary = homeSummarySchema.parse(home.data);
        setMessage(summary.company_id ? "נכנסתם. עוברים לבית." : "נכנסתם. ממשיכים לפרטי העסק.");
        void navigate(summary.company_id ? "/" : "/onboarding", { replace: true });
      })
      .catch((error: unknown) => {
        console.error("Auth callback failed", error);
        if (stopped()) return;
        void navigate("/sign-in?error=server_error", { replace: true });
      });
    return () => {
      cancelled.current = true;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-side">
      <p className="t-title-3">{message}</p>
    </main>
  );
}

import { lazy, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { afterSignInMessage, afterSignInPath, peekSignInReturn, rememberSignInReturn, signInPathFor } from "./safe-return";
import { useAuth } from "./auth";
import { SessionProviders } from "./session-providers";
import { CashHomeSkeleton } from "./screens/home-skeleton";
import { TabBar, type TabSection } from "./ui/tab-bar";
import { AuthCallbackView } from "./ui/auth-callback-view";
import { ThemeColor } from "./components/ThemeColor";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { usePreviewMode } from "./preview";
import { readSheetBackground } from "./sheet-background";
import { LedgerFocusRefresh } from "./books-focus";
import { ListHoldRoot } from "./list-hold";
import { TxnAnnouncer } from "./txn-nav";
import { BooksProvider } from "./use-books";
import { useCompanyRole, useHoldWrites, useIsViewer } from "./use-is-viewer";
import { detectInstallMode, isStandalone, listenForInstallPrompt } from "./ui/install-prompt";
import { DropRestoredSheet, ScrollMemory, useGoBack } from "./ui/back";
import { EdgeSwipeBack } from "./ui/edge-back";
import { HomeScreen, ProfitScreen } from "./screens/HomeScreen";
// Before the router mounts: the split screen holds Back through this listener.
import "./screens/split-pop";
import { SetupIndex, SetupLanding, SetupResume, SetupStepScreen } from "./setup/route";
import { INVITES_PATH, landingWithInvites } from "./invite-landing";
import { useKeyboardInset } from "./ui/keyboard-inset";
import { preloadScreens, screenLoaders } from "./screen-loaders";
import { ScreenSuspense } from "./screen-suspense";
import { PrefetchProjects } from "./prefetch";
import { SignInScreen } from "./screens/SignInScreen";

const ReviewScreen = lazy(() => screenLoaders.review().then((m) => ({ default: m.ReviewScreen })));
const ChangeForm = lazy(() => screenLoaders.changeForm().then((m) => ({ default: m.ChangeForm })));
const AddForm = lazy(() => screenLoaders.addForm().then((m) => ({ default: m.AddForm })));
const OnboardingScreen = lazy(() => screenLoaders.onboarding().then((m) => ({ default: m.OnboardingScreen })));
const ProjectsScreen = lazy(() => screenLoaders.projects().then((m) => ({ default: m.ProjectsScreen })));
const ProjectDetailScreen = lazy(() => screenLoaders.projectDetail().then((m) => ({ default: m.ProjectDetailScreen })));
const FiledTodayScreen = lazy(() => screenLoaders.filedToday().then((m) => ({ default: m.FiledTodayScreen })));
const ProjectCategoryScreen = lazy(() => screenLoaders.projectCategory().then((m) => ({ default: m.ProjectCategoryScreen })));
const UnpaidScreen = lazy(() => screenLoaders.unpaid().then((m) => ({ default: m.UnpaidScreen })));
const TransactionScreen = lazy(() => screenLoaders.transaction().then((m) => ({ default: m.TransactionScreen })));
const SplitScreen = lazy(() => screenLoaders.split().then((m) => ({ default: m.SplitScreen })));
const SettingsScreen = lazy(() => screenLoaders.settings().then((m) => ({ default: m.SettingsScreen })));
const LoansScreen = lazy(() => screenLoaders.settings().then((m) => ({ default: m.LoansScreen })));
const ConnectionsScreen = lazy(() => screenLoaders.connections().then((m) => ({ default: m.ConnectionsScreen })));
const NotificationsScreen = lazy(() => screenLoaders.notifications().then((m) => ({ default: m.NotificationsScreen })));
const CategoriesScreen = lazy(() => screenLoaders.categories().then((m) => ({ default: m.CategoriesScreen })));
const CashMonthScreen = lazy(() => screenLoaders.cash().then((m) => ({ default: m.CashMonthScreen })));
const CashLinesScreen = lazy(() => screenLoaders.cash().then((m) => ({ default: m.CashLinesScreen })));
const CashHistoryScreen = lazy(() => screenLoaders.cashHistory().then((m) => ({ default: m.CashHistoryScreen })));
const CashYearScreen = lazy(() => screenLoaders.cashHistory().then((m) => ({ default: m.CashYearScreen })));
const BreakdownScreen = lazy(() => screenLoaders.breakdown().then((m) => ({ default: m.BreakdownScreen })));
const BreakdownLinesScreen = lazy(() => screenLoaders.breakdown().then((m) => ({ default: m.BreakdownLinesScreen })));
const ProfitMonthsScreen = lazy(() => screenLoaders.profitMonths().then((m) => ({ default: m.ProfitMonthsScreen })));
const ProjectGroupScreen = lazy(() => screenLoaders.projectGroup().then((m) => ({ default: m.ProjectGroupScreen })));
const SearchScreen = lazy(() => screenLoaders.search().then((m) => ({ default: m.SearchScreen })));
const MissingBillsScreen = lazy(() => screenLoaders.missingBills().then((m) => ({ default: m.MissingBillsScreen })));
const LineSplitScreen = lazy(() => screenLoaders.lineSplit().then((m) => ({ default: m.LineSplitScreen })));
const LoanDetailScreen = lazy(() => screenLoaders.loanDetail().then((m) => ({ default: m.LoanDetailScreen })));
const HelpScreen = lazy(() => screenLoaders.help().then((m) => ({ default: m.HelpScreen })));
const LegalScreen = lazy(() => screenLoaders.legal().then((m) => ({ default: m.LegalScreen })));
const InstallScreen = lazy(() => screenLoaders.install().then((m) => ({ default: m.InstallScreen })));
const TeamScreen = lazy(() => screenLoaders.team().then((m) => ({ default: m.TeamScreen })));
const InvitesScreen = lazy(() => screenLoaders.invites().then((m) => ({ default: m.InvitesScreen })));

/**
 * Dev and e2e fixtures. Every use sits behind import.meta.env.DEV, so a production build drops
 * them; the pure mark lets the bundler drop the lazy() calls too.
 */
const devLineSplit = () => import("./dev/line-split-e2e");
const DevLineSplit = /* @__PURE__ */ lazy(() => devLineSplit().then((m) => ({ default: m.DevLineSplit })));
const devBreakdown = () => import("./dev/breakdown-sample");
const DevBreakdownGate = /* @__PURE__ */ lazy(() => devBreakdown().then((m) => ({ default: m.DevBreakdownGate })));
const DevBreakdownLinesGate = /* @__PURE__ */ lazy(() => devBreakdown().then((m) => ({ default: m.DevBreakdownLinesGate })));
const jevReviewCard = () => import("./screens/jev-review-card");
const JevReviewE2e = /* @__PURE__ */ lazy(() => jevReviewCard().then((m) => ({ default: m.JevReviewE2e })));
const devRoutes = () => import("./dev-routes");
const DevCategories = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevCategories })));
const DevChange = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevChange })));
const DevConnections = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevConnections })));
const DevExpense = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevExpense })));
const DevFiled = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevFiled })));
const DevHome = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevHome })));
const DevCash = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevCash })));
const DevCashMonth = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevCashMonth })));
const DevCashLines = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevCashLines })));
const DevCashHistory = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevCashHistory })));
const DevCashYear = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevCashYear })));
const DevInstall = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevInstall })));
const DevLoanDetail = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevLoanDetail })));
const DevLoans = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevLoans })));
const DevMissingBills = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevMissingBills })));
const DevProject = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevProject })));
const DevProjectCategory = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevProjectCategory })));
const DevProjectDetail = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevProjectDetail })));
const DevProjectMonths = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevProjectMonths })));
const DevProjects = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevProjects })));
const DevReview = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevReview })));
const DevReviewBanner = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevReviewBanner })));
const DevSettings = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevSettings })));
const DevSplit = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevSplit })));
const DevTransaction = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevTransaction })));
const DevTransactionGate = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevTransactionGate })));
const DevTxnList = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevTxnList })));
const DevUnpaid = /* @__PURE__ */ lazy(() => devRoutes().then((m) => ({ default: m.DevUnpaid })));
const devTeam = () => import("./dev/team-fixtures");
const DevCompany = /* @__PURE__ */ lazy(() => devTeam().then((m) => ({ default: m.DevCompany })));
const DevInvites = /* @__PURE__ */ lazy(() => devTeam().then((m) => ({ default: m.DevInvites })));
const DevTeam = /* @__PURE__ */ lazy(() => devTeam().then((m) => ({ default: m.DevTeam })));

// The dev server serves each module on request, so a screen loaded on its tap would wait for a
// chain of requests there. In dev every screen and fixture is fetched at start, as before FLOW-804.
if (import.meta.env.DEV) {
  // The e2e sweeps wait for this mark, so a screen or sheet never mounts between their look and their tap.
  void Promise.all([preloadScreens(), devRoutes(), devLineSplit(), devBreakdown(), jevReviewCard(), devTeam()])
    .catch(() => undefined)
    .then(() => {
      document.documentElement.dataset.screensLoaded = "1";
    });
}

export function App() {
  useKeyboardInset();
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
  useEffect(() => {
    // The dev server already fetched every screen at start (below the imports).
    if (import.meta.env.DEV) return;
    // After the page has loaded, so the other screens never compete with Home's own reads.
    let idle = 0;
    function schedule() {
      idle = typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(() => void preloadScreens(), { timeout: 3000 })
        : window.setTimeout(() => void preloadScreens(), 1000);
    }
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);
  return (
    <SessionProviders>
      <BooksProvider>
        <ThemeColor />
        <LedgerFocusRefresh />
        <ListHoldRoot />
        <ScrollMemory />
        <DropRestoredSheet />
        <EdgeSwipeBack />
        <div className="mx-auto min-h-dvh w-full max-w-content bg-bg text-text">
          <AppRoutes />
        </div>
      </BooksProvider>
    </SessionProviders>
  );
}

function AppRoutes() {
  const location = useLocation();
  const background = readSheetBackground(location.state);
  return (
    <>
      <SetupLanding />
      <ScreenSuspense>
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
                {/* FLOW-334: a fixture of a screen that has the tab bar draws it, on that screen's tab. */}
                <Route element={<DevShell section="review" />}>
                  <Route path="/e2e/review" element={<DevReview />} />
                  <Route path="/e2e/jev-review" element={<JevReviewE2e />} />
                  <Route path="/e2e/review-banner" element={<DevReviewBanner />} />
                  <Route path="/e2e/filed" element={<DevFiled />} />
                  <Route path="/e2e/txn-list" element={<DevTxnList />} />
                  <Route path="/e2e/change" element={<DevChange />} />
                </Route>
                <Route element={<DevShell section="home" />}>
                  <Route path="/e2e/home" element={<DevHome />} />
                  <Route path="/e2e/cash" element={<DevCash />} />
                  <Route path="/e2e/cash-month" element={<DevCashMonth />} />
                  <Route path="/e2e/cash-lines" element={<DevCashLines />} />
                  <Route path="/e2e/cash-history" element={<DevCashHistory />} />
                  <Route path="/e2e/cash-year" element={<DevCashYear />} />
                  <Route path="/e2e/unpaid" element={<DevUnpaid />} />
                  <Route path="/e2e/missing-bills" element={<DevMissingBills />} />
                </Route>
                <Route element={<DevShell section="projects" />}>
                  <Route path="/e2e/projects" element={<DevProjects />} />
                  <Route path="/e2e/project-detail" element={<DevProjectDetail />} />
                  <Route path="/e2e/project-category" element={<DevProjectCategory />} />
                  <Route path="/e2e/project-months" element={<DevProjectMonths />} />
                </Route>
                <Route element={<DevShell section="settings" />}>
                  <Route path="/e2e/settings" element={<DevSettings />} />
                  <Route path="/e2e/connections" element={<DevConnections />} />
                  <Route path="/e2e/loans" element={<DevLoans />} />
                  <Route path="/e2e/loans/:loanId" element={<DevLoanDetail />} />
                  <Route path="/e2e/categories" element={<DevCategories />} />
                  <Route path="/e2e/categories/:parentId" element={<DevCategories />} />
                  <Route path="/e2e/team" element={<DevTeam />} />
                </Route>
                <Route element={<DevShell section="home" />}>
                  <Route path="/e2e/company" element={<DevCompany />} />
                </Route>
                <Route path="/e2e/invites" element={<DevInvites />} />
                <Route path="/e2e/txn" element={<DevTransaction />} />
                <Route path="/e2e/install-android" element={<DevInstall mode="android-prompt" />} />
                <Route path="/e2e/install-other" element={<DevInstall mode="iphone-other" />} />
                <Route path="/e2e/split" element={<DevSplit />} />
                <Route path="/e2e/split-category" element={<DevLineSplit />} />
                <Route path="/reviewer/*" element={<ReviewerPreviewRoute />} />
              </>
            ) : import.meta.env.VITE_REVIEWER_BUILD === "1" ? (
              <Route path="/reviewer/*" element={<ReviewerPreviewRoute />} />
            ) : null}
            <Route element={<RequireAuth />}>
              <Route element={<FullScreen />}>
                <Route path="onboarding" element={<OnboardingScreen />} />
                <Route path="invites" element={<InvitesScreen />} />
                <Route path="setup" element={<SetupIndex />} />
                <Route path="setup/:step" element={<SetupStepScreen />} />
                <Route path="search" element={<SearchScreen />} />
                <Route path="transactions/:transactionId" element={<TransactionRoute />} />
                <Route path="transactions/:transactionId/split" element={<SplitScreen />} />
                <Route path="transactions/:transactionId/split-category" element={<LineSplitScreen />} />
                <Route path="install" element={<InstallRoute />} />
              </Route>
              <Route element={<Shell />}>
                <Route element={<HomeWithSheet />}>
                  <Route index element={null} />
                  <Route path="add" element={<AddForm />} />
                </Route>
                {/* FLOW-413: Home is the month's cash; its rows open the profit view, a month, and a month's lines. */}
                <Route path="profit" element={<ProfitScreen />} />
                {/* FLOW-417: "לכל החודשים" opens the years, a year its months. */}
                <Route path="cash/history" element={<CashHistoryScreen />} />
                <Route path="cash/year/:year" element={<CashYearScreen />} />
                <Route path="cash/:month" element={<CashMonthScreen />} />
                <Route path="cash/:month/:side/:currency" element={<CashLinesScreen />} />
                <Route path="projects" element={<ProjectsScreen />} />
                {/* FLOW-406 (proj-b-2): a project group's page. */}
                <Route path="projects/groups/:groupId" element={<ProjectGroupScreen />} />
                <Route path="projects/:projectId" element={<ProjectDetailScreen />} />
                <Route path="projects/:projectId/months" element={<ProfitMonthsScreen />} />
                {/* FLOW-340 C: the screens the project page's rows open. */}
                <Route path="projects/:projectId/expenses" element={<ProjectDetailScreen section="expenses" />} />
                <Route path="projects/:projectId/investment" element={<ProjectDetailScreen section="investment" />} />
                <Route path="projects/:projectId/loans" element={<ProjectDetailScreen section="loans" />} />
                <Route path="projects/:projectId/transactions" element={<ProjectDetailScreen section="transactions" />} />
                <Route path="projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen />} />
                {/* FLOW-334: on the dev server ?preview=1 shows sample figures here; a build keeps the screen. */}
                <Route path="flow/:direction" element={import.meta.env.DEV ? <DevBreakdownGate /> : <BreakdownScreen />} />
                <Route path="flow/:direction/excluded/:currency" element={import.meta.env.DEV ? <DevBreakdownLinesGate excluded /> : <BreakdownLinesScreen excluded />} />
                <Route path="flow/:direction/:groupBy/:currency/:groupKey" element={import.meta.env.DEV ? <DevBreakdownLinesGate /> : <BreakdownLinesScreen />} />
                <Route element={<ReviewWithSheet />}>
                  <Route path="review" element={null} />
                  <Route path="review/all" element={null} />
                  <Route path="review/change" element={<ChangeForm />} />
                </Route>
                <Route path="review/filed" element={<FiledTodayScreen />} />
                <Route path="unpaid" element={<UnpaidScreen />} />
                <Route path="missing-bills" element={<MissingBillsScreen />} />
                {/* FLOW-322 removed the placeholder; FLOW-502's real page is under Settings, so an old link lands there. */}
                <Route path="notifications" element={<Navigate to="/settings/notifications" replace />} />
                <Route path="settings" element={<SettingsScreen />} />
                <Route path="settings/categories" element={<CategoriesScreen />} />
                <Route path="settings/categories/:parentId" element={<CategoriesScreen />} />
                <Route path="settings/connections" element={<ConnectionsScreen />} />
                <Route path="settings/loans" element={<LoansScreen />} />
                <Route path="settings/notifications" element={<NotificationsScreen />} />
                <Route path="settings/team" element={<TeamScreen />} />
                {/* FLOW-106 B / FLOW-110: one loan's page. */}
                <Route path="settings/loans/:loanId" element={<LoanDetailScreen />} />
              </Route>
            </Route>
        </Routes>
      </ScreenSuspense>
        {background ? (
          <ScreenSuspense>
            <Routes>
              <Route path="add" element={<AddForm />} />
              <Route path="review/change" element={<ChangeForm />} />
            </Routes>
          </ScreenSuspense>
        ) : null}
      </>
    );
}

function RequireAuth() {
  const preview = usePreviewMode();
  const { status } = useAuth();
  const location = useLocation();
  if (preview) return <Outlet />;
  if (status === "loading") return <CashHomeSkeleton />;
  if (status !== "authed") return <Navigate to={signInPathFor(`${location.pathname}${location.search}`)} replace />;
  return <Outlet />;
}

function HomeWithSheet() {
  return (
    <>
      <HomeScreen />
      <ScreenSuspense>
        <Outlet />
      </ScreenSuspense>
    </>
  );
}

function ReviewWithSheet() {
  return (
    <>
      {/* No boundary of its own: while Review's code loads, the screen that opened it stays up. */}
      <ReviewScreen />
      <ScreenSuspense>
        <Outlet />
      </ScreenSuspense>
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

/** A local split so each mode can be saved without writing a ledger row. */
function ReviewerPreviewRoute() {
  const preview = useRef<LazyExoticComponent<ComponentType> | null>(null);
  if (preview.current == null) {
    preview.current = lazy(() => import("./reviewer-preview").then((mod) => ({ default: mod.ReviewerPreview })));
  }
  const Preview = preview.current;
  return (
    <ScreenSuspense>
      <Preview />
    </ScreenSuspense>
  );
}

function TransactionRoute() {
  const { transactionId = "" } = useParams();
  // A new card per id: prev and next keep this route mounted, and the card holds per-row state.
  return (
    <TxnAnnouncer>
      {import.meta.env.DEV ? <DevTransactionGate key={transactionId} /> : <TransactionScreen key={transactionId} />}
    </TxnAnnouncer>
  );
}

function Shell() {
  const role = useCompanyRole();
  const viewer = useIsViewer();
  const holdWrites = useHoldWrites();
  const preview = usePreviewMode();
  // Preview keeps +, unless this session is already a viewer. A role that is
  // still loading hides + so a viewer never taps it. An unknown role never
  // shows a write control.
  const allowAdd = role !== "unknown" && !viewer && (preview || !holdWrites);
  return (
    <div className="flex min-h-dvh flex-col">
      <SetupResume />
      <PrefetchProjects />
      <div className="below-tabbar flex min-h-0 min-w-0 flex-1 flex-col">
        {/* A screen that is still loading keeps the tab bar on screen. */}
        <ScreenSuspense>
          <Outlet />
        </ScreenSuspense>
      </div>
      <TabBar allowAdd={allowAdd} />
    </div>
  );
}

/** Dev only (FLOW-334): the Shell's tab bar for an /e2e/ fixture, on the tab its real screen belongs to. */
function DevShell({ section }: { section: TabSection }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="below-tabbar flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      <TabBar section={section} />
    </div>
  );
}

function FullScreen() {
  return (
    <div className="safe-bottom min-h-dvh">
      <ScreenSuspense>
        <Outlet />
      </ScreenSuspense>
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
    const stored = peekSignInReturn();
    const back = stored ? `&return=${encodeURIComponent(stored)}` : "";
    client.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (stopped()) return;
        if (error || !data.session) {
          const params = new URLSearchParams(window.location.search);
          const code = params.get("error") ?? "server_error";
          console.error("Auth callback session error", code);
          void navigate(`/sign-in?error=${encodeURIComponent(code)}${back}`, { replace: true });
          return;
        }
        const home = await client.rpc("get_home");
        if (stopped()) return;
        if (home.error) {
          console.error("Auth callback get_home failed", home.error.message);
          void navigate(`/sign-in?error=server_error${back}`, { replace: true });
          return;
        }
        const schemas = await loadReadSchemas();
        if (stopped()) return;
        const summary = schemas.homeSummarySchema.parse(home.data);
        // FLOW-601: no company yet and open invites: the invites first (mockup invite-3).
        const landing = await landingWithInvites(client, Boolean(summary.company_id), afterSignInPath(Boolean(summary.company_id), stored));
        if (stopped()) return;
        rememberSignInReturn(null);
        setMessage(landing === INVITES_PATH ? "נכנסתם. יש לכם הזמנות." : afterSignInMessage(Boolean(summary.company_id), stored));
        void navigate(landing, { replace: true });
      })
      .catch((error: unknown) => {
        console.error("Auth callback failed", error);
        if (stopped()) return;
        void navigate(`/sign-in?error=server_error${back}`, { replace: true });
      });
    return () => {
      cancelled.current = true;
    };
  }, [navigate]);

  return <AuthCallbackView message={message} />;
}

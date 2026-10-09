import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { afterSignInMessage, afterSignInPath, peekSignInReturn, rememberSignInReturn, signInPathFor } from "./safe-return";
import { homeSummarySchema } from "@flow/shared";
import { useAuth } from "./auth";
import { SessionProviders } from "./session-providers";
import { HomeSkeleton } from "./screens/home-skeleton";
import { TabBar } from "./ui/tab-bar";
import { AuthCallbackView } from "./ui/auth-callback-view";
import { ThemeColor } from "./components/ThemeColor";
import { getSupabase } from "./lib/supabase";
import { usePreviewMode } from "./preview";
import { readSheetBackground } from "./sheet-background";
import { LedgerFocusRefresh } from "./books-focus";
import { ListHoldRoot } from "./list-hold";
import { TxnAnnouncer } from "./txn-nav";
import { BooksProvider } from "./use-books";
import { useCompanyRole, useHoldWrites, useIsViewer } from "./use-is-viewer";
import { detectInstallMode, isStandalone, listenForInstallPrompt } from "./ui/install-prompt";
import { InstallScreen } from "./ui/install-screen";
import { DropRestoredSheet, ScrollMemory, useGoBack } from "./ui/back";
import { EdgeSwipeBack } from "./ui/edge-back";
import { HelpScreen } from "./screens/HelpScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LegalScreen } from "./screens/PlaceholderScreen";
import {
  AddForm,
  CategoriesScreen,
  ChangeForm,
  ConnectionsScreen,
  LoansScreen,
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
import { BreakdownLinesScreen, BreakdownScreen } from "./screens/breakdown";
import { ProfitMonthsScreen } from "./screens/profit-months";
import { SearchScreen } from "./screens/search";
import { MissingBillsScreen } from "./screens/missing-bills-screen";
import { LineSplitScreen } from "./screens/line-split";
import { DevLineSplit } from "./dev/line-split-e2e";
import { JevReviewE2e } from "./screens/jev-review-card";
import { SignInScreen } from "./screens/SignInScreen";
import { SetupIndex, SetupLanding, SetupResume, SetupStepScreen } from "./setup/route";
import { useKeyboardInset } from "./ui/keyboard-inset";
import { DevCategories, DevChange, DevConnections, DevExpense, DevFiled, DevHome, DevInstall, DevLoans, DevMissingBills, DevProject, DevProjectCategory, DevProjectDetail, DevProjectMonths, DevProjects, DevReview, DevReviewBanner, DevSettings, DevSplit, DevTransaction, DevTransactionGate, DevTxnList, DevUnpaid } from "./dev-routes";

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
              <Route path="/e2e/jev-review" element={<JevReviewE2e />} />
              <Route path="/e2e/review-banner" element={<DevReviewBanner />} />
              <Route path="/e2e/filed" element={<DevFiled />} />
              <Route path="/e2e/txn-list" element={<DevTxnList />} />
              <Route path="/e2e/home" element={<DevHome />} />
              <Route path="/e2e/projects" element={<DevProjects />} />
              <Route path="/e2e/settings" element={<DevSettings />} />
              <Route path="/e2e/connections" element={<DevConnections />} />
              <Route path="/e2e/loans" element={<DevLoans />} />
              <Route path="/e2e/categories" element={<DevCategories />} />
              <Route path="/e2e/unpaid" element={<DevUnpaid />} />
              <Route path="/e2e/missing-bills" element={<DevMissingBills />} />
              <Route path="/e2e/txn" element={<DevTransaction />} />
              <Route path="/e2e/project-detail" element={<DevProjectDetail />} />
              <Route path="/e2e/project-category" element={<DevProjectCategory />} />
              <Route path="/e2e/project-months" element={<DevProjectMonths />} />
              <Route path="/e2e/change" element={<DevChange />} />
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
              <Route path="projects" element={<ProjectsScreen />} />
              <Route path="projects/:projectId" element={<ProjectDetailScreen />} />
              <Route path="projects/:projectId/months" element={<ProfitMonthsScreen />} />
              <Route path="projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen />} />
              <Route path="flow/:direction" element={<BreakdownScreen />} />
              <Route path="flow/:direction/excluded/:currency" element={<BreakdownLinesScreen excluded />} />
              <Route path="flow/:direction/:groupBy/:currency/:groupKey" element={<BreakdownLinesScreen />} />
              <Route element={<ReviewWithSheet />}>
                <Route path="review" element={null} />
                <Route path="review/all" element={null} />
                <Route path="review/change" element={<ChangeForm />} />
              </Route>
              <Route path="review/filed" element={<FiledTodayScreen />} />
              <Route path="unpaid" element={<UnpaidScreen />} />
              <Route path="missing-bills" element={<MissingBillsScreen />} />
              {/* FLOW-322: the placeholder notifications page is gone; an old link lands on Settings. */}
              <Route path="notifications" element={<Navigate to="/settings" replace />} />
              <Route path="settings" element={<SettingsScreen />} />
              <Route path="settings/categories" element={<CategoriesScreen />} />
              <Route path="settings/connections" element={<ConnectionsScreen />} />
              {/* FLOW-110 adds settings/loans/:loanId, a loan's detail page. */}
              <Route path="settings/loans" element={<LoansScreen />} />
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
  const location = useLocation();
  if (preview) return <Outlet />;
  if (status === "loading") return <HomeSkeleton />;
  if (status !== "authed") return <Navigate to={signInPathFor(`${location.pathname}${location.search}`)} replace />;
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
      <div className="below-tabbar flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      <TabBar allowAdd={allowAdd} />
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
        const summary = homeSummarySchema.parse(home.data);
        rememberSignInReturn(null);
        setMessage(afterSignInMessage(Boolean(summary.company_id), stored));
        void navigate(afterSignInPath(Boolean(summary.company_id), stored), { replace: true });
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

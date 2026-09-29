import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { homeSummarySchema } from "@flow/shared";
import { AuthProvider, useAuth } from "./auth";
import { HomeSkeleton } from "./screens/home-skeleton";
import { TabBar } from "./ui/tab-bar";
import { ThemeColor } from "./components/ThemeColor";
import { getSupabase } from "./lib/supabase";
import { usePreviewMode } from "./preview";
import { readSheetBackground } from "./sheet-background";
import { BooksProvider } from "./use-books";
import { detectInstallMode, isStandalone, listenForInstallPrompt } from "./ui/install-prompt";
import { InstallScreen } from "./ui/install-screen";
import { BackButton, ScrollMemory, useGoBack } from "./ui/back";
import { Button } from "./ui/button";
import { CheckIcon } from "./ui/icons";
import { ProgressBar } from "./ui/progress-bar";
import { ReviewCard } from "./ui/review-card";
import { ScreenHeader } from "./ui/screen-header";
import { ToastProvider, useToast } from "./ui/toast";
import { HelpScreen } from "./screens/HelpScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LegalScreen } from "./screens/PlaceholderScreen";
import {
  AddForm,
  CategoriesScreen,
  ChangeForm,
  NotificationsScreen,
  OnboardingScreen,
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
        <ScrollMemory />
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
            </>
          ) : null}
          <Route element={<RequireAuth />}>
            <Route element={<FullScreen />}>
              <Route path="onboarding" element={<OnboardingScreen />} />
              <Route path="transactions/:transactionId" element={<TransactionScreen />} />
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
              <Route element={<ReviewWithSheet />}>
                <Route path="review" element={null} />
                <Route path="review/change" element={<ChangeForm />} />
              </Route>
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
        <Button full icon={<CheckIcon />} onClick={() => undefined}>אישור</Button>
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

import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { homeSummarySchema } from "@flow/shared";
import { addTriggerRef } from "./add-trigger";
import { AuthProvider, useAuth } from "./auth";
import { HELP_EMAIL } from "./config";
import { PageTitle } from "./components/PageTitle";
import { Sheet } from "./components/Sheet";
import { HomeSkeleton } from "./components/Skeleton";
import { TabBar } from "./components/TabBar";
import { ThemeColor } from "./components/ThemeColor";
import { BackIcon } from "./components/icons";
import { getSupabase } from "./lib/supabase";
import { usePreviewMode, usePreviewSearch } from "./preview";
import { readSheetBackground } from "./sheet-background";
import { HomeScreen } from "./screens/HomeScreen";
import { LegalScreen } from "./screens/PlaceholderScreen";
import { ProjectScreen } from "./screens/ProjectScreen";
import { SignInScreen } from "./screens/SignInScreen";

export function App() {
  return (
    <AuthProvider>
      <ThemeColor />
      <div className="mx-auto min-h-dvh w-full max-w-content bg-bg text-text">
        <AppRoutes />
      </div>
    </AuthProvider>
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
          <Route element={<RequireAuth />}>
            <Route element={<FullScreen />}>
              <Route path="onboarding" element={<PageTitle title="פרטי העסק" />} />
              <Route path="transactions/:transactionId" element={<TransactionPage />} />
              <Route path="transactions/:transactionId/split" element={<SplitPage />} />
            </Route>
            <Route element={<Shell />}>
              <Route element={<HomeWithSheet />}>
                <Route index element={null} />
                <Route path="add" element={<AddSheet />} />
              </Route>
              <Route path="projects" element={<PageTitle title="פרויקטים" />} />
              <Route path="projects/:projectId" element={<ProjectScreen />} />
              <Route element={<ReviewWithSheet />}>
                <Route path="review" element={null} />
                <Route path="review/change" element={<ChangeSheet />} />
              </Route>
              <Route path="upload" element={<PageTitle title="תוצאות הייבוא" />} />
              <Route path="unpaid" element={<UnpaidPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<PageTitle title="הגדרות" />} />
              <Route path="settings/categories" element={<CategoriesPage />} />
            </Route>
          </Route>
        </Routes>
        {background ? (
          <Routes>
            <Route path="add" element={<AddSheet />} />
            <Route path="review/change" element={<ChangeSheet />} />
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
      <PageTitle title="לאישור" />
      <Outlet />
    </>
  );
}

function Shell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="below-tabbar flex flex-1 flex-col">
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

function AddSheet() {
  const search = usePreviewSearch();
  return (
    <Sheet
      title="הוספה"
      hint="בקרוב תוכלו להוסיף כאן הכנסה או הוצאה"
      closeTo={`/${search}`}
      returnFocusRef={addTriggerRef}
    />
  );
}

function HelpScreen() {
  return (
    <main className="page safe-bottom min-h-dvh">
      <h1 className="t-title-1">עזרה</h1>
      <p className="t-label mt-4 text-text-secondary">לעזרה בכניסה כותבים לנו.</p>
      <p className="mt-4">
        <a className="t-label text-accent-text underline" href={`mailto:${HELP_EMAIL}`}>
          {HELP_EMAIL}
        </a>
      </p>
      <Link to="/sign-in" className="help-back t-label">
        חזרה
      </Link>
    </main>
  );
}

function ChangeSheet() {
  const search = usePreviewSearch();
  return <Sheet title="שינוי שיוך" closeTo={`/review${search}`} />;
}

function UnpaidPage() {
  const search = usePreviewSearch();
  return <PageTitle title="חשבוניות פתוחות" backTo={`/${search}`} />;
}

function NotificationsPage() {
  const search = usePreviewSearch();
  return <PageTitle title="התראות" backTo={`/settings${search}`} />;
}

function CategoriesPage() {
  const search = usePreviewSearch();
  return <PageTitle title="קטגוריות" backTo={`/settings${search}`} />;
}

function TransactionPage() {
  const search = usePreviewSearch();
  return (
    <div className="page">
      <Link to={`/${search}`} aria-label="חזרה" className="icon-btn">
        <BackIcon />
      </Link>
      <h1 className="t-title-1">פרטי תנועה</h1>
    </div>
  );
}

function SplitPage() {
  const { transactionId } = useParams();
  const search = usePreviewSearch();
  return <PageTitle title="פיצול" backTo={`/transactions/${transactionId ?? ""}${search}`} />;
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

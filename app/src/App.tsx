import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { homeSummarySchema } from "@flow/shared";
import { AuthProvider, useAuth } from "./auth";
import { HELP_EMAIL } from "./config";
import { PageTitle } from "./components/PageTitle";
import { HomeSkeleton } from "./components/Skeleton";
import { TabBar } from "./components/TabBar";
import { ThemeColor } from "./components/ThemeColor";
import { offlineQueue } from "./lib/offline-queue";
import { getSupabase } from "./lib/supabase";
import { usePreviewMode } from "./preview";
import { readSheetBackground } from "./sheet-background";
import { BooksProvider } from "./use-books";
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
  return (
    <AuthProvider>
      <BooksProvider>
        <ThemeColor />
        <div className="mx-auto min-h-dvh w-full max-w-content bg-bg text-text">
          <AppRoutes />
        </div>
      </BooksProvider>
    </AuthProvider>
  );
}

function OfflineReplay() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const replay = () => {
      const supabase = getSupabase();
      if (!supabase || !navigator.onLine) {
        void offlineQueue.pending().then((count) => { setWaiting(count > 0); });
        return;
      }
      void offlineQueue.replay(async (op) => {
        const { error } = await supabase.rpc("apply_queued_op", {
          p_client_op_id: op.clientOpId,
          p_name: op.name,
          p_args: op.args as never,
        });
        if (error) throw error;
      }).then(() => offlineQueue.pending()).then((count) => { setWaiting(count > 0); });
    };
    window.addEventListener("online", replay);
    replay();
    return () => { window.removeEventListener("online", replay); };
  }, []);
  if (!waiting) return null;
  return <p className="undo-toast" role="status">יישלח כשהחיבור יחזור</p>;
}

function AppRoutes() {
  const location = useLocation();
  const background = readSheetBackground(location.state);
  return (
    <>
      <OfflineReplay />
      <Routes location={background ?? location}>
          <Route path="/sign-in" element={<SignInScreen />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/auth/opened-in-safari" element={<SafariFallback />} />
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
              <Route path="onboarding" element={<OnboardingScreen />} />
              <Route path="transactions/:transactionId" element={<TransactionScreen />} />
              <Route path="transactions/:transactionId/split" element={<SplitScreen />} />
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
              <Route path="upload" element={<PageTitle title="תוצאות הייבוא" />} />
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

function SafariFallback() {
  return (
    <main className="page safe-bottom min-h-dvh">
      <h1 className="t-title-1">חזרו לאפליקציה Flow</h1>
      <p className="t-label mt-4 text-text-secondary">
        Google נפתח בדפדפן. סוגרים את החלון ופותחים את Flow מהאייקון במסך הבית, ואז מתחברים שם פעם אחת.
      </p>
      <Link to="/sign-in" className="help-back t-label">
        מסך הכניסה
      </Link>
    </main>
  );
}

function HelpScreen() {
  return (
    <main className="page safe-bottom min-h-dvh">
      <h1 className="t-title-1">עזרה</h1>
      <p className="t-label mt-4 text-text-secondary">לעזרה בכניסה כותבים לנו.</p>
      <p className="mt-4">
        <a className="help-mail t-label text-accent-text underline" href={`mailto:${HELP_EMAIL}`}>
          {HELP_EMAIL}
        </a>
      </p>
      <Link to="/sign-in" className="help-back t-label">
        חזרה
      </Link>
    </main>
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

import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
import { ToastProvider } from "./ui/toast";
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
  const navigate = useNavigate();
  const location = useLocation();
  const search = location.search;
  if (isStandalone()) return <Navigate to={`/settings${search}`} replace />;
  return (
    <InstallScreen
      mode={detectInstallMode()}
      onDismiss={() => {
        if (location.key !== "default") {
          void navigate(-1);
          return;
        }
        void navigate(`/settings${search}`, { replace: true });
      }}
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

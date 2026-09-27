import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { homeSummarySchema } from "@flow/shared";
import { AuthProvider, useAuth } from "./auth";
import { TabBar } from "./components/TabBar";
import { HomeSkeleton } from "./components/Skeleton";
import { getSupabase } from "./lib/supabase";
import { usePreviewMode } from "./preview";
import { HomeScreen } from "./screens/HomeScreen";
import { LegalScreen, PlaceholderScreen } from "./screens/PlaceholderScreen";
import { SignInScreen } from "./screens/SignInScreen";

export function App() {
  return (
    <AuthProvider>
      <div className="mx-auto min-h-dvh w-full max-w-content bg-bg text-text">
        <Routes>
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
          <Route element={<RequireAuth />}>
            <Route path="onboarding" element={<OnboardingScreen />} />
            <Route element={<Shell />}>
              <Route index element={<HomeScreen />} />
              <Route
                path="projects"
                element={
                  <PlaceholderScreen
                    title="פרויקטים"
                    note="רשימת הפרויקטים. יצירה ועריכה יגיעו בשלב הבא."
                  />
                }
              />
              <Route
                path="projects/:projectId"
                element={
                  <PlaceholderScreen
                    title="פרויקט"
                    note="הכנסות, הוצאות ורווח של פרויקט אחד."
                    showBack
                  />
                }
              />
              <Route
                path="review"
                element={
                  <PlaceholderScreen
                    title="לאישור"
                    note="כל פריט מוצג לבד. מאשרים, משנים או מפצלים."
                  />
                }
              />
              <Route
                path="review/change"
                element={
                  <PlaceholderScreen
                    title="שינוי שיוך"
                    note="בחירת פרויקט וקטגוריה, עם אפשרות לזכור לספק."
                    showBack
                  />
                }
              />
              <Route
                path="add"
                element={
                  <PlaceholderScreen
                    title="הוספה"
                    note="הזנה ידנית, צילום חשבונית, או ייבוא דף בנק."
                    showBack
                  />
                }
              />
              <Route
                path="upload"
                element={
                  <PlaceholderScreen
                    title="תוצאות הייבוא"
                    note="סיכום שורות שהובנו מדף הבנק, אחרי שיועלו."
                    showBack
                  />
                }
              />
              <Route
                path="transactions/:transactionId"
                element={
                  <PlaceholderScreen
                    title="פרטי תנועה"
                    note="סכום לפני מע״מ, מע״מ, ומקור."
                    showBack
                  />
                }
              />
              <Route
                path="transactions/:transactionId/split"
                element={
                  <PlaceholderScreen
                    title="פיצול"
                    note="חלוקת תנועה בין פרויקטים. הסכום חייב להגיע ל-100%."
                    showBack
                  />
                }
              />
              <Route
                path="unpaid"
                element={
                  <PlaceholderScreen
                    title="חשבוניות פתוחות"
                    note="חשבוניות שטרם נפרעו. הן לא נכנסות לרווח המזומן."
                    showBack
                  />
                }
              />
              <Route
                path="notifications"
                element={
                  <PlaceholderScreen
                    title="התראות"
                    note="סיכום יום ראשון ותזכורת לסוף היום."
                    showBack
                  />
                }
              />
              <Route
                path="settings"
                element={
                  <PlaceholderScreen
                    title="הגדרות"
                    note="חשבון Google, SUMIT, קטגוריות ופרויקטים."
                  />
                }
              />
              <Route
                path="settings/categories"
                element={
                  <PlaceholderScreen
                    title="קטגוריות"
                    note="שבע קטגוריות הוצאה ושתי קטגוריות הכנסה נטענות עם החברה."
                    showBack
                  />
                }
              />
            </Route>
          </Route>
        </Routes>
      </div>
    </AuthProvider>
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

function Shell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1 pb-tabbar">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}

function OnboardingScreen() {
  return (
    <PlaceholderScreen
      title="פרטי העסק"
      note="חשבון חדש ממשיך לכאן, לפרטי העסק. הטופס עצמו יגיע בשלב הבא."
    />
  );
}

function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("מתחברים…");
  const cancelled = useRef(false);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
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
          void navigate(`/sign-in?error=${encodeURIComponent(code)}`, { replace: true });
          return;
        }
        const home = await client.rpc("get_home");
        if (stopped()) return;
        if (home.error) {
          void navigate("/sign-in?error=server_error", { replace: true });
          return;
        }
        const summary = homeSummarySchema.parse(home.data);
        setMessage(summary.company_id ? "נכנסתם. עוברים לבית." : "נכנסתם. ממשיכים לפרטי העסק.");
        void navigate(summary.company_id ? "/" : "/onboarding", { replace: true });
      })
      .catch(() => {
        if (stopped()) return;
        void navigate("/sign-in?error=server_error", { replace: true });
      });
    return () => {
      cancelled.current = true;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-side">
      <p className="text-title-3">{message}</p>
    </main>
  );
}

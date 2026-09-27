import { useEffect, useState } from "react";
import { NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { HomeScreen } from "./screens/HomeScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { SignInScreen } from "./screens/SignInScreen";

const tabClass =
  "flex flex-1 flex-col items-center justify-center text-[11px] font-medium text-text-muted aria-[current=page]:text-accent-text";

export function App() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-bg text-text">
      <Routes>
        <Route path="/sign-in" element={<SignInScreen />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route element={<Shell />}>
          <Route index element={<HomeScreen />} />
          <Route path="projects" element={<PlaceholderScreen title="פרויקטים" note="רשימת הפרויקטים. יצירה ועריכה יגיעו בשלב הבא." />} />
          <Route path="projects/:projectId" element={<PlaceholderScreen title="פרויקט" note="הכנסות, הוצאות ורווח של פרויקט אחד." />} />
          <Route path="review" element={<PlaceholderScreen title="תור לאישור" note="אין פריטים שמחכים לאישור." />} />
          <Route path="review/change" element={<PlaceholderScreen title="שינוי שיוך" note="בחירת פרויקט וקטגוריה, עם אפשרות לזכור לספק." />} />
          <Route path="add" element={<PlaceholderScreen title="הוספה" note="הזנה ידנית, צילום חשבונית, או ייבוא דף בנק." />} />
          <Route path="upload" element={<PlaceholderScreen title="תוצאות הייבוא" note="סיכום שורות שהובנו מדף הבנק, אחרי שיועלו." />} />
          <Route path="transactions/:transactionId" element={<PlaceholderScreen title="פרטי תנועה" note="סכום לפני מע״מ, מע״מ, ומקור." />} />
          <Route path="transactions/:transactionId/split" element={<PlaceholderScreen title="פיצול" note="חלוקת תנועה בין פרויקטים. הסכום חייב להגיע ל-100%." />} />
          <Route path="unpaid" element={<PlaceholderScreen title="חשבוניות פתוחות" note="חשבוניות שטרם נפרעו. הן לא נכנסות לרווח המזומן." />} />
          <Route path="notifications" element={<PlaceholderScreen title="התראות" note="סיכום יום ראשון ותזכורת לסוף היום." />} />
          <Route path="settings" element={<PlaceholderScreen title="הגדרות" note="חשבון Google, SUMIT, קטגוריות ופרויקטים." />} />
          <Route path="settings/categories" element={<PlaceholderScreen title="קטגוריות" note="שבע קטגוריות הוצאה ושתי קטגוריות הכנסה נטענות עם החברה." />} />
        </Route>
      </Routes>
    </div>
  );
}

function Shell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1 pb-24">
        <Outlet />
      </div>
      <nav className="fixed inset-x-0 bottom-0 mx-auto flex h-[calc(52px+env(safe-area-inset-bottom))] w-full max-w-[480px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        <NavLink to="/" end className={tabClass}>
          בית
        </NavLink>
        <NavLink to="/review" className={tabClass}>
          תור
        </NavLink>
        <NavLink to="/projects" className={tabClass}>
          פרויקטים
        </NavLink>
        <NavLink to="/settings" className={tabClass}>
          הגדרות
        </NavLink>
      </nav>
    </div>
  );
}

function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("מתחברים…");

  useEffect(() => {
    if (!supabase) {
      navigate("/sign-in?error=config", { replace: true });
      return;
    }
    const client = supabase;
    let active = true;
    client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.session) {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("error") ?? "server_error";
        navigate(`/sign-in?error=${encodeURIComponent(code)}`, { replace: true });
        return;
      }
      setMessage("נכנסתם. עוברים לבית.");
      navigate("/", { replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <p className="text-[17px]">{message}</p>
    </main>
  );
}

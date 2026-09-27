import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase, supabaseConfigured } from "../lib/supabase";

type Notice = "cancelled" | "failed" | null;

function noticeFromQuery(params: URLSearchParams): Notice {
  const error = params.get("error");
  if (!error) return null;
  if (error === "access_denied" || error === "popup_closed") return "cancelled";
  return "failed";
}

export function SignInScreen() {
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [localNotice, setLocalNotice] = useState<Notice>(null);
  const notice = localNotice ?? noticeFromQuery(params);
  const ready = supabaseConfigured && supabase != null;

  async function continueWithGoogle() {
    if (!supabase) {
      setLocalNotice("failed");
      return;
    }
    setLocalNotice(null);
    setPending(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setPending(false);
      setLocalNotice("failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-bg px-6 pb-10">
      <div className="flex flex-1 flex-col justify-center pb-16">
        <p className="text-[44px] font-bold leading-none text-logo">Flow</p>
        <p className="mt-4 max-w-[16rem] text-[22px] font-semibold leading-snug text-text">
          הרווח וההפסד של העסק, בלי אקסלים
        </p>
      </div>

      <section className="flex flex-col gap-4">
        {notice === "cancelled" ? (
          <div className="rounded-card bg-tint px-4 py-3 text-text">
            <p className="font-semibold text-accent-text">הכניסה לא הושלמה</p>
            <p className="mt-1 text-[15px] font-normal text-text-secondary">
              החלון של Google נסגר. אפשר לנסות שוב.
            </p>
          </div>
        ) : null}
        {notice === "failed" ? (
          <div className="rounded-card bg-tint px-4 py-3 text-text">
            <p className="font-semibold text-bad">לא הצלחנו להתחבר</p>
            <p className="mt-1 text-[15px] font-normal text-text-secondary">
              {ready
                ? "בדקו את החיבור ונסו שוב."
                : "חסרים VITE_SUPABASE_URL או VITE_SUPABASE_ANON_KEY. ראו .env.example."}
            </p>
          </div>
        ) : null}

        <h1 className="text-[22px] font-semibold">כניסה או הרשמה</h1>
        <p className="text-[15px] font-normal text-text-secondary">
          בלי סיסמה – עם חשבון Google שכבר יש לך
        </p>

        <button
          type="button"
          onClick={() => void continueWithGoogle()}
          disabled={!ready || pending}
          className="flex h-[52px] w-full items-center justify-center gap-3 rounded-full border border-gsi-border bg-gsi-bg text-[16px] font-medium text-gsi-text disabled:opacity-40"
        >
          <GoogleMark />
          <span>{pending ? "מתחברים…" : "המשך עם Google"}</span>
        </button>

        <p className="text-[13px] font-normal leading-relaxed text-text-muted">
          נקבל מ-Google רק שם ואימייל. אין לנו גישה לתיבת הדואר.
        </p>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

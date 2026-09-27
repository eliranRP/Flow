import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { GoogleButton } from "../components/GoogleButton";
import { Note } from "../components/Note";
import { Wordmark } from "../components/Wordmark";
import { getSupabase } from "../lib/supabase";

type Notice = "cancelled" | "failed" | null;

function noticeFromQuery(params: URLSearchParams): Notice {
  const error = params.get("error");
  if (!error) return null;
  if (error === "access_denied" || error === "popup_closed") return "cancelled";
  return "failed";
}

export function SignInScreen() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [localNotice, setLocalNotice] = useState<Notice>(null);
  const notice = localNotice ?? noticeFromQuery(params);
  const ready = getSupabase() != null;

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  if (status === "authed") {
    return <Navigate to="/" replace />;
  }

  async function continueWithGoogle() {
    const supabase = getSupabase();
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
    <main className="mx-auto flex min-h-dvh w-full max-w-content flex-col bg-bg px-side pb-10">
      <div className="flex flex-1 flex-col justify-center pb-16">
        <Wordmark size="signin" />
        <p className="mt-4 max-w-xs text-title-2 text-text">הרווח וההפסד של העסק, בלי אקסלים</p>
      </div>

      <section className="flex flex-col gap-4">
        {notice === "cancelled" ? (
          <Note title="הכניסה לא הושלמה" body="החלון של Google נסגר. אפשר לנסות שוב." />
        ) : null}
        {notice === "failed" ? (
          <Note
            tone="bad"
            title="לא הצלחנו להתחבר"
            body={ready ? "בדקו את החיבור ונסו שוב." : "הכניסה לא זמינה כרגע. נסו שוב מאוחר יותר."}
          />
        ) : null}

        <h1 className="text-title-2">כניסה או הרשמה</h1>
        <p className="text-label text-text-secondary">בלי סיסמה – עם חשבון Google שכבר יש לך</p>

        <GoogleButton
          pending={pending}
          disabled={!ready}
          onClick={() => void continueWithGoogle()}
        />

        {notice === "failed" ? (
          <p className="text-center text-hint text-text-muted">
            <a className="underline" href="#help">
              צריך עזרה בכניסה?
            </a>
          </p>
        ) : null}

        <p className="text-hint leading-relaxed text-text-muted">
          נקבל מ-Google רק שם ואימייל. אין לנו גישה לתיבת הדואר.{" "}
          <Link to="/terms" className="underline">
            תנאי השימוש
          </Link>
          {" · "}
          <Link to="/privacy" className="underline">
            מדיניות הפרטיות
          </Link>
        </p>
      </section>
    </main>
  );
}

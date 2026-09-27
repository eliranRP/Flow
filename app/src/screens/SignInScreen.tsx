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
    if (!ready) console.error("Sign-in is unavailable because Supabase is not configured.");
  }, [ready]);

  useEffect(() => {
    const error = params.get("error");
    if (error) console.error("Sign-in error", error);
  }, [params]);

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
      console.error("Sign-in is unavailable because Supabase is not configured.");
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
      console.error("Google sign-in failed", error.message);
      setPending(false);
      setLocalNotice("failed");
    }
  }

  return (
    <main className="signin">
      <div className="signin-brand">
        <Wordmark size="signin" />
        <p className="signin-tagline">הרווח וההפסד של העסק, בלי אקסלים</p>
      </div>

      <section className="signin-sheet">
        {notice === "cancelled" ? (
          <Note title="הכניסה לא הושלמה" body="החלון של Google נסגר. אפשר לנסות שוב." />
        ) : null}
        {notice === "failed" ? (
          <Note
            tone="bad"
            title="לא הצלחנו להתחבר"
            body="אולי אין חיבור לאינטרנט, או ש-Google לא אישרה את החשבון. כדאי לבדוק את החיבור ולנסות שוב."
          />
        ) : null}

        <h1 className="t-title-2 signin-heading">כניסה או הרשמה</h1>
        <p className="t-label text-text-secondary">בלי סיסמה – עם חשבון Google שכבר יש לך</p>

        <div className="signin-button">
          <GoogleButton
            pending={pending}
            disabled={!ready}
            onClick={() => void continueWithGoogle()}
          />
        </div>

        {notice ? (
          <p className="signin-help">
            <Link to="/help" className="t-label text-text-secondary underline">
              צריך עזרה בכניסה?
            </Link>
          </p>
        ) : null}

        <p className="signin-privacy t-hint">
          נקבל מ-Google רק שם ואימייל. אין לנו גישה לתיבת הדואר.
          <br />
          <Link to="/terms" className="underline">
            תנאי שימוש
          </Link>
          {" · "}
          <Link to="/privacy" className="underline">
            מדיניות פרטיות
          </Link>
        </p>
      </section>
    </main>
  );
}

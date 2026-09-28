import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Notice } from "../ui/banner";
import { GoogleButton } from "../ui/google-button";
import { SignInActions, SignInBrand, SignInFrame, SignInHeading, SignInHelp, SignInPanel, SignInPrivacy, SignInTagline } from "../ui/layout";
import { TextLink } from "../ui/text-link";
import { Wordmark } from "../ui/wordmark";
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
    <SignInFrame>
      <SignInBrand>
        <Wordmark size="signin" />
        <SignInTagline>הרווח וההפסד של העסק, בלי אקסלים</SignInTagline>
      </SignInBrand>

      <SignInPanel>
        {notice === "cancelled" ? (
          <Notice title="הכניסה לא הושלמה" body="החלון של Google נסגר. אפשר לנסות שוב." />
        ) : null}
        {notice === "failed" ? (
          <Notice
            tone="bad"
            title="לא הצלחנו להתחבר"
            body="אולי אין חיבור לאינטרנט, או ש-Google לא אישרה את החשבון. כדאי לבדוק את החיבור ולנסות שוב."
          />
        ) : null}

        <SignInHeading>כניסה או הרשמה</SignInHeading>
        <p className="t-label text-text-secondary">בלי סיסמה – עם חשבון Google שכבר יש לך</p>

        <SignInActions>
          <GoogleButton pending={pending} disabled={!ready} onClick={() => void continueWithGoogle()} />
        </SignInActions>

        {notice === "failed" ? (
          <SignInHelp>
            <TextLink to="/help" className="t-label text-text-secondary underline">
              צריך עזרה בכניסה?
            </TextLink>
          </SignInHelp>
        ) : null}

        <SignInPrivacy>
          נקבל מ-Google רק שם ואימייל. אין לנו גישה לתיבת הדואר.
          <br />
          <TextLink to="/terms" className="underline">
            תנאי שימוש
          </TextLink>
          {" · "}
          <TextLink to="/privacy" className="underline">
            מדיניות פרטיות
          </TextLink>
        </SignInPrivacy>
      </SignInPanel>
    </SignInFrame>
  );
}

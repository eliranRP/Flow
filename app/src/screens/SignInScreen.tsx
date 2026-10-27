import { useEffect, useState, useSyncExternalStore } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Notice } from "../ui/banner";
import { GoogleButton } from "../ui/google-button";
import { BandOfflineLine, useOnline } from "../ui/band-states";
import { SignInActions, SignInBrand, SignInFrame, SignInHeading, SignInPanel, SignInPrivacy, SignInTagline } from "../ui/layout";
import { Button } from "../ui/button";
import { Wordmark } from "../ui/wordmark";
import { getSupabase } from "../lib/supabase";
import { rememberSignInReturn, safeSignInReturn } from "../safe-return";

type Notice = "cancelled" | "failed" | null;

/** FLOW-976: offline, sign-in says so before the tap; Google's page cannot open without a connection. */
export const SIGN_IN_OFFLINE = "הכניסה תעבוד כשהחיבור יחזור";
/** After a failed sign-in the button names the retry. */
export const SIGN_IN_RETRY = "ניסיון חוזר עם Google";

/**
 * The browser's own online flag, kept current. React Query's starts out online, so a page opened while
 * already offline would show nothing; sign-in reads both.
 */
function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("online", notify);
      window.addEventListener("offline", notify);
      return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
      };
    },
    () => navigator.onLine,
  );
}

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
  const queryOnline = useOnline();
  const browserOnline = useBrowserOnline();
  const online = queryOnline && browserOnline;

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const returnPath = safeSignInReturn(params.get("return"));

  if (status === "authed") {
    return <Navigate to={returnPath ?? "/"} replace />;
  }

  async function continueWithGoogle() {
    const supabase = getSupabase();
    // Offline, the redirect would land on the browser's own error page; the failure stays here instead.
    if (!supabase || !online) {
      setLocalNotice("failed");
      return;
    }
    setLocalNotice(null);
    setPending(true);
    rememberSignInReturn(returnPath);
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
    <SignInFrame>
      <SignInBrand>
        <Wordmark size="signin" />
        <SignInTagline>הרווח וההפסד של העסק, בלי אקסלים</SignInTagline>
      </SignInBrand>

      <SignInPanel>
        {online ? null : <BandOfflineLine onPage retrying={false} words={SIGN_IN_OFFLINE} />}
        {ready ? null : (
          <Notice title="הגדרת השרת אינה תקינה" body="הכתובת או המפתח הציבורי אינם תקינים, ולכן אי אפשר להתחבר." tone="bad" />
        )}
        {notice === "cancelled" ? (
          <Notice title="הכניסה לא הושלמה" body="החלון של Google נסגר. אפשר לנסות שוב." />
        ) : null}
        {notice === "failed" ? (
          <Notice
            tone="bad"
            title="לא הצלחנו להתחבר"
            body="אולי אין חיבור לאינטרנט, או ש־Google לא אישרה את החשבון. כדאי לבדוק את החיבור ולנסות שוב."
            // FLOW-976: the way out sits in the error itself.
            extra={
              <Button variant="link" to="/help" quiet className="ui-signin-help">
                צריך עזרה בכניסה?
              </Button>
            }
          />
        ) : null}

        <SignInHeading>כניסה או הרשמה</SignInHeading>
        <p className="t-line2 text-text-secondary">בלי סיסמה – עם חשבון Google שכבר יש לך</p>

        <SignInActions>
          <GoogleButton
            pending={pending}
            disabled={!ready}
            label={notice === "failed" ? SIGN_IN_RETRY : undefined}
            onClick={() => void continueWithGoogle()}
          />
        </SignInActions>

        <SignInPrivacy>
          נקבל מ־Google רק שם ואימייל. אין לנו גישה לתיבת הדואר.
          <br />
          <Button variant="link" to="/terms" className="ui-btn-link-hint">
            תנאי שימוש
          </Button>
          {" · "}
          <Button variant="link" to="/privacy" className="ui-btn-link-hint">
            מדיניות פרטיות
          </Button>
        </SignInPrivacy>
      </SignInPanel>
    </SignInFrame>
  );
}

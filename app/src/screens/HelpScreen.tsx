import { useAuth } from "../auth";
import { HELP_EMAIL } from "../config";
import { HelpMail } from "../ui/layout";
import { ScreenHeader } from "../ui/screen-header";
import { usePublicBackTarget } from "./public-back";
import "../ui/css/60-help-legal.css";

/** FLOW-979 (decision 0225): the two sign-in problems people write about, above the address. */
export const SIGN_IN_TIPS = [
  "חלון Google נסגר לפני שסיימתם? חוזרים לכניסה ומנסים שוב.",
  "נכנסתם עם חשבון אחר? בחלון של Google בוחרים את החשבון שאיתו נרשמתם.",
] as const;

export function HelpScreen() {
  const status = useAuth().status;
  const back = usePublicBackTarget();
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title="עזרה" subtitle={status === "authed" ? "יש שאלה או תקלה? כותבים לנו." : "לעזרה בכניסה כותבים לנו."} backTo={back} />
      {/* Only once the visitor is known to be signed out: not while the session still loads. */}
      {status !== "anon" ? null : (
        // An unstyled list loses its list role in Safari; role="list" keeps it.
        <ul className="ui-page-pad ui-help-tips" role="list">
          {SIGN_IN_TIPS.map((tip) => <li key={tip} className="t-body">{tip}</li>)}
        </ul>
      )}
      <HelpMail email={HELP_EMAIL} />
    </main>
  );
}

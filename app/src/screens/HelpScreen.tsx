import { useAuth } from "../auth";
import { HELP_EMAIL } from "../config";
import { HelpMail } from "../ui/layout";
import { ScreenHeader } from "../ui/screen-header";
import { usePublicBackTarget } from "./public-back";
import "../ui/css/60-help-legal.css";

/** FLOW-977 (decision 0225): the two sign-in problems people write about, above the address. */
export const SIGN_IN_TIPS = [
  "חלון Google נסגר לפני שסיימתם? חוזרים לכניסה ומנסים שוב.",
  "נכנסתם עם חשבון אחר? בחלון של Google בוחרים את החשבון שאיתו נרשמתם.",
] as const;

export function HelpScreen() {
  const signedIn = useAuth().status === "authed";
  const back = usePublicBackTarget();
  return (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title="עזרה" subtitle={signedIn ? "יש שאלה או תקלה? כותבים לנו." : "לעזרה בכניסה כותבים לנו."} backTo={back} />
      {signedIn ? null : (
        <ul className="ui-page-pad ui-help-tips">
          {SIGN_IN_TIPS.map((tip) => <li key={tip} className="t-body">{tip}</li>)}
        </ul>
      )}
      <HelpMail email={HELP_EMAIL} />
    </main>
  );
}

import { isIosDevice, type SubscribeOutcome, type SubscribeResult, type SubscribeStep } from "../push";

/**
 * FLOW-516: what a failed "turn on" says, one line per reason, so the owner can tell a blocked
 * permission from a worker that never got ready or a save that did not reach the server.
 */
export const PUSH_ON = "נשלח התראה על כל תנועה חדשה ותזכורת בערב.";
export const PUSH_ACTIVE_HERE = "התראות פעילות במכשיר הזה";
const BLOCKED_IOS = "ההתראות חסומות. אפשר לאשר אותן בהגדרות של האייפון › עדכונים › Flow.";
const BLOCKED_BROWSER = "ההתראות חסומות בדפדפן. אפשר לאשר אותן בהגדרות הדפדפן.";
const REOPEN = "אפשר לסגור את Flow, לפתוח שוב ולנסות.";

/** Where a blocked permission is turned back on: the iOS Settings app, or the browser's settings. */
export function pushBlockedMessage(ios = isIosDevice()): string {
  return ios ? BLOCKED_IOS : BLOCKED_BROWSER;
}

const FAILURE: Record<Exclude<SubscribeResult, "ok" | "denied">, string> = {
  unsupported: "הדפדפן הזה לא שולח התראות.",
  dismissed: "ההתראות לא אושרו. אפשר לנסות שוב.",
  "permission-timeout": "לא התקבלה תשובה לבקשת ההרשאה. אפשר לנסות שוב.",
  "worker-timeout": `האפליקציה עוד לא מוכנה להתראות. ${REOPEN}`,
  "not-controlled": "צריך לסגור את Flow ולפתוח שוב, ואז להפעיל.",
  "lookup-timeout": `המכשיר לא ענה. ${REOPEN}`,
  "lookup-threw": `המכשיר לא ענה. ${REOPEN}`,
  "unsubscribe-timeout": `ההרשמה הישנה לא הוסרה. ${REOPEN}`,
  "unsubscribe-threw": `ההרשמה הישנה לא הוסרה. ${REOPEN}`,
  "subscribe-timeout": "ההרשמה להתראות לא הסתיימה. אפשר לנסות שוב.",
  "subscribe-threw": "המכשיר לא אישר את ההרשמה להתראות. אפשר לנסות שוב.",
  "save-timeout": "השמירה בשרת לא הסתיימה. אפשר לנסות שוב.",
  "save-failed": "לא הצלחנו לשמור את המכשיר. אפשר לנסות שוב.",
};

/** The toast for a subscribe that did not finish. A blocked permission is information, not a fault. */
export function subscribeFailure(result: Exclude<SubscribeResult, "ok">, ios = isIosDevice()): { message: string; tone: "info" | "bad" } {
  if (result === "denied") return { message: pushBlockedMessage(ios), tone: "info" };
  return { message: FAILURE[result], tone: result === "dismissed" ? "info" : "bad" };
}

const STEP: Record<SubscribeStep, string> = {
  permission: "אישור התראות",
  worker: "טעינת האפליקציה",
  controller: "טעינת האפליקציה",
  lookup: "בדיקת הרשמה קיימת",
  unsubscribe: "הסרת הרשמה ישנה",
  subscribe: "הרשמה במכשיר",
  save: "שמירה בשרת",
  done: "הסתיים",
};

/** The muted line under a failed turn-on, for a screenshot: the step, the reason and the browser's error. */
export function subscribeDiagnostic(outcome: SubscribeOutcome): string {
  const parts = [outcome.result, outcome.detail].filter((part): part is string => part != null && part !== "");
  return `שלב אחרון: ${STEP[outcome.step]} (${parts.join(" · ")})`;
}

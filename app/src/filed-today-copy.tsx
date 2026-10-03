import type { ReactNode } from "react";

/** Empty שויכו היום. Decision 0080. */
export const FILED_TODAY_EMPTY_TITLE = "אין תנועות ששויכו היום";
export const FILED_TODAY_EMPTY_BODY =
  "כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן.";

/** Banner on לאישור. A count of 1 is singular. Assistant approvals drop the queue clause. */
export function filedTodayBannerTitle(count: number, assistant: boolean): ReactNode {
  if (count === 1) {
    return assistant ? "תנועה אחת שויכה היום" : "תנועה אחת שויכה היום בלי להמתין בתור";
  }
  const rest = assistant ? " תנועות שויכו היום" : " תנועות שויכו היום בלי להמתין בתור";
  return (
    <>
      <bdi dir="ltr">{String(count)}</bdi>
      {rest}
    </>
  );
}

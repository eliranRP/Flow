import type { ReactNode } from "react";

/** Empty שויכו היום. Decision 0080. */
export const FILED_TODAY_EMPTY_TITLE = "אין תנועות ששויכו היום";
export const FILED_TODAY_EMPTY_BODY =
  "כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן.";

/** The one-line banner on לאישור: short enough to sit on one line beside לרשימה at 320. A count of 1 is singular. */
export function filedTodayBannerTitle(count: number): ReactNode {
  if (count === 1) {
    return "אחת שויכה אוטומטית היום";
  }
  return (
    <>
      <bdi dir="ltr">{String(count)}</bdi>
      {" שויכו אוטומטית היום"}
    </>
  );
}

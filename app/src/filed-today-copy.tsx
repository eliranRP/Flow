import type { ReactNode } from "react";

/** Empty שויכו היום. Decision 0080. */
export const FILED_TODAY_EMPTY_TITLE = "אין תנועות ששויכו היום";
export const FILED_TODAY_EMPTY_BODY =
  "כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן.";

/** Banner on לאישור. A count of 1 is singular. */
export function filedTodayBannerTitle(count: number): ReactNode {
  if (count === 1) {
    return "תנועה אחת שויכה אוטומטית היום";
  }
  return (
    <>
      <bdi dir="ltr">{String(count)}</bdi>
      {" תנועות שויכו אוטומטית היום"}
    </>
  );
}

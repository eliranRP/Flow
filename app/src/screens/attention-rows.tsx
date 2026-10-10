import { formatAmountText, formatIls } from "@flow/shared";
import { missingBillsTitle, type ChargeChangeView } from "../forecast";
import type { BannerRow } from "../ui/banner";
import { HintParts } from "../ui/hint-parts";
import { CalendarIcon, DocumentIcon, TrendDownIcon, TrendUpIcon } from "../ui/icons";

// Home's attention rows, in their own file so the project page (FLOW-435) shows them without
// loading Home. HomeScreen.tsx re-exports attentionRows for its older importers.

/**
 * FLOW-321. The Home pending card: one row to Review and one to Unpaid with its
 * total, each only when it has something. A count of 1 reads singular. FLOW-403 adds a
 * third row, the late recurring bills, as a count only. FLOW-415 (b-2): late income gets its own
 * count row, and a recurring payment 20% or more off its usual amount gets a row with an up or down
 * arrow that opens it; two or more share one row, "N חיובים קבועים השתנו". The count rows open the
 * קבועים screen at their section.
 */
export function attentionRows({
  pending,
  unpaidCount,
  unpaidGross,
  unpaidOther = [],
  missingCount = 0,
  missingIncome = 0,
  missingTo = "/missing-bills",
  changes = [],
  search,
}: {
  pending: number;
  unpaidCount: number;
  unpaidGross: bigint;
  unpaidOther?: { currency: string; minor: bigint }[];
  /** Late bills (expenses). */
  missingCount?: number;
  /** FLOW-415 (b-2): late income, on its own row. */
  missingIncome?: number;
  /** The קבועים screen; each row opens it at its section. */
  missingTo?: string;
  changes?: readonly ChargeChangeView[];
  search: string;
}): BannerRow[] {
  const rows: BannerRow[] = [];
  if (pending > 0) {
    rows.push({
      id: "review",
      to: `/review${search}`,
      title: pending === 1 ? "פריט אחד ממתין לאישור" : <><bdi dir="ltr">{String(pending)}</bdi> פריטים ממתינים לאישור</>,
    });
  }
  if (unpaidCount > 0) {
    rows.push({
      id: "unpaid",
      to: `/unpaid${search}`,
      icon: <DocumentIcon size={24} stroke={1.9} />,
      title: unpaidCount === 1 ? "חשבונית פתוחה אחת" : <><bdi dir="ltr">{String(unpaidCount)}</bdi> חשבוניות פתוחות</>,
      hint: unpaidOther.length === 0 ? (
        <><bdi dir="ltr">{formatIls(unpaidGross)}</bdi> · לגבייה</>
      ) : (
        <>
          {[
            ...(unpaidGross !== 0n ? [formatIls(unpaidGross)] : []),
            ...unpaidOther.map((total) => formatAmountText(total.minor, total.currency)),
          ].map((text) => (
            <span key={text}><bdi dir="ltr">{text}</bdi> · </span>
          ))}
          לגבייה
        </>
      ),
    });
  }
  // FLOW-403 (plan option A1): a count, no hint and no total, only when a bill is late. FLOW-415
  // (b-2): late income has its own row; both open the קבועים screen at לא הגיעו.
  const count = (n: number, income: boolean) =>
    n === 1 ? missingBillsTitle(1, income) : <><bdi dir="ltr">{String(n)}</bdi> {income ? "תנועות קבועות לא הגיעו" : "חשבונות לא הגיעו"}</>;
  if (missingCount > 0) {
    rows.push({ id: "missing", to: `${missingTo}${search}#late`, icon: <CalendarIcon size={24} stroke={1.9} />, title: count(missingCount, false) });
  }
  if (missingIncome > 0) {
    rows.push({ id: "missing-income", to: `${missingTo}${search}#late`, icon: <CalendarIcon size={24} stroke={1.9} />, title: count(missingIncome, true) });
  }
  // FLOW-415: one changed charge opens its payment; two or more share a row that opens הגיעו החודש.
  const [only] = changes;
  if (changes.length === 1 && only != null) {
    rows.push({
      id: `change:${only.id}`,
      to: only.href,
      icon: only.down ? <TrendDownIcon size={24} stroke={1.9} /> : <TrendUpIcon size={24} stroke={1.9} />,
      title: only.title,
      // Each half wraps whole, and no "·" is left at the break.
      hint: <HintParts parts={[<bdi key="now" dir="ltr">{only.now}</bdi>, <>בדרך כלל <bdi dir="ltr">{only.usual}</bdi></>]} />,
    });
  } else if (changes.length > 1) {
    rows.push({
      id: "changes",
      to: `${missingTo}${search}#arrived`,
      // All drops draw the down arrow; any rise draws the up one.
      icon: changes.every((change) => change.down) ? <TrendDownIcon size={24} stroke={1.9} /> : <TrendUpIcon size={24} stroke={1.9} />,
      title: <><bdi dir="ltr">{String(changes.length)}</bdi> חיובים קבועים השתנו</>,
    });
  }
  return rows;
}

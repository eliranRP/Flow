import { formatAmountText } from "@flow/shared";
import { missingBillsTitle, type ChargeChangeView } from "../forecast";
import type { BannerRow } from "../ui/banner";
import { reviewLabel } from "../weekly-summary";
import { BankIcon, CalendarIcon, InvoiceIcon, TrendDownIcon, TrendUpIcon } from "../ui/icons";

// Home's attention rows, in their own file so the project page (FLOW-435) shows them without
// loading Home. HomeScreen.tsx re-exports attentionRows for its older importers.

/**
 * FLOW-321. The Home pending card: one row to Review and one to Unpaid with its
 * total, each only when it has something. A count of 1 reads singular. FLOW-403 adds a
 * third row, the late recurring bills, as a count only. FLOW-415 (b-2): late income gets its own
 * count row, and a recurring payment 20% or more off its usual amount gets a row with an up or down
 * arrow that opens it; two or more share one row, "N חיובים קבועים השתנו". The count rows open the
 * קבועים screen at their section. FLOW-941: the transfers between two Mercury connections Flow suggests get a
 * count row under the review row, opening העברות לבדיקה.
 */
export function attentionRows({
  pending,
  transfers = 0,
  unpaidCount,
  unpaidGross,
  currency = "ILS",
  unpaidOther = [],
  missingCount = 0,
  missingIncome = 0,
  missingTo = "/missing-bills",
  changes = [],
  search,
}: {
  pending: number;
  /** FLOW-941: suggested transfers between two Mercury connections. */
  transfers?: number;
  unpaidCount: number;
  unpaidGross: bigint;
  /** The company's base currency for the open invoices' total (ILS when not given). */
  currency?: string;
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
      // FLOW-958: the label of Home's one filled button, as the weekly sheet words it.
      title: reviewLabel(pending),
    });
  }
  if (transfers > 0) {
    rows.push({
      id: "transfers",
      to: `/transfers${search}`,
      // The bank icon Home already loads (between two bank accounts), not one more icon in its first load.
      icon: <BankIcon size={24} stroke={1.9} />,
      title: transfers === 1 ? "העברה אחת לבדיקה" : <><bdi dir="ltr">{String(transfers)}</bdi> העברות לבדיקה</>,
      hint: "בין חשבונות Mercury",
    });
  }
  if (unpaidCount > 0) {
    rows.push({
      id: "unpaid",
      to: `/unpaid${search}`,
      icon: <InvoiceIcon />,
      title: unpaidCount === 1 ? "חשבונית פתוחה אחת" : <><bdi dir="ltr">{String(unpaidCount)}</bdi> חשבוניות פתוחות</>,
      hint: unpaidOther.length === 0 ? (
        <><bdi dir="ltr">{formatAmountText(unpaidGross, currency)}</bdi> · לגבייה</>
      ) : (
        <>
          {[
            ...(unpaidGross !== 0n ? [formatAmountText(unpaidGross, currency)] : []),
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
      // One line, cut at its end only when it does not fit (43-home.css).
      hint: <><bdi dir="ltr">{only.now}</bdi> במקום <bdi dir="ltr">{only.usual}</bdi> · חיוב קבוע</>,
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

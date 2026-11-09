import { formatAmountText } from "@flow/shared";
import { missingBillsTitle, type ChargeChangeView } from "../forecast";
import { countTag } from "../ui/attention-cards";
import type { BannerRow } from "../ui/banner";
import type { UtilityRefundCount } from "../utility-refund-count";
import { reviewItems, reviewMinutes } from "../weekly-summary";
import { BankIcon, CalendarIcon, InvoiceIcon, TrendDownIcon, TrendUpIcon } from "../ui/icons";

// Home's attention rows, in their own file so the project page (FLOW-435) shows them without
// loading Home. HomeScreen.tsx re-exports attentionRows for its older importers.

/**
 * FLOW-321. The Home pending card: one row to Review and one to Unpaid with its
 * total, each only when it has something. A count of 1 reads singular. FLOW-403 adds a
 * third row, the late recurring bills, as a count only. FLOW-415 (b-2): late income gets its own
 * count row, and a recurring payment 20% or more off its usual amount gets a row with an up or down
 * arrow that opens it; two or more share one row, "N חיובים קבועים השתנו", that opens the list of
 * those charges (FLOW-1021). FLOW-1036: every row but the review carries its `dismissKey`, `<id>:<count>[:<amount>]`,
 * so a row hidden on Home's cards shows again once what it counts changes. The late count rows open the קבועים screen at their section. FLOW-941: the transfers between two Mercury connections Flow suggests get a
 * count row under the review row, opening העברות לבדיקה. FLOW-1135: the utility bills the tenant did not pay back get
 * a row after it (V3-Home-UtilityRefunds), opening החזרי חשבונות.
 */
export function attentionRows({
  pending,
  transfers = 0,
  utilities,
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
  /** FLOW-1135: the utility bills not refunded and the suggested refunds (count_utility_refunds). */
  utilities?: UtilityRefundCount;
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
      title: pending === 1 ? "פריט אחד ממתין לאישור" : <><bdi dir="ltr">{String(pending)}</bdi> פריטים ממתינים לאישור</>,
      short: "לאישור",
      tag: countTag(pending, "פריט אחד", "פריטים"),
      // FLOW-958, FLOW-961: Home and the project page draw this row as their one filled button
      // (ReviewButton), worded as the weekly sheet's; the time is drawn smaller so the label holds one line at 320.
      button: { label: reviewItems(pending), hint: reviewMinutes(pending) },
    });
  }
  if (transfers > 0) {
    rows.push({
      id: "transfers",
      dismissKey: `transfers:${String(transfers)}`,
      to: `/transfers${search}`,
      // The bank icon Home already loads (between two bank accounts), not one more icon in its first load.
      icon: <BankIcon size={24} stroke={1.9} />,
      title: transfers === 1 ? "העברה אחת לבדיקה" : <><bdi dir="ltr">{String(transfers)}</bdi> העברות לבדיקה</>,
      short: "לבדיקה",
      tag: countTag(transfers, "העברה אחת", "העברות"),
      hint: "בין חשבונות Mercury",
    });
  }
  const utilityRow = utilities == null ? null : utilityRefundsRow(utilities, `/utility-refunds${search}`);
  if (utilityRow != null) rows.push(utilityRow);
  if (unpaidCount > 0) {
    rows.push({
      id: "unpaid",
      dismissKey: `unpaid:${String(unpaidCount)}:${String(unpaidGross)}`,
      to: `/unpaid${search}`,
      icon: <InvoiceIcon />,
      // The board's title carries the total: "3 חשבוניות פתוחות · $21,300" (V3-Home); the card draws only the title.
      title: unpaidOther.length === 0 && unpaidGross !== 0n ? (
        <>{unpaidCount === 1 ? "חשבונית פתוחה אחת" : <><bdi dir="ltr">{String(unpaidCount)}</bdi> חשבוניות פתוחות</>} · <bdi dir="ltr">{formatAmountText(unpaidGross, currency)}</bdi></>
      ) : unpaidCount === 1 ? "חשבונית פתוחה אחת" : <><bdi dir="ltr">{String(unpaidCount)}</bdi> חשבוניות פתוחות</>,
      // FLOW-1097: under 360px "לגבייה" and the one total ("חשבוניות פתוחות" and a total do not fit at 320); with no
      // one total, the invoices' count.
      short: "לגבייה",
      tag: unpaidOther.length === 0 && unpaidGross !== 0n ? formatAmountText(unpaidGross, currency) : countTag(unpaidCount, "חשבונית אחת", "חשבוניות"),
      // The title carries the one total (above), so a list that draws the hint (the project page's rows) does not repeat it.
      hint: unpaidOther.length === 0 ? (
        unpaidGross !== 0n ? "לגבייה" : <><bdi dir="ltr">{formatAmountText(unpaidGross, currency)}</bdi> · לגבייה</>
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
    rows.push({ id: "missing", dismissKey: `missing:${String(missingCount)}`, to: `${missingTo}${search}#late`, icon: <CalendarIcon size={24} stroke={1.9} />, title: count(missingCount, false), short: "לא הגיעו", tag: countTag(missingCount, "חשבון אחד", "חשבונות") });
  }
  if (missingIncome > 0) {
    rows.push({ id: "missing-income", dismissKey: `missing-income:${String(missingIncome)}`, to: `${missingTo}${search}#late`, icon: <CalendarIcon size={24} stroke={1.9} />, title: count(missingIncome, true), short: "לא הגיעו", tag: countTag(missingIncome, "הכנסה אחת", "הכנסות") });
  }
  // FLOW-415: one changed charge opens its payment. FLOW-1021: two or more share a row that opens
  // חיובים שהשתנו, the list of just those charges, each with its amount and its usual one.
  const [only] = changes;
  if (changes.length === 1 && only != null) {
    rows.push(changeRow(only));
  } else if (changes.length > 1) {
    rows.push({
      id: "changes",
      // Which charges changed, not only how many: another change in their place shows the row again.
      dismissKey: `changes:${String(changes.length)}:${changes.map((change) => change.id).join("+")}`,
      to: `/recurring/changes${search}`,
      // All drops draw the down arrow; any rise draws the up one.
      icon: changes.every((change) => change.down) ? <TrendDownIcon size={24} stroke={1.9} /> : <TrendUpIcon size={24} stroke={1.9} />,
      title: <><bdi dir="ltr">{String(changes.length)}</bdi> חיובים קבועים השתנו</>,
      short: "חיובים קבועים השתנו",
      tag: String(changes.length),
    });
  }
  return rows;
}

/**
 * One changed recurring charge: its arrow, "חשמל עלה", and "₪2,550 במקום ₪1,850"; it opens the payment.
 * Home says "· חיוב קבוע" after it; the changed-charges list (FLOW-1021) is all recurring, so it leaves that out.
 */
export function changeRow(change: ChargeChangeView, { saysRecurring = true }: { saysRecurring?: boolean } = {}): BannerRow {
  return {
    id: `change:${change.id}`,
    dismissKey: `change:${change.id}:${change.now}`,
    to: change.href,
    icon: change.down ? <TrendDownIcon size={24} stroke={1.9} /> : <TrendUpIcon size={24} stroke={1.9} />,
    title: change.title,
    // FLOW-1097: under 360px "חשמל עלה" and its new amount; the usual one is on the payment.
    short: change.title,
    tag: change.now,
    // One line, cut at its end only when it does not fit (43-home.css).
    hint: <><bdi dir="ltr">{change.now}</bdi> במקום <bdi dir="ltr">{change.usual}</bdi>{saysRecurring ? " · חיוב קבוע" : null}</>,
  };
}

/**
 * FLOW-1135 (V3-Home-UtilityRefunds, V3-Project-Rent-Utilities): "N חשבונות לא הוחזרו · $X", only when there is one;
 * with only suggestions left, "N החזרים לבדיקה". One currency shows its total; several show the count alone. The
 * suggestions count in its dismissKey, so a new one brings back a hidden row. Home and the property page share it.
 */
export function utilityRefundsRow({ notRefunded, totals, suggested }: UtilityRefundCount, to: string): BannerRow | null {
  if (notRefunded === 0 && suggested === 0) return null;
  const [only] = totals.length === 1 ? totals : [];
  const total = only == null ? null : formatAmountText(only.minor, only.currency, { detail: true });
  const dismissKey = `utility-refunds:${String(notRefunded)}:${String(suggested)}:${totals.map((row) => `${row.currency}${String(row.minor)}`).join("+")}`;
  if (notRefunded === 0) {
    return {
      id: "utility-refunds",
      dismissKey,
      to,
      icon: <InvoiceIcon />,
      title: suggested === 1 ? "החזר אחד לבדיקה" : <><bdi dir="ltr">{String(suggested)}</bdi> החזרים לבדיקה</>,
      short: "החזרים לבדיקה",
      tag: String(suggested),
    };
  }
  const count = notRefunded === 1 ? "חשבון אחד לא הוחזר" : <><bdi dir="ltr">{String(notRefunded)}</bdi> חשבונות לא הוחזרו</>;
  return {
    id: "utility-refunds",
    dismissKey,
    to,
    icon: <InvoiceIcon />,
    title: total == null ? count : <>{count} · <bdi dir="ltr">{total}</bdi></>,
    // FLOW-1097: under 360px the short title and the total (or the count) on one line.
    short: "לא הוחזרו",
    tag: total ?? countTag(notRefunded, "חשבון אחד", "חשבונות"),
  };
}

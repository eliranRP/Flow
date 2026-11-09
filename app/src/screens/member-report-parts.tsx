import { formatMoney, type MemberShareResult, type PropertyShare } from "@flow/shared";
import type { ReactNode } from "react";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { formatDisplay } from "../ui/date-math";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { israelSyncPhrase } from "../sumit-copy";
import { bpText, type DrillKey, type ReportMode } from "./member-report-format";
import { investmentBase } from "./project-returns-parts";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1121: one row of החישוב, opened. Its figure per property (or per member, for the share) and the total,
 * every number from computeMemberShare's result. The selling cost's sheet lets the owner change the percents.
 * ---------------------------------------------------------------------------------------------- */

/**
 * FLOW-1121: when the Treasury's yields were last fetched ("עודכן ב-14:05", "עוד לא עודכן"), and for the owner or an
 * editor, רענון, which asks for them now. On the rate card and at the top of the yields sheet.
 */
export function TreasuryUpdated({ fetchedAt, onRefresh, busy }: { fetchedAt: string | null | undefined; onRefresh?: () => void; busy: boolean }) {
  return (
    <p className="ui-msr-yield-source ui-msr-updated">
      <span>{israelSyncPhrase(fetchedAt) ?? "עוד לא עודכן"}</span>
      {onRefresh == null ? null : (
        <>
          <span aria-hidden="true">·</span>
          <Button variant="link" disabled={busy} onClick={onRefresh} aria-label="רענון תשואות האג״ח">רענון</Button>
        </>
      )}
    </p>
  );
}

type Line = { key: string; title: string; hint: string; minor: bigint; property?: PropertyShare; muted?: boolean };

type Drill = { title: string; help: string; lines: Line[]; total: bigint; totalLabel: string };

const NOT_REFINANCED = "לא ממוחזר, לא נספר";

/** What one row of החישוב is made of. Exported for its tests. */
export function drillOf(key: DrillKey, mode: ReportMode, r: MemberShareResult, currency: string): Drill {
  const money = (minor: bigint) => formatMoney(minor, currency);
  const t = r.totals;
  const props = r.properties;
  const each = (title: string, help: string, total: bigint, line: (p: PropertyShare) => Omit<Line, "key" | "title" | "property">): Drill => ({
    title, help, total, totalLabel: "סה״כ",
    lines: props.map((p) => ({ key: p.projectId, title: p.name, property: p, ...line(p) })),
  });
  const refi = (p: PropertyShare, hint: string, minor: bigint) => (p.refinances ? { hint, minor } : { hint: `${NOT_REFINANCED} · ${hint}`, minor, muted: true });
  switch (key) {
    case "value":
      return each("שווי הנכסים", "השווי מההערכה האחרונה של כל נכס, כפי שנרשם בעמוד הנכס.", t.valueMinor,
        (p) => ({ hint: p.valueDate == null ? "בלי תאריך הערכה" : `הערכה מ־${formatDisplay(p.valueDate)}`, minor: p.valueMinor }));
    case "selling":
      return each("עלויות מכירה", "תיווך, עלויות סגירה ומסים במכירה: האחוז של כל נכס כפול השווי שלו. בלי אחוז משלו, 8%.", t.sellingCostMinor,
        (p) => ({ hint: `${bpText(p.sellingCostBp)}${p.sellingCostDefault ? " (ברירת מחדל)" : ""} × ${money(p.valueMinor)}`, minor: p.sellingCostMinor }));
    case "loans":
      return each("סילוק הלוואות", "היתרה היום של ההלוואות הפתוחות של כל נכס.", t.loanBalanceMinor,
        (p) => ({ hint: p.loanBalanceMinor === 0n ? "אין הלוואה פתוחה" : "יתרות היום", minor: p.loanBalanceMinor }));
    case "net":
      return each("הון נקי", "מה שנשאר לחברה ממכירת כל נכס: שווי, פחות עלויות המכירה, פחות ההלוואות.", t.saleNetMinor,
        (p) => ({ hint: `${money(p.valueMinor)} − ${money(p.sellingCostMinor)} − ${money(p.loanBalanceMinor)}`, minor: p.saleNetMinor }));
    case "loan":
      return each("הלוואה חדשה", `${bpText(r.assumptions.ltvBp)} מהשווי של כל נכס. נספרים רק נכסים שמשחררים כסף.`, t.newLoanMinor,
        (p) => refi(p, `${bpText(r.assumptions.ltvBp)} × ${money(p.valueMinor)}`, p.newLoanMinor));
    case "payoff":
      return each("סילוק ההלוואות הקיימות", "ההלוואה החדשה מסלקת את ההלוואות הפתוחות של הנכס.", t.payoffMinor,
        (p) => refi(p, "יתרות היום", p.loanBalanceMinor));
    case "closing":
      return each("עלויות סגירה", `${bpText(r.assumptions.closingBp)} מההלוואה החדשה של כל נכס.`, t.closingMinor,
        (p) => refi(p, `${bpText(r.assumptions.closingBp)} × ${money(p.newLoanMinor)}`, p.closingMinor));
    case "cash":
      return each("כסף שמשתחרר", "הלוואה חדשה, פחות הסילוק, פחות עלויות הסגירה. נכס שלא משחרר כסף לא ממוחזר.", t.cashOutMinor,
        (p) => refi(p, `${money(p.newLoanMinor)} − ${money(p.loanBalanceMinor)} − ${money(p.closingMinor)}`, p.cashOutMinor));
    case "share": {
      const whole = mode === "sell" ? t.saleNetMinor : t.cashOutMinor;
      return {
        title: "החלק של כל שותף",
        help: `אחוז הבעלות של כל שותף כפול ${mode === "sell" ? "ההון הנקי" : "הכסף שמשתחרר"} של החברה.`,
        total: whole,
        totalLabel: "לכל השותפים",
        lines: r.members.map((m) => ({
          key: m.name,
          title: m.name,
          hint: `${bpText(m.ownershipBp)} × ${money(whole)}`,
          minor: mode === "sell" ? m.saleMinor : m.refinanceMinor,
        })),
      };
    }
  }
}

export function DrillSheet({ drill, mode, onOpenChange, result, currency, search, onEditSelling }: {
  drill: DrillKey | null;
  mode: ReportMode;
  onOpenChange: (open: boolean) => void;
  result: MemberShareResult;
  currency: string;
  search: string;
  /** The owner's selling-cost editor: one property's id, or null for every property. Absent for a viewer. */
  onEditSelling?: (projectId: string | null) => void;
}) {
  const d = drill == null ? null : drillOf(drill, mode, result, currency);
  const editing = drill === "selling" ? onEditSelling : undefined;
  let rows: ReactNode = null;
  if (d != null) {
    rows = d.lines.map((line) => {
      const p = line.property;
      const common = { title: line.title, hint: line.hint, agorot: line.minor, currency, loss: line.minor < 0n } as const;
      if (p != null && editing != null) {
        return <ListRow key={line.key} variant="project" {...common} onClick={() => { editing(p.projectId); }} />;
      }
      return <ListRow key={line.key} variant="project" {...common} href={p == null ? undefined : `${investmentBase(p.projectId)}${search}`} />;
    });
  }
  return (
    <Sheet open={drill != null} onOpenChange={onOpenChange} title={d?.title ?? ""} panelClassName="ui-sheet-wide ui-msr-sheet">
      {d == null ? null : (
        <>
          <p className="ui-msr-help">{d.help}</p>
          <List>{rows}</List>
          <p className="ui-msr-drill-total">
            <span>{d.totalLabel}</span>
            <Amount agorot={d.total} currency={currency} loss={d.total < 0n} />
          </p>
          {editing == null ? null : <Button variant="secondary" full onClick={() => { editing(null); }}>שינוי האחוז לכל הנכסים</Button>}
        </>
      )}
    </Sheet>
  );
}

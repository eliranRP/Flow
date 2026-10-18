import type { ReactNode, RefObject } from "react";
import { Link } from "react-router-dom";
import { Amount } from "../ui/amount";
import { formatDisplay } from "../ui/date-math";
import { ChevronIcon } from "../ui/icons";
import {
  INVESTMENT_LABELS,
  currencyWord,
  currentEquityNote,
  forcedEquityNote,
  type EquityNote,
  type InvestmentField,
  type InvestmentFigures,
  type MinorInCurrency,
} from "../ui/investment-card";
import { LOAN_STATUS_LABEL } from "./loan-copy";
import { formatRatePpm, rateInForce } from "./loan-detail-data";
import { formatLoanMoney } from "./loan-form";
import { loanOutlook, wholeMinor } from "./loan-outlook";
import type { InvestmentLoan } from "./project-investment-data";

/** What the cards ask the screen to open. A viewer's cards open nothing. */
export type InvestmentRowRefs = Record<InvestmentField | "rehab", RefObject<HTMLButtonElement | null>>;

export const FORCED_FORMULA = "ARV פחות קנייה ושיפוץ";
export const CURRENT_FORMULA = "שווי היום פחות הלוואות";

/** A figure to add first: the ARV, else the purchase price; today's value for the other column. */
function firstMissing(figures: InvestmentFigures, column: "forced" | "current"): InvestmentField | null {
  if (column === "current") return figures.valueMinor == null ? "value" : null;
  if (figures.arvMinor == null) return "arv";
  return figures.purchaseMinor == null ? "purchase" : null;
}

function EquityColumn({
  label,
  formula,
  minor,
  note,
  currency,
  add,
  addRef,
}: {
  label: string;
  formula: string;
  minor: bigint | null;
  note: EquityNote | null;
  currency: string;
  /** Opens the sheet of the figure that is missing; absent for a viewer or when nothing is missing. */
  add: (() => void) | undefined;
  addRef: RefObject<HTMLButtonElement | null> | undefined;
}) {
  return (
    <div className="ui-pinv-equity-col">
      <span className="ui-pinv-hint">{label}</span>
      {minor != null ? (
        <>
          <span className="ui-pinv-equity-figure">
            <Amount agorot={minor} currency={currency} size="card" loss={minor < 0n} />
          </span>
          <span className="ui-pinv-hint ui-pinv-formula">{formula}</span>
        </>
      ) : (
        <>
          <span className="ui-pinv-missing">{note?.text ?? "לא מחושב"}</span>
          {note?.kind === "missing" && add != null ? (
            <button type="button" ref={addRef} className="ui-pinv-add" onClick={add}>הוספה</button>
          ) : null}
        </>
      )}
    </div>
  );
}

function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  return Math.round((Number(part) / Number(whole)) * 100);
}

/** The top card: the two equities, then today's value split between equity and loans. */
export function EquityCard({
  figures,
  onAdd,
  rows,
}: {
  figures: InvestmentFigures;
  /** Opens a figure's edit sheet; absent for a viewer. */
  onAdd: ((field: InvestmentField) => void) | undefined;
  rows: InvestmentRowRefs;
}) {
  const { currency } = figures;
  const forcedField = firstMissing(figures, "forced");
  const currentField = firstMissing(figures, "current");
  const equity = figures.currentEquityMinor;
  const share = equity != null && figures.valueMinor != null ? percentOf(equity, figures.valueMinor) : null;
  return (
    <section className="ui-pinv-card ui-pinv-equity" aria-label="הון עצמי והשבחה">
      <div className="ui-pinv-equity-grid">
        <EquityColumn
          label="השבחה צפויה"
          formula={FORCED_FORMULA}
          minor={figures.forcedEquityMinor}
          note={forcedEquityNote(figures)}
          currency={currency}
          add={onAdd != null && forcedField != null ? () => { onAdd(forcedField); } : undefined}
          addRef={forcedField == null ? undefined : rows[forcedField]}
        />
        <EquityColumn
          label="הון עצמי היום"
          formula={CURRENT_FORMULA}
          minor={equity}
          note={currentEquityNote(figures)}
          currency={currency}
          add={onAdd != null && currentField != null ? () => { onAdd(currentField); } : undefined}
          addRef={currentField == null ? undefined : rows[currentField]}
        />
      </div>
      <div className="ui-pinv-split">
        {equity == null ? null : (
          <div className="ui-pinv-bar" aria-hidden="true">
            <span className="ui-pinv-bar-loan" style={{ flexGrow: Number(figures.loanMinor) }} />
            <span className="ui-pinv-bar-own" style={{ flexGrow: Number(equity > 0n ? equity : 0n) }} />
          </div>
        )}
        <div className="ui-pinv-legend ui-pinv-hint">
          {share == null ? <span /> : (
            <span><span className="ui-pinv-dot ui-pinv-dot-own" aria-hidden="true" />{"הון עצמי "}<bdi dir="ltr">{`${String(share)}%`}</bdi></span>
          )}
          <span>
            <span className="ui-pinv-dot ui-pinv-dot-loan" aria-hidden="true" />{"הלוואות "}
            <bdi dir="ltr"><Amount agorot={figures.loanMinor} currency={currency} /></bdi>
          </span>
        </div>
      </div>
    </section>
  );
}

function OtherNote({ list, note }: { list: readonly MinorInCurrency[]; note?: string }) {
  if (list.length === 0) return null;
  return (
    <span className="ui-pinv-hint">
      {list.map((item, index) => (
        <span key={item.currency}>
          {index > 0 ? " · " : null}
          {"ועוד "}
          <Amount agorot={item.minor} currency={item.currency} />
          {` ${currencyWord(item.currency)}`}
        </span>
      ))}
      {note ? `, ${note}` : null}
    </span>
  );
}

function FigureRow({
  title,
  note,
  value,
  onOpen,
  buttonRef,
}: {
  title: string;
  note?: ReactNode;
  value: ReactNode;
  onOpen: (() => void) | undefined;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const body = (
    <>
      <span className="ui-pinv-row-text">
        <span className="ui-pinv-row-title">{title}</span>
        {note == null ? null : <span className="ui-pinv-hint">{note}</span>}
      </span>
      {value}
      {onOpen == null ? null : <span className="ui-pinv-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>}
    </>
  );
  return onOpen == null ? <div className="ui-pinv-row">{body}</div> : (
    <button type="button" ref={buttonRef} className="ui-pinv-row" onClick={onOpen}>{body}</button>
  );
}

function FigureValue({ minor, currency, readOnly }: { minor: bigint | null; currency: string; readOnly: boolean }) {
  if (minor != null) return <bdi dir="ltr" className="ui-pinv-value"><Amount agorot={minor} currency={currency} /></bdi>;
  // A viewer sees no הוספה: nothing on the card opens (FLOW-404).
  if (readOnly) return <span className="ui-pinv-value ui-pinv-value-empty">לא הוזן</span>;
  return <span className="ui-pinv-value ui-pinv-value-add">הוספה</span>;
}

/** "נתוני הנכס": the four figures; each opens its sheet (a viewer's open nothing). */
export function FiguresCard({
  figures,
  readOnly,
  onEdit,
  onRehab,
  rows,
}: {
  figures: InvestmentFigures;
  readOnly: boolean;
  onEdit: (field: InvestmentField) => void;
  onRehab: () => void;
  rows: InvestmentRowRefs;
}) {
  const { currency } = figures;
  const open = (field: InvestmentField) => (readOnly ? undefined : () => { onEdit(field); });
  return (
    <section className="ui-pinv-card" aria-label="נתוני הנכס">
      <h2 className="ui-pinv-card-title">נתוני הנכס</h2>
      <FigureRow
        title={INVESTMENT_LABELS.purchase}
        value={<FigureValue minor={figures.purchaseMinor} currency={currency} readOnly={readOnly} />}
        onOpen={open("purchase")}
        buttonRef={rows.purchase}
      />
      <FigureRow
        title="שיפוץ עד היום"
        note={(
          <>
            {"מחושב מההוצאות · לפירוט"}
            {figures.rehabOther.length > 0 ? <>{" · "}<OtherNote list={figures.rehabOther} /></> : null}
          </>
        )}
        value={<FigureValue minor={figures.rehabMinor} currency={currency} readOnly={readOnly} />}
        onOpen={readOnly ? undefined : onRehab}
        buttonRef={rows.rehab}
      />
      <FigureRow
        title={INVESTMENT_LABELS.arv}
        note="הערכה שלך"
        value={<FigureValue minor={figures.arvMinor} currency={currency} readOnly={readOnly} />}
        onOpen={open("arv")}
        buttonRef={rows.arv}
      />
      <FigureRow
        title={INVESTMENT_LABELS.value}
        note={figures.valueMinor != null && figures.valueDate != null
          ? <>{"נכון ל־"}<bdi dir="ltr" className="ui-num">{formatDisplay(figures.valueDate)}</bdi></>
          : undefined}
        value={<FigureValue minor={figures.valueMinor} currency={currency} readOnly={readOnly} />}
        onOpen={open("value")}
        buttonRef={rows.value}
      />
    </section>
  );
}

/** "10.5% · תשלום הבא $1,837 ב־01/11"; a paid-off loan says when it ended. */
export function loanNote(loan: InvestmentLoan, today: string): ReactNode {
  if (loan.status !== "open") {
    const label = LOAN_STATUS_LABEL[loan.status === "paid_off" ? "paid_off" : "closed"];
    return loan.closedOn == null ? label : `${label} ב־${loan.closedOn.slice(5, 7)}/${loan.closedOn.slice(0, 4)}`;
  }
  const terms = loan.terms;
  if (terms == null) return null;
  const rate = formatRatePpm(rateInForce(terms, today).ppm);
  const outlook = loanOutlook({ ...terms, status: "open", balanceMinor: loan.balance_minor }, today);
  if (outlook == null) return rate;
  const currency = loan.currency === "USD" ? "USD" : "ILS";
  const due = outlook.next.dueDate;
  const amount = outlook.next.principalMinor + outlook.next.interestMinor + outlook.next.escrowMinor;
  return (
    <>
      {`${rate} · תשלום הבא `}
      <bdi dir="ltr" className="ui-num">{formatLoanMoney(wholeMinor(amount), currency)}</bdi>
      {` ב־${due.slice(8, 10)}/${due.slice(5, 7)}`}
    </>
  );
}

function LoanLine({ loan, today, search }: { loan: InvestmentLoan; today: string; search: string }) {
  const note = loanNote(loan, today);
  const closed = loan.status !== "open";
  return (
    <Link to={`/loans/${loan.id}${search}`} className={closed ? "ui-pinv-loan ui-pinv-loan-closed" : "ui-pinv-loan"}>
      <span className="ui-pinv-initial" aria-hidden="true">{loan.name.trim().slice(0, 1)}</span>
      <span className="ui-pinv-row-text">
        <span className="ui-pinv-row-title">{loan.name}</span>
        {note == null ? null : <span className="ui-pinv-hint">{note}</span>}
      </span>
      <bdi dir="ltr" className="ui-pinv-value"><Amount agorot={loan.balance_minor} currency={loan.currency} /></bdi>
      {closed ? null : <span className="ui-pinv-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>}
    </Link>
  );
}

/** "הלוואות": the project's loans, the total at the title's end, then "+ הוספת הלוואה". */
export function LoansCard({
  figures,
  loans,
  today,
  search,
  onAdd,
}: {
  figures: InvestmentFigures;
  loans: readonly InvestmentLoan[];
  today: string;
  search: string;
  /** Absent for a viewer. */
  onAdd: (() => void) | undefined;
}) {
  const own = loans.filter((loan) => loan.currency === figures.currency);
  const other = loans.filter((loan) => loan.currency !== figures.currency);
  return (
    <section className="ui-pinv-card" aria-label="הלוואות">
      <div className="ui-pinv-loans-head">
        <h2 className="ui-pinv-card-title">הלוואות</h2>
        <bdi dir="ltr" className="ui-pinv-total"><Amount agorot={figures.loanMinor} currency={figures.currency} /></bdi>
      </div>
      {own.map((loan) => <LoanLine key={loan.id} loan={loan} today={today} search={search} />)}
      {other.length > 0 ? (
        <>
          <p className="ui-pinv-hint ui-pinv-other-head">במטבע אחר · לא נכנסות להון העצמי</p>
          {other.map((loan) => <LoanLine key={loan.id} loan={loan} today={today} search={search} />)}
        </>
      ) : null}
      {onAdd == null ? null : (
        <button type="button" className="ui-pinv-add-loan" onClick={onAdd}>+ הוספת הלוואה</button>
      )}
    </section>
  );
}

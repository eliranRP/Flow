import { useId, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { Amount } from "../ui/amount";
import { GroupHead } from "../ui/group-head";
import { formatDisplay } from "../ui/date-math";
import { ChevronIcon } from "../ui/icons";
import {
  INVESTMENT_LABELS,
  currencyWord,
  type InvestmentField,
  type InvestmentFigures,
  type MinorInCurrency,
} from "../ui/investment-card";
import { LOAN_STATUS_LABEL } from "./loan-copy";
import { formatRatePpm, rateInForce } from "./loan-detail-data";
import { formatLoanMoney } from "./loan-form";
import { loanOutlook, wholeMinor } from "./loan-outlook";
import type { InvestmentLoan } from "./project-investment-data";
import { UNITS_DEFAULT_HINT } from "./project-returns-info";

/** What the cards ask the screen to open. A viewer's cards open nothing. */
export type InvestmentRowRefs = Record<InvestmentField, RefObject<HTMLButtonElement | null>>;

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
  href,
  buttonRef,
}: {
  title: string;
  note?: ReactNode;
  value: ReactNode;
  onOpen: (() => void) | undefined;
  /** A link instead of a sheet (the purchase from the lines opens them). */
  href?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const body = (
    <>
      <span className="ui-pinv-row-text">
        <span className="ui-pinv-row-title">{title}</span>
        {note == null ? null : <span className="ui-pinv-hint">{note}</span>}
      </span>
      {value}
      {onOpen == null && href == null ? null : <span className="ui-pinv-chevron" aria-hidden="true"><ChevronIcon size={18} /></span>}
    </>
  );
  if (href != null) return <Link to={href} className="ui-pinv-row m-press">{body}</Link>;
  return onOpen == null ? <div className="ui-pinv-row">{body}</div> : (
    <button type="button" ref={buttonRef} className="ui-pinv-row m-press" onClick={onOpen}>{body}</button>
  );
}

/** `quiet`: another control is the row's one action (FLOW-470: the land the books suggest). */
function FigureValue({ minor, currency, readOnly, quiet = false }: { minor: bigint | null; currency: string; readOnly: boolean; quiet?: boolean }) {
  if (minor != null) return <bdi dir="ltr" className="ui-pinv-value"><Amount agorot={minor} currency={currency} /></bdi>;
  // A viewer sees no הוספה: nothing on the card opens (FLOW-404).
  if (readOnly || quiet) return <span className="ui-pinv-value ui-pinv-value-empty">לא הוזן</span>;
  return <span className="ui-pinv-value ui-pinv-value-add">הוספה</span>;
}

/**
 * The figures only the returns read carries (FLOW-451): null while it loads. FLOW-453: the purchase
 * as the returns count it, from the acquisition lines when there are any.
 */
export type PropertyExtras = {
  landMinor: bigint | null;
  /** 1 until the owner sets it (`unitsDefault`, decision 0246). */
  units: number;
  unitsDefault: boolean;
  purchaseMinor: bigint | null;
  purchaseSource: "lines" | "typed" | null;
  /** A loan taken over at closing, inside the purchase; 0 when none. */
  takenOverMinor: bigint;
  /** FLOW-461 (decision 0248): where the land comes from, its account, and a suggested one. */
  landSource: "typed" | "books" | null;
  landAccount: { id: string; name: string } | null;
  landSuggestion: { accountId: string; name: string; minor: bigint } | null;
};

/** "מהספרים: Land · $46,300" and השתמש: the land account the books suggest, before one is named. */
function LandSuggestion({ suggestion, currency, busy, onUse }: {
  suggestion: NonNullable<PropertyExtras["landSuggestion"]>;
  currency: string;
  busy: boolean;
  onUse: (accountId: string) => void;
}) {
  return (
    <div className="ui-pinv-suggest">
      <span className="ui-pinv-hint">
        {"מהספרים: "}
        <bdi>{suggestion.name}</bdi>
        {" · "}
        <bdi dir="ltr" className="ui-num"><Amount agorot={suggestion.minor} currency={currency} /></bdi>
      </span>
      <Button variant="link" busy={busy} aria-label={`השתמש בשווי הקרקע מהספרים: ${suggestion.name}`} onClick={() => { onUse(suggestion.accountId); }}>השתמש</Button>
    </div>
  );
}

/**
 * "נתוני הנכס" (the נכס tab): the figures under a one-line group head; each opens its sheet (a viewer's open
 * nothing but the rehab page, which only reads).
 */
export function FiguresGroup({
  figures,
  extras,
  readOnly,
  onEdit,
  rows,
  linesHref,
  rehabHref,
  onUseLand,
  landBusy = false,
}: {
  figures: InvestmentFigures;
  extras: PropertyExtras | null;
  /** Where the purchase from the lines opens: its line page. */
  linesHref: string;
  /** FLOW-460: the renovation so far opens its own page. */
  rehabHref: string;
  readOnly: boolean;
  onEdit: (field: InvestmentField) => void;
  rows: InvestmentRowRefs;
  /** FLOW-461: names the suggested land account (set_land_account); absent for a viewer. */
  onUseLand?: (accountId: string) => void;
  landBusy?: boolean;
}) {
  const { currency } = figures;
  const open = (field: InvestmentField) => (readOnly ? undefined : () => { onEdit(field); });
  const fromLines = extras?.purchaseSource === "lines" && extras.purchaseMinor != null;
  const source = extras != null && extras.takenOverMinor > 0n ? "מהתנועות + הלוואה שנלקחה" : "מהתנועות";
  // FLOW-470: while the books suggest a land, השתמש is the land row's one action.
  const suggestion = extras?.landMinor == null && onUseLand != null ? (extras?.landSuggestion ?? null) : null;
  const titleId = useId();
  return (
    <section className="ui-month ui-pinv-group" aria-labelledby={titleId}>
      <GroupHead id={titleId} title="נתוני הנכס" summary="" />
      {fromLines ? (
        // FLOW-453: the purchase comes from the acquisition lines; it opens them, with no edit sheet.
        <FigureRow
          title={INVESTMENT_LABELS.purchase}
          note={readOnly ? source : `${source} · לפירוט ולתיקון`}
          value={<FigureValue minor={extras.purchaseMinor} currency={currency} readOnly={readOnly} />}
          onOpen={undefined}
          href={readOnly ? undefined : linesHref}
        />
      ) : (
        <FigureRow
          title={INVESTMENT_LABELS.purchase}
          value={<FigureValue minor={figures.purchaseMinor} currency={currency} readOnly={readOnly} />}
          onOpen={open("purchase")}
          buttonRef={rows.purchase}
        />
      )}
      <FigureRow
        title="שיפוץ עד היום"
        note={(
          <>
            {"מחושב מההוצאות · לפירוט"}
            {figures.rehabOther.length > 0 ? <>{" · "}<OtherNote list={figures.rehabOther} /></> : null}
          </>
        )}
        value={<FigureValue minor={figures.rehabMinor} currency={currency} readOnly={readOnly} />}
        onOpen={undefined}
        href={rehabHref}
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
      {extras == null ? null : (
        <>
          <FigureRow
            title={INVESTMENT_LABELS.land}
            note={extras.landSource === "books" && extras.landAccount != null
              ? <>{"מהספרים · "}<bdi>{extras.landAccount.name}</bdi></>
              : "בלי פחת · לחישוב חיסכון המס"}
            value={<FigureValue minor={extras.landMinor} currency={currency} readOnly={readOnly} quiet={suggestion != null} />}
            onOpen={open("land")}
            buttonRef={rows.land}
          />
          {suggestion != null && onUseLand != null ? (
            <LandSuggestion suggestion={suggestion} currency={currency} busy={landBusy} onUse={onUseLand} />
          ) : null}
          <FigureRow
            title={INVESTMENT_LABELS.units}
            note={extras.unitsDefault ? (readOnly ? "ברירת מחדל" : UNITS_DEFAULT_HINT) : undefined}
            value={<bdi dir="ltr" className="ui-pinv-value ui-num">{String(extras.units)}</bdi>}
            onOpen={open("units")}
            buttonRef={rows.units}
          />
        </>
      )}
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

/** "הלוואות" (the הלוואות tab): the project's loans, the total at the head's end, then "+ הוספת הלוואה". */
export function LoansGroup({
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
  const titleId = useId();
  return (
    <section className="ui-month ui-pinv-group" aria-labelledby={titleId}>
      <GroupHead id={titleId} title="הלוואות" summary={<Amount agorot={figures.loanMinor} currency={figures.currency} />} />
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

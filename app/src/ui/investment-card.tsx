import type { ReactNode, RefObject } from "react";
import { BigNumber } from "./big-number";
import { cx } from "./cx";
import { formatDayMonth } from "./date-math";
import { AlertIcon } from "./icons";
import { SectionHead } from "./layout";
import { List, ListRow } from "./list-row";
import { Skeleton } from "./skeleton";
import { TextLink } from "./text-link";

/** The three figures the owner types in. Each row opens its own sheet (FLOW-404). */
export type InvestmentField = "purchase" | "arv" | "value";

/** Every row of the card that can open something. */
export type InvestmentRow = InvestmentField | "rehab" | "loans";

/** An amount in a currency other than the project's. Listed apart, never added in (0143). */
export type MinorInCurrency = { currency: string; minor: bigint };

/** What `get_project().investment` returns, in the project's currency (decision 0143). */
export type InvestmentFigures = {
  currency: string;
  purchaseMinor: bigint | null;
  arvMinor: bigint | null;
  valueMinor: bigint | null;
  /** YYYY-MM-DD. */
  valueDate: string | null;
  rehabMinor: bigint;
  rehabOther: MinorInCurrency[];
  loanMinor: bigint;
  loanOther: MinorInCurrency[];
  /** Null while a figure it needs is missing, or rehab has a cost in another currency. */
  forcedEquityMinor: bigint | null;
  /** Null while today's value is missing, or an open loan is in another currency. */
  currentEquityMinor: bigint | null;
};

export const INVESTMENT_TITLE = "השקעה";
/** The card ignores the screen's period and basis (0143). */
export const INVESTMENT_SCOPE = "מתחילת הפרויקט";
export const INVESTMENT_LABELS: Record<InvestmentField, string> = {
  purchase: "מחיר רכישה",
  arv: "שווי אחרי שיפוץ",
  value: "שווי היום",
};
export const REHAB_LABEL = "שיפוץ עד היום";
export const LOANS_LABEL = "יתרת הלוואות";
export const FORCED_LABEL = "השבחה צפויה";
export const CURRENT_LABEL = "הון עצמי בנכס";
export const FORCED_FORMULA = "שווי אחרי שיפוץ פחות רכישה ושיפוץ";
export const CURRENT_FORMULA = "שווי היום פחות הלוואות";
export const INVESTMENT_ERROR = "לא הצלחנו לטעון.";

const CURRENCY_WORDS: Record<string, string> = {
  ILS: "בשקלים",
  USD: "בדולר",
  EUR: "באירו",
};

/** "בדולר", "בשקלים"; any other code is written as it is. */
export function currencyWord(currency: string): string {
  return CURRENCY_WORDS[currency] ?? `ב־${currency}`;
}

function wordsOf(list: readonly MinorInCurrency[]): string {
  const words = list.map((item) => currencyWord(item.currency));
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ו${words[words.length - 1] ?? ""}`;
}

export type EquityNote = { text: string; kind: "missing" | "currency" };

/**
 * Why an equity has no figure. A missing figure is named; another currency is said; never 0
 * (FLOW-404). Null when the server sent a figure.
 */
export function forcedEquityNote(figures: InvestmentFigures): EquityNote | null {
  if (figures.forcedEquityMinor != null) return null;
  const missing = [
    figures.arvMinor == null ? INVESTMENT_LABELS.arv : null,
    figures.purchaseMinor == null ? INVESTMENT_LABELS.purchase : null,
  ].filter((label): label is string => label != null);
  if (missing.length === 2) return { kind: "missing", text: `חסרים ${missing[0] ?? ""} ו${missing[1] ?? ""}` };
  if (missing.length === 1) return { kind: "missing", text: `חסר ${missing[0] ?? ""}` };
  if (figures.rehabOther.length > 0) return { kind: "currency", text: `לא מחושב, יש שיפוץ ${wordsOf(figures.rehabOther)}` };
  return { kind: "currency", text: "לא מחושב" };
}

export function currentEquityNote(figures: InvestmentFigures): EquityNote | null {
  if (figures.currentEquityMinor != null) return null;
  if (figures.valueMinor == null) return { kind: "missing", text: `חסר ${INVESTMENT_LABELS.value}` };
  if (figures.loanOther.length > 0) return { kind: "currency", text: `לא מחושב, יש הלוואה ${wordsOf(figures.loanOther)}` };
  return { kind: "currency", text: "לא מחושב" };
}

/** "ועוד $120,000 בדולר", one line per other currency. */
function OtherCurrencies({ list }: { list: readonly MinorInCurrency[] }) {
  if (list.length === 0) return null;
  return (
    <>
      {list.map((item, index) => (
        <span key={item.currency}>
          {index > 0 ? " · " : null}
          {"ועוד "}
          <BigNumber agorot={item.minor} currency={item.currency} />
          {` ${currencyWord(item.currency)}`}
        </span>
      ))}
    </>
  );
}

function Amount({ minor, currency, loss = false }: { minor: bigint; currency: string; loss?: boolean }) {
  return (
    <span className="ui-invest-value t-amount">
      <BigNumber agorot={minor} currency={currency} loss={loss} />
    </span>
  );
}

function FigureRow({
  title,
  hint,
  value,
  readOnly,
  onOpen,
  buttonRef,
}: {
  title: string;
  hint?: ReactNode;
  value: ReactNode;
  readOnly: boolean;
  onOpen?: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  if (readOnly || onOpen == null) {
    return <ListRow variant="static" title={title} hint={hint} action={value} className="ui-invest-row" />;
  }
  return (
    <ListRow
      variant="button"
      title={title}
      hint={hint}
      action={value}
      chevron
      className="ui-invest-row"
      buttonRef={buttonRef}
      onClick={onOpen}
    />
  );
}

function FigureValue({ minor, currency, readOnly }: { minor: bigint | null; currency: string; readOnly: boolean }) {
  if (minor != null) return <Amount minor={minor} currency={currency} />;
  // A viewer sees no הוספה: nothing on the card opens (FLOW-404).
  if (readOnly) return <span className="ui-invest-empty t-label">לא הוזן</span>;
  return <span className="ui-invest-add t-label">הוספה</span>;
}

function Equity({
  label,
  formula,
  minor,
  note,
  currency,
  readOnly,
}: {
  label: string;
  formula: string;
  minor: bigint | null;
  note: EquityNote | null;
  currency: string;
  readOnly: boolean;
}) {
  return (
    <div className="ui-invest-equity">
      <span className="ui-invest-equity-label t-hint">{label}</span>
      {minor != null ? (
        <span className="ui-invest-equity-figure">
          <BigNumber agorot={minor} currency={currency} loss={minor < 0n} />
        </span>
      ) : (
        <span
          className={cx(
            "ui-invest-equity-note",
            note?.kind === "missing" && !readOnly ? "ui-invest-equity-missing" : false,
          )}
        >
          {note?.text ?? "לא מחושב"}
        </span>
      )}
      <span className="ui-invest-equity-formula t-hint">{formula}</span>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="ui-invest-card" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <List className="ui-invest-rows">
        <ListRow variant="skeleton" />
        <ListRow variant="skeleton" />
        <ListRow variant="skeleton" />
      </List>
      <div className="ui-invest-equities" aria-hidden="true">
        <div className="ui-invest-equity">
          <Skeleton width="sm" />
          <Skeleton width="md" />
        </div>
        <div className="ui-invest-equity">
          <Skeleton width="sm" />
          <Skeleton width="md" />
        </div>
      </div>
    </div>
  );
}

/**
 * FLOW-404. The project's investment card: purchase, ARV and today's value, the two equities
 * with their formula, then rehab and the loan balance. Props only; the screen reads and saves.
 * The head says מתחילת הפרויקט: the screen's period and basis never change it (0143).
 */
export function InvestmentCard({
  state = "ready",
  figures,
  readOnly = false,
  onEdit,
  onRehab,
  onLoans,
  onRetry,
  retrying = false,
  rowRefs,
}: {
  state?: "ready" | "loading" | "error";
  figures?: InvestmentFigures | null;
  /** A viewer: no chevrons, no הוספה, nothing opens. */
  readOnly?: boolean;
  onEdit?: (field: InvestmentField) => void;
  onRehab?: () => void;
  onLoans?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  /** Each sheet hands focus back to the row that opened it. */
  rowRefs?: Partial<Record<InvestmentRow, RefObject<HTMLButtonElement | null>>>;
}) {
  const head = (
    <SectionHead title={INVESTMENT_TITLE}>
      <span className="ui-invest-scope t-hint">{INVESTMENT_SCOPE}</span>
    </SectionHead>
  );
  if (state === "loading") {
    return (
      <section className="ui-invest" aria-label={INVESTMENT_TITLE}>
        {head}
        <CardSkeleton />
      </section>
    );
  }
  if (state === "error" || figures == null) {
    return (
      <section className="ui-invest" aria-label={INVESTMENT_TITLE}>
        {head}
        <div className="ui-invest-card">
          <List className="ui-invest-rows">
            <ListRow
              variant="static"
              title={INVESTMENT_TITLE}
              icon={<AlertIcon size={24} />}
              tone="muted"
              describeHint
              hintStatus
              hint={INVESTMENT_ERROR}
              action={onRetry ? (
                <TextLink
                  size="label"
                  chevron={false}
                  label={`ניסיון חוזר: ${INVESTMENT_TITLE}`}
                  busy={retrying}
                  onClick={onRetry}
                >
                  ניסיון חוזר
                </TextLink>
              ) : undefined}
            />
          </List>
        </div>
      </section>
    );
  }
  const { currency } = figures;
  const open = (field: InvestmentField) => (onEdit ? () => { onEdit(field); } : undefined);
  return (
    <section className="ui-invest" aria-label={INVESTMENT_TITLE}>
      {head}
      <div className="ui-invest-card">
        <List className="ui-invest-rows">
          <FigureRow
            title={INVESTMENT_LABELS.purchase}
            value={<FigureValue minor={figures.purchaseMinor} currency={currency} readOnly={readOnly} />}
            readOnly={readOnly}
            onOpen={open("purchase")}
            buttonRef={rowRefs?.purchase}
          />
          <FigureRow
            title={INVESTMENT_LABELS.arv}
            value={<FigureValue minor={figures.arvMinor} currency={currency} readOnly={readOnly} />}
            readOnly={readOnly}
            onOpen={open("arv")}
            buttonRef={rowRefs?.arv}
          />
          <FigureRow
            title={INVESTMENT_LABELS.value}
            hint={figures.valueMinor != null && figures.valueDate != null ? (
              // FLOW-353: the word and its date stay on one line at 320; this year's date drops its year.
              <span className="ui-nowrap">
                {"עודכן\u00A0"}
                <bdi dir="ltr" className="ui-num">{formatDayMonth(figures.valueDate)}</bdi>
              </span>
            ) : undefined}
            value={<FigureValue minor={figures.valueMinor} currency={currency} readOnly={readOnly} />}
            readOnly={readOnly}
            onOpen={open("value")}
            buttonRef={rowRefs?.value}
          />
        </List>
        <div className="ui-invest-equities">
          <Equity
            label={FORCED_LABEL}
            formula={FORCED_FORMULA}
            minor={figures.forcedEquityMinor}
            note={forcedEquityNote(figures)}
            currency={currency}
            readOnly={readOnly}
          />
          <Equity
            label={CURRENT_LABEL}
            formula={CURRENT_FORMULA}
            minor={figures.currentEquityMinor}
            note={currentEquityNote(figures)}
            currency={currency}
            readOnly={readOnly}
          />
        </div>
        <List className="ui-invest-rows ui-invest-sub">
          <FigureRow
            title={REHAB_LABEL}
            hint={figures.rehabOther.length > 0 ? <OtherCurrencies list={figures.rehabOther} /> : undefined}
            value={<Amount minor={figures.rehabMinor} currency={currency} />}
            readOnly={readOnly}
            onOpen={onRehab}
            buttonRef={rowRefs?.rehab}
          />
          <FigureRow
            title={LOANS_LABEL}
            hint={figures.loanOther.length > 0 ? <OtherCurrencies list={figures.loanOther} /> : undefined}
            value={<Amount minor={figures.loanMinor} currency={currency} />}
            readOnly={readOnly}
            onOpen={onLoans}
            buttonRef={rowRefs?.loans}
          />
        </List>
      </div>
    </section>
  );
}

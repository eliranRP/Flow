import { formatAmount } from "./amount";
import { Card } from "./card";
import { TextLink } from "./text-link";

/** The three figures the owner types in. Each row opens its own sheet (FLOW-404). */
export type InvestmentField = "purchase" | "arv" | "value";

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

export const INVESTMENT_LABELS: Record<InvestmentField, string> = {
  purchase: "מחיר רכישה",
  arv: "שווי אחרי שיפוץ (ARV)",
  value: "שווי היום",
};

/** The figure's name inside a sentence ("חסר שווי אחרי שיפוץ"). */
const FIGURE_NAMES: Record<InvestmentField, string> = {
  purchase: "מחיר רכישה",
  arv: "שווי אחרי שיפוץ",
  value: "שווי היום",
};

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
    figures.arvMinor == null ? FIGURE_NAMES.arv : null,
    figures.purchaseMinor == null ? FIGURE_NAMES.purchase : null,
  ].filter((label): label is string => label != null);
  if (missing.length === 2) return { kind: "missing", text: `חסרים ${missing[0] ?? ""} ו${missing[1] ?? ""}` };
  if (missing.length === 1) return { kind: "missing", text: `חסר ${missing[0] ?? ""}` };
  if (figures.rehabOther.length > 0) return { kind: "currency", text: `לא מחושב, יש שיפוץ ${wordsOf(figures.rehabOther)}` };
  return { kind: "currency", text: "לא מחושב" };
}

export function currentEquityNote(figures: InvestmentFigures): EquityNote | null {
  if (figures.currentEquityMinor != null) return null;
  if (figures.valueMinor == null) return { kind: "missing", text: `חסר ${FIGURE_NAMES.value}` };
  if (figures.loanOther.length > 0) return { kind: "currency", text: `לא מחושב, יש הלוואה ${wordsOf(figures.loanOther)}` };
  return { kind: "currency", text: "לא מחושב" };
}

/** FLOW-445: a count of minor units rounded to whole thousands and written with a K, for the summary's grid ("₪185K"). */
export function roundedThousands(minor: bigint, currency: string): string {
  const step = 100_000n;
  const rounded = ((minor < 0n ? -minor : minor) + step / 2n) / step * step;
  return formatAmount(minor < 0n ? -rounded : rounded, "summary", currency).replace(/,000$/u, "K");
}

/**
 * FLOW-445: the project page's השקעה והלוואות card (properties only). Purchase, rehab so far, the
 * ARV or today's value, and the open loans; the equity figure and a two-part bar: equity on the
 * left, the loan on the right. "לפרטים" opens the investment page.
 */
export function InvestmentSummary({ figures, href }: { figures: InvestmentFigures; href: string }) {
  const hasArv = figures.arvMinor != null;
  const valueLabel = hasArv ? "ARV · שווי אחרי שיפוץ" : "שווי היום";
  const valueMinor = hasArv ? figures.arvMinor : figures.valueMinor;
  const equityLabel = hasArv ? "הון צפוי אחרי שיפוץ" : "הון עצמי היום";
  const equityMinor = hasArv ? figures.forcedEquityMinor : figures.currentEquityMinor;
  const loan = figures.loanMinor;
  const equityPart = equityMinor != null && equityMinor > 0n ? equityMinor : 0n;
  const total = equityPart + loan;
  const equityShare = total === 0n ? 0 : Number((equityPart * 10_000n) / total) / 100;
  const cur = figures.currency;
  return (
    <Card className="ui-investment-summary">
      <div className="ui-investment-head">
        <h2>השקעה והלוואות</h2>
        <TextLink to={href} chevron={false}>לפרטים</TextLink>
      </div>
      <dl className="ui-investment-grid">
        <div>
          <dt>מחיר קנייה</dt>
          <dd>{figures.purchaseMinor == null ? "—" : <bdi dir="ltr">{roundedThousands(figures.purchaseMinor, cur)}</bdi>}</dd>
        </div>
        <div>
          <dt>שיפוץ עד היום</dt>
          <dd><bdi dir="ltr">{roundedThousands(figures.rehabMinor, cur)}</bdi></dd>
        </div>
        <div>
          <dt>{valueLabel}</dt>
          <dd>{valueMinor == null ? "—" : <bdi dir="ltr">{roundedThousands(valueMinor, cur)}</bdi>}</dd>
        </div>
        <div>
          <dt>יתרת הלוואה</dt>
          <dd><bdi dir="ltr">{roundedThousands(loan, cur)}</bdi></dd>
        </div>
      </dl>
      <div className="ui-investment-equity">
        <p className="ui-investment-equity-label">{equityLabel}</p>
        <p className="ui-investment-equity-figure">
          {equityMinor == null ? "—" : <bdi dir="ltr">{formatAmount(equityMinor, "summary", cur)}</bdi>}
        </p>
      </div>
      {total === 0n ? null : (
        <div className="ui-investment-bar" aria-hidden="true">
          <span className="ui-investment-loan" style={{ flexGrow: 100 - equityShare }} />
          <span className="ui-investment-own" style={{ flexGrow: equityShare }} />
        </div>
      )}
      <p className="ui-investment-legend">
        <span><span className="ui-investment-dot ui-investment-dot-own" aria-hidden="true" /> הון עצמי</span>
        <span><span className="ui-investment-dot ui-investment-dot-loan" aria-hidden="true" /> הלוואה</span>
      </p>
    </Card>
  );
}

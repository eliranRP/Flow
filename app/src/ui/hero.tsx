import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { expenseFigure, flowLinkName } from "../breakdown";
import { BigNumber } from "./big-number";
import { ChevronIcon } from "./icons";
import { BandHero } from "./layout";

type HeroFigure = {
  agorot: bigint;
  currency: string;
  loss?: boolean;
};

type HeroProps = {
  label: string;
  /** Omitted on the empty first run, which has a label and no figure. */
  agorot?: bigint;
  currency?: string;
  figures?: HeroFigure[];
  explanation?: string;
  /** FLOW-355: Home's period pill, between the label and the figure. */
  pill?: ReactNode;
  /** FLOW-435: a small line above the label, naming whose figure it is (a project's history). */
  kicker?: string;
};

/**
 * Home summary. One label, the figure, and one explanation.
 * A loss is named in the label. The figure stays white: red on the violet band does not read.
 */
export function Hero({ label, agorot, currency = "ILS", figures, explanation, pill, kicker }: HeroProps) {
  const rows = figures ?? (agorot == null ? [] : [{ agorot, currency, loss: agorot < 0n }]);
  const multi = rows.length > 1;
  return (
    <BandHero>
      <div className="ui-hero">
        {kicker ? <p className="t-label">{kicker}</p> : null}
        {rows.length === 0 ? (
          <h1 className="ui-band-label t-label">{label}</h1>
        ) : (
          <>
            <p className="ui-band-label t-label">{label}</p>
            {pill ? <div className="ui-hero-pill">{pill}</div> : null}
            <h1 className="ui-hero-figure">
              {rows.map((row) => (
                <span key={row.currency} className={multi ? "ui-hero-figure-line" : undefined}>
                  <BigNumber
                    agorot={row.agorot}
                    currency={row.currency}
                    size={multi ? "display" : "hero"}
                    loss={row.loss === true}
                  />
                </span>
              ))}
            </h1>
            {explanation ? <p className="ui-hero-explain t-label">{explanation}</p> : null}
          </>
        )}
      </div>
    </BandHero>
  );
}

type FlowCurrencyLine = {
  currency: string;
  income: bigint;
  expense: bigint;
};

type FlowLinks = {
  income: string;
  expense: string;
  /** The period words in the accessible name, e.g. החודש. */
  period: string;
};

/** Income and expenses under the hero, below the band. Income is green (decision 0120), expenses neutral, with room between the rows. With links, each row opens its breakdown (FLOW-301). */
export function FlowLines({
  income,
  expense,
  lines,
  links,
}: {
  income?: bigint;
  expense?: bigint;
  lines?: FlowCurrencyLine[];
  links?: FlowLinks;
}) {
  const rows = lines ?? [{ currency: "ILS", income: income ?? 0n, expense: expense ?? 0n }];
  const incomeRows = rows.map((row) => ({ currency: row.currency, agorot: row.income }));
  const expenseRows = rows.map((row) => ({ currency: row.currency, agorot: row.expense }));
  return (
    <div className="ui-flow">
      <FlowLine
        label="הכנסות"
        rows={incomeRows}
        income
        href={links?.income}
        name={links ? flowLinkName("income", links.period, incomeRows) : undefined}
      />
      <FlowLine
        label="הוצאות"
        rows={expenseRows}
        expense
        href={links?.expense}
        name={links ? flowLinkName("expense", links.period, expenseRows) : undefined}
      />
    </div>
  );
}

function FlowLine({
  label,
  rows,
  expense = false,
  income = false,
  href,
  name,
}: {
  label: string;
  rows: { currency: string; agorot: bigint }[];
  expense?: boolean;
  /** Money in: green unless the figure shows a minus. The flow lines sit below the band, never on it. */
  income?: boolean;
  href?: string;
  name?: string;
}) {
  const body = (
    <>
      <span className="ui-flow-label t-body">{label}</span>
      <span className="ui-flow-amounts">
        {rows.map((row) => {
          // A month where refunds beat costs reads as a positive amount, like its breakdown.
          const figure = expense ? expenseFigure(row.agorot) : { agorot: row.agorot, direction: undefined };
          return (
            <BigNumber
              key={row.currency}
              agorot={figure.agorot}
              currency={row.currency}
              size="list"
              direction={figure.direction}
              income={income}
            />
          );
        })}
      </span>
    </>
  );
  if (href) {
    return (
      <Link to={href} className="ui-flow-line ui-flow-link ui-hit" aria-label={name}>
        {body}
        <span className="ui-flow-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </Link>
    );
  }
  return <p className="ui-flow-line">{body}</p>;
}

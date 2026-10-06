import { BigNumber } from "./big-number";
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
};

/**
 * Home summary. One label, the figure, and one explanation.
 * A loss is named in the label. The figure stays white: red on the violet band does not read.
 */
export function Hero({ label, agorot, currency = "ILS", figures, explanation }: HeroProps) {
  const rows = figures ?? (agorot == null ? [] : [{ agorot, currency, loss: agorot < 0n }]);
  const multi = rows.length > 1;
  return (
    <BandHero>
      <div className="ui-hero">
        {rows.length === 0 ? (
          <h1 className="ui-band-label t-label">{label}</h1>
        ) : (
          <>
            <p className="ui-band-label t-label">{label}</p>
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

/** Income and expenses under the hero. Neutral amounts, with room between the rows. */
export function FlowLines({ income, expense, lines }: { income?: bigint; expense?: bigint; lines?: FlowCurrencyLine[] }) {
  const rows = lines ?? [{ currency: "ILS", income: income ?? 0n, expense: expense ?? 0n }];
  return (
    <div className="ui-flow">
      <FlowLine label="נכנס" rows={rows.map((row) => ({ currency: row.currency, agorot: row.income }))} />
      <FlowLine label="יצא" rows={rows.map((row) => ({ currency: row.currency, agorot: row.expense }))} expense />
    </div>
  );
}

function FlowLine({
  label,
  rows,
  expense = false,
}: {
  label: string;
  rows: { currency: string; agorot: bigint }[];
  expense?: boolean;
}) {
  return (
    <p className="ui-flow-line">
      <span className="ui-flow-label t-body">{label}</span>
      <span className="ui-flow-amounts">
        {rows.map((row) => (
          <BigNumber
            key={row.currency}
            agorot={row.agorot}
            currency={row.currency}
            size="list"
            direction={expense ? "expense" : undefined}
          />
        ))}
      </span>
    </p>
  );
}

import { Amount } from "./amount";
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
  /** FLOW-435: a small line above the label, naming whose figure it is (a project's history). */
  kicker?: string;
};

/**
 * Home summary. One label, the figure, and one explanation.
 * A loss is named in the label. The figure stays white: red on the violet band does not read.
 */
export function Hero({ label, agorot, currency = "ILS", figures, explanation, kicker }: HeroProps) {
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
            <h1 className="ui-hero-figure ui-band-fade">
              {rows.map((row) => (
                <span key={row.currency} className={multi ? "ui-hero-figure-line" : undefined}>
                  <Amount
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

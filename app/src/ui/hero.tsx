import { BigNumber } from "./big-number";
import { BandHero } from "./layout";

type HeroProps = {
  label: string;
  /** Omitted on the empty first run, which has a label and no figure. */
  agorot?: bigint;
  explanation?: string;
};

/**
 * Home summary. One label, the figure, and one explanation.
 * A loss is named in the label. The figure stays white: red on the violet band does not read.
 */
export function Hero({ label, agorot, explanation }: HeroProps) {
  return (
    <BandHero>
      <div className="ui-hero">
        {agorot == null ? (
          <h1 className="ui-band-label t-label">{label}</h1>
        ) : (
          <>
            <p className="ui-band-label t-label">{label}</p>
            <h1 className="ui-hero-figure">
              <BigNumber agorot={agorot} size="hero" />
            </h1>
            {explanation ? <p className="ui-hero-explain t-label">{explanation}</p> : null}
          </>
        )}
      </div>
    </BandHero>
  );
}

/** Income and expenses under the hero. Neutral amounts, with room between the rows. */
export function FlowLines({ income, expense }: { income: bigint; expense: bigint }) {
  return (
    <div className="ui-flow">
      <FlowLine label="נכנס" agorot={income} />
      <FlowLine label="יצא" agorot={expense} />
    </div>
  );
}

function FlowLine({ label, agorot }: { label: string; agorot: bigint }) {
  return (
    <p className="ui-flow-line">
      <span className="ui-flow-label t-body">{label}</span>
      <BigNumber agorot={agorot} size="list" />
    </p>
  );
}

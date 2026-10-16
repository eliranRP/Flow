import { formatAmountText } from "@flow/shared";
import { cx } from "./cx";

type ChangePillProps = {
  /** Exact percent, not a pre-rounded integer. */
  percent?: number;
  comparison: string;
  onBand?: boolean;
  /** An expense going up hurts, so the tones swap (a rise is the bad tone). */
  upHurts?: boolean;
  /** FLOW-364: the absolute change in an amount, on the band, with the tone the caller decided. */
  amount?: { minor: bigint; currency: string };
  tone?: "helps" | "hurts";
};

type ChangeTone = "flat" | "up" | "down";

/** Exactly 0 is a neutral 0%. A non-zero value that rounds to 0 keeps its direction as <1%. */
export function formatChange(percent: number): { text: string; tone: ChangeTone } {
  if (percent === 0) return { text: "0%", tone: "flat" };
  const up = percent > 0;
  const rounded = Math.round(Math.abs(percent));
  return { text: rounded === 0 ? "<1%" : `${String(rounded)}%`, tone: up ? "up" : "down" };
}

/**
 * Month-over-month change (FLOW-363 (2b)). On the band a change that helps is a grey pill and one
 * that hurts is a red pill; off the band it is plain text. The caller hides it when there is no
 * comparison period.
 */
export function ChangePill(props: ChangePillProps) {
  if (props.amount != null) return <AmountChangePill {...props} amount={props.amount} />;
  return <PercentChangePill {...props} percent={props.percent ?? 0} />;
}

/**
 * FLOW-364: Home's change pill, an amount on the band. The text is the absolute change ("▲ $X" or
 * "▼ $X"); the tone sets its colour: helps is grey, hurts is red (REDESIGN-PLAN §2.2 #16).
 */
function AmountChangePill({
  amount,
  tone,
  comparison,
}: Required<Pick<ChangePillProps, "amount">> & Pick<ChangePillProps, "tone" | "comparison">) {
  const up = amount.minor > 0n;
  const abs = amount.minor < 0n ? -amount.minor : amount.minor;
  const text = formatAmountText(abs, amount.currency);
  const words = `${up ? "עלייה" : "ירידה"} של ${text} ${comparison}`;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cx("ui-change ui-change-amount", tone === "helps" ? "ui-delta-good" : "ui-delta-bad")} aria-label={words}>
        <span aria-hidden="true">
          {up ? "▲ " : "▼ "}
          <bdi dir="ltr">{text}</bdi>
        </span>
      </span>
      <span className="t-label text-on-band-secondary">{comparison}</span>
    </span>
  );
}

function PercentChangePill({ percent, comparison, onBand = false, upHurts = false }: Required<Pick<ChangePillProps, "percent">> & Omit<ChangePillProps, "percent" | "amount" | "tone">) {
  const change = formatChange(percent);
  const words = change.tone === "flat" ? `0% ${comparison}` : `${change.tone === "up" ? "עלייה" : "ירידה"} של ${change.text} ${comparison}`;
  const arrow = change.tone === "up" ? "▲" : change.tone === "down" ? "▼" : "";
  const helps = change.tone === "flat" ? null : (change.tone === "up") !== upHurts;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cx(
          "ui-change",
          onBand && "ui-change-band",
          change.tone === "flat" && "ui-delta-flat",
          helps === true && "ui-delta-good",
          helps === false && "ui-delta-bad",
        )}
        aria-label={words}
      >
        <span aria-hidden="true">
          {arrow === "" ? null : `${arrow} `}
          <bdi dir="ltr">{change.text}</bdi>
        </span>
      </span>
      <span className={onBand ? "t-label text-on-band-secondary" : "t-label text-text-secondary"}>{comparison}</span>
    </span>
  );
}

import { cx } from "./cx";

type ChangePillProps = {
  /** Exact percent, not a pre-rounded integer. */
  percent: number;
  comparison: string;
  onBand?: boolean;
};

type ChangeTone = "flat" | "up" | "down";

/** Exactly 0 is a neutral 0%. A non-zero value that rounds to 0 keeps its direction as <1%. */
export function formatChange(percent: number): { text: string; tone: ChangeTone } {
  if (percent === 0) return { text: "0%", tone: "flat" };
  const up = percent > 0;
  const rounded = Math.round(Math.abs(percent));
  return { text: rounded === 0 ? "<1%" : `${String(rounded)}%`, tone: up ? "up" : "down" };
}

/** Month-over-month change. The caller hides it when there is no comparison period. */
export function ChangePill({ percent, comparison, onBand = false }: ChangePillProps) {
  const change = formatChange(percent);
  const words = change.tone === "flat" ? `0% ${comparison}` : `${change.tone === "up" ? "עלייה" : "ירידה"} של ${change.text} ${comparison}`;
  const mark = change.tone === "flat" ? change.text : `${change.tone === "up" ? "▲" : "▼"} ${change.text}`;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cx(
          "ui-change",
          onBand && "ui-change-band",
          change.tone === "up" && "ui-delta-good",
          change.tone === "down" && "ui-delta-bad",
          change.tone === "flat" && "ui-delta-flat",
        )}
        aria-label={words}
      >
        <span aria-hidden="true">{mark}</span>
      </span>
      <span className={onBand ? "t-label text-on-band-secondary" : "t-label text-text-secondary"}>{comparison}</span>
    </span>
  );
}

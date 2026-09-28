import { cx } from "./cx";

type ChangePillProps = {
  percent: number;
  comparison: string;
  onBand?: boolean;
};

/** Month-over-month change. Hidden when the change rounds to zero. */
export function ChangePill({ percent, comparison, onBand = false }: ChangePillProps) {
  if (percent === 0) return null;
  const up = percent > 0;
  const abs = Math.abs(percent);
  const words = `${up ? "עלייה" : "ירידה"} של ${String(abs)}% ${comparison}`;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cx("ui-change", onBand && "ui-change-band", up ? "ui-delta-good" : "ui-delta-bad")}
        aria-label={words}
      >
        <span aria-hidden="true">
          {up ? "▲" : "▼"} {String(abs)}%
        </span>
      </span>
      <span className={onBand ? "t-label text-on-band-secondary" : "t-label text-text-secondary"}>{comparison}</span>
    </span>
  );
}

import type { ReactNode } from "react";

/** The colours a part can take. Each one is a token, so light and dark follow the theme. */
export type PartTone = "accent" | "accent-dim" | "band-past" | "signal-soft" | "muted" | "bad";

export type BarPart = { key: string; value: bigint | number; tone: PartTone };

export type BarLegendItem = { key: string; label: string; value: ReactNode };

export type PartsBarProps = {
  parts: BarPart[];
  /** The whole the parts are of. Draws a track for what is left; without it the parts fill the bar. */
  total?: bigint | number;
  /** The bar's height: 6 is the thin bar, 8 the job bar (tokens --bar-thin and --bar-job). */
  height?: 6 | 8;
  /** 2 leaves a 2px gap between parts (--band-label-gap); 0 butts them together. */
  gap?: 0 | 2;
  /** pill: fully rounded ends (the default). block: the 6px block corner (--radius-block). */
  radius?: "pill" | "block";
  /** One line per part, with a dot in its tone. Optional. */
  legend?: BarLegendItem[];
  /** The name for screen readers, for example the figure the bar is of. */
  label: string;
};

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * A bar of one or more parts (FLOW-139, 140, 367, 446, 447, 370). Each part's width is its value
 * over the total, so the widths add up. One part with a total is a single-fill bar. The parts grow
 * from the start on a change, over --motion-width (CSS only; reduced motion turns it off).
 */
export function PartsBar({ parts, total, height = 6, gap = 0, radius = "pill", legend, label }: PartsBarProps) {
  const shown = parts.filter((part) => toNumber(part.value) > 0);
  const sum = shown.reduce((acc, part) => acc + toNumber(part.value), 0);
  const whole = total === undefined ? sum : toNumber(total);
  const rest = whole - sum;
  return (
    <div className="ui-parts">
      <div className="ui-parts-bar" role="img" aria-label={label} data-height={height} data-gap={gap} data-radius={radius}>
        {shown.map((part) => (
          <span
            key={part.key}
            className="ui-parts-part"
            data-tone={part.tone}
            data-over={whole > 0 && sum > whole ? "true" : undefined}
            style={{ flexGrow: toNumber(part.value) }}
          />
        ))}
        {total !== undefined && rest > 0 ? <span className="ui-parts-rest" style={{ flexGrow: rest }} /> : null}
      </div>
      {legend && legend.length > 0 ? (
        <ul className="ui-parts-legend">
          {legend.map((item) => {
            const part = parts.find((p) => p.key === item.key);
            return (
              <li key={item.key} className="ui-parts-legend-item">
                <span className="ui-parts-dot" data-tone={part?.tone} aria-hidden="true" />
                <span className="ui-parts-legend-label">{item.label}</span>
                <span className="ui-parts-legend-value">{item.value}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

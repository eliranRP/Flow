import { useId, useState } from "react";
import {
  PRESET_KINDS,
  canStep,
  customRange,
  isCurrentPeriod,
  periodHint,
  presetLabel,
  presetPeriod,
  presetShortLabel,
  samePeriod,
  stepPeriod,
  windowLabel,
  windowToDate,
  type PeriodChoice,
  type PeriodKind,
  type PeriodScope,
} from "../period";
import { cx } from "./cx";
import { IconButton } from "./icon-button";
import { ChevronDownIcon } from "./icons";
import { PeriodSheet, RangeSheet } from "./period-picker";
import { SegmentedControl } from "./segmented-control";

type PeriodBarProps = {
  period: PeriodChoice;
  onChange: (period: PeriodChoice) => void;
  /** Band on Home and the project band. Page on a white screen. */
  tone?: "band" | "page";
  /** On a project, הכול reads מתחילת הפרויקט. */
  scope?: PeriodScope;
  /**
   * "עד היום" under the label of the current window. The project band leaves it out: its band
   * already says the period, and the line cost the band a row (FLOW-335).
   */
  toDateHint?: boolean;
};

/**
 * One period control for Home and the project band (profit by period, option A, decision 0141):
 * five presets on a segmented control, and under them a stepper. › on the start side goes to the
 * earlier window and ‹ to the later one, by the preset's own length; the later arrow is off at
 * the current window. Both chevrons are SVG and point outward, never a glyph RTL would mirror.
 * The label opens the period sheet with טווח מותאם. הכול and a custom range have no arrows.
 */
export function PeriodBar({ period, onChange, tone = "band", scope = "company", toDateHint = true }: PeriodBarProps) {
  const [sheet, setSheet] = useState(false);
  const [range, setRange] = useState(false);
  const currentId = useId();
  const onBand = tone === "band";
  const earlier = stepPeriod(period, -1);
  const later = stepPeriod(period, 1);
  const arrows = canStep(period);
  const label = windowLabel(period, undefined, scope);
  const toDate = toDateHint && windowToDate(period);
  // FLOW-335: a stepped-back window says how to come back. The selected preset already jumps back.
  const back = arrows && !isCurrentPeriod(period);
  const hint = back ? "חזרה להיום" : toDate ? "עד היום" : null;
  return (
    <div className={cx("ui-pbar", onBand ? "ui-pbar-band" : "ui-pbar-page")}>
      <SegmentedControl<PeriodKind>
        label="תקופה"
        showLabel={false}
        tone={onBand ? "band" : "page"}
        value={period.kind}
        options={PRESET_KINDS.map((kind) => ({
          value: kind,
          label: presetLabel(kind),
          short: presetShortLabel(kind),
          name: back && kind === period.kind ? `${presetLabel(kind)}, חזרה להיום` : undefined,
        }))}
        onChange={(kind) => {
          if (kind === "custom") return;
          onChange(presetPeriod(kind));
        }}
      />
      <div className="ui-pbar-step">
        {arrows ? (
          <IconButton
            label={stepName(period, earlier, -1)}
            onBand={onBand}
            className="ui-pbar-arrow"
            onClick={() => {
              if (earlier) onChange(earlier);
            }}
          >
            <OutwardChevron side="start" />
          </IconButton>
        ) : (
          <span className="ui-pbar-arrow-slot" aria-hidden="true" />
        )}
        <button
          type="button"
          className="ui-pbar-label ui-hit"
          aria-label={`${label}${hint ? `, ${hint}` : ""} – בחירת תקופה`}
          aria-haspopup="dialog"
          onClick={() => {
            setSheet(true);
          }}
        >
          <span className="ui-pbar-window">
            {label}
            {/* FLOW-335: the label opens the period sheet, so it carries the band pill's ▼, after the last word. */}
            <span className="ui-pbar-caret" aria-hidden="true">
              <ChevronDownIcon />
            </span>
          </span>
          {hint ? <span className="ui-pbar-hint">{hint}</span> : null}
        </button>
        {arrows ? (
          <>
            <IconButton
              label={stepName(period, later, 1)}
              onBand={onBand}
              className="ui-pbar-arrow"
              aria-disabled={later == null || undefined}
              aria-describedby={later == null ? currentId : undefined}
              onClick={() => {
                if (later) onChange(later);
              }}
            >
              <OutwardChevron side="end" />
            </IconButton>
            {later == null ? <span id={currentId} className="sr-only">זו התקופה הנוכחית</span> : null}
          </>
        ) : (
          <span className="ui-pbar-arrow-slot" aria-hidden="true" />
        )}
      </div>
      <PeriodSheet
        open={sheet}
        onOpenChange={setSheet}
        onCustom={() => {
          setRange(true);
        }}
        options={PRESET_KINDS.map((kind) => {
          const choice = presetPeriod(kind);
          return {
            label: presetLabel(kind),
            hint: kind === "all" && scope === "project" ? "מתחילת הפרויקט" : periodHint(choice),
            selected: samePeriod(choice, period),
            onSelect: () => {
              onChange(choice);
            },
          };
        })}
      />
      <RangeSheet
        open={range}
        onOpenChange={setRange}
        onApply={(from, to) => {
          onChange(customRange(from, to));
        }}
      />
    </div>
  );
}

/** The arrow's name: the month it opens, or "3 חודשים קודמים" / "שנה הבאה". */
function stepName(period: PeriodChoice, target: PeriodChoice | null, delta: -1 | 1): string {
  switch (period.kind) {
    case "month":
      return target ? windowLabel(target) : "החודש הבא";
    case "months3":
      return delta < 0 ? "3 חודשים קודמים" : "3 חודשים הבאים";
    case "months6":
      return delta < 0 ? "6 חודשים קודמים" : "6 חודשים הבאים";
    case "year":
      return delta < 0 ? "שנה קודמת" : "שנה הבאה";
    default:
      return delta < 0 ? "תקופה קודמת" : "תקופה הבאה";
  }
}

/**
 * The stepper chevrons. Each points away from the label, toward its own edge: the start (right)
 * one points right and the end (left) one points left. Drawn as SVG so dir=rtl never flips them.
 */
export function OutwardChevron({ side }: { side: "start" | "end" }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-points={side === "start" ? "right" : "left"}
    >
      <polyline points={side === "start" ? "9 6 15 12 9 18" : "15 6 9 12 15 18"} />
    </svg>
  );
}

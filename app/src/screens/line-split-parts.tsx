import { formatAmountText } from "@flow/shared";
import type { ReactNode } from "react";
import { percentText, shareOfLine, type PartUnit, type PayloadPart, type ServerPart } from "../line-split";
import { IconButton } from "../ui/icon-button";
import { CloseIcon } from "../ui/icons";
import { SegmentedControl } from "../ui/segmented-control";

/** What every split write refreshes: the parts, the line, and every P&L figure. */
export const LINE_SPLIT_KEYS = ["line-split", "txn", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines", "review"];

/** 49 parts plus the rest: the server takes 50 (plan §2). */
export const LINE_SPLIT_MAX_PARTS = 49;

const PICK_LINE_PROJECT = "פרויקט השורה";

/** The line as the editor needs it. */
export type LineInfo = {
  id: string;
  /** Signed, as stored. */
  amountNet: bigint;
  direction: "income" | "expense";
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  projectId: string | null;
  projectName: string | null;
  supplier: string;
  docDate: string;
  /** An open review other than `split_mismatch` refuses the save (0125). */
  reviewBlocked: boolean;
  /** That open review's id, when known: לתור opens its card. */
  reviewId?: string | null;
  /** A loan split refuses a split by category (0104). */
  loanSplit: boolean;
  /** `in_pnl_override` true: the line's kept-out parts count, so a reversal part needs a project (0138). */
  inPnl?: boolean;
};

/** The server calls the editor makes. Stories and tests pass their own. */
export type LineSplitApi = {
  preview: (parts: PayloadPart[]) => Promise<ServerPart[]>;
  save: (parts: PayloadPart[]) => Promise<void>;
};

export function money(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { detail: true });
}

export function Amount({ minor, currency, className }: { minor: bigint; currency: string; className?: string }) {
  return <bdi className={className ? `ui-num ${className}` : "ui-num"} dir="ltr">{money(minor, currency)}</bdi>;
}

const PERCENT_SHOWN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A share as shown: "25,720.16%". percentText stays bare, as it fills the % field. */
export function Percent({ value }: { value: number }) {
  return <bdi className="ui-num" dir="ltr">{`${PERCENT_SHOWN.format(Number(percentText(value)))}%`}</bdi>;
}

export function partProjectLabel(projectName: string | null | undefined, lineProject: string | null): string {
  if (projectName) return projectName;
  return lineProject ? `${lineProject} · ${PICK_LINE_PROJECT}` : "בלי פרויקט";
}

/** A part's ✕, on its row in either split. */
export function SplitRemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <IconButton className="ui-lsplit-remove" label={`הסרת החלק ${name}`} onClick={onRemove}>
      <CloseIcon size={18} />
    </IconButton>
  );
}

/** A part's unit switch: a percent, or the money sign. */
export function SplitUnitToggle({
  name,
  unit,
  amountLabel,
  disabled,
  onChange,
}: {
  name: string;
  unit: PartUnit;
  amountLabel: string;
  disabled: boolean;
  onChange: (unit: PartUnit) => void;
}) {
  return (
    <SegmentedControl
      label={`יחידה, ${name}`}
      showLabel={false}
      radius="input"
      value={unit}
      options={[{ value: "percent", label: "%" }, { value: "amount", label: amountLabel }]}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

/** The rest row's figure: what stays on the line, "לא נשאר" when the parts overshoot, else its share. `unknown` shows until it is known. */
export function SplitRestAmount({
  restMinor,
  lineMinor,
  currency,
  unknown,
}: {
  restMinor: bigint | null;
  lineMinor: bigint;
  currency: string;
  unknown: ReactNode;
}) {
  if (restMinor == null) return <span className="ui-lsplit-amount t-body">{unknown}</span>;
  if (restMinor < 0n) {
    return (
      <>
        <span className="ui-lsplit-amount t-body ui-split-bad"><Amount minor={restMinor} currency={currency} /></span>
        <span className="ui-lsplit-resolved t-label">לא נשאר</span>
      </>
    );
  }
  return (
    <>
      <span className="ui-lsplit-amount t-body"><Amount minor={restMinor} currency={currency} /></span>
      <span className="ui-lsplit-resolved t-label">{restMinor === 0n ? "יורד" : <Percent value={shareOfLine(restMinor, lineMinor)} />}</span>
    </>
  );
}

/** The "פוצלו" and "נשאר לשורה" figures under a split's parts; `over` says the parts pass the line. */
export function SplitSums({ busy, over, paid, left }: { busy: boolean; over: boolean; paid: ReactNode; left: ReactNode }) {
  return (
    <span className="ui-lsplit-sums">
      <span className="ui-lsplit-total">
        <span className="t-hint">פוצלו</span>
        <span className="t-body">
          {busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
          {paid}
        </span>
      </span>
      <span className="ui-lsplit-total ui-lsplit-total-end">
        <span className="t-hint">{over ? "עוברים את השורה" : "נשאר לשורה"}</span>
        <span className={over ? "t-body ui-split-bad" : "t-body"}>{left}</span>
      </span>
    </span>
  );
}

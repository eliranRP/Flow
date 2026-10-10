import { useId, type ReactNode, type RefObject } from "react";
import { Button } from "./button";
import { MoneyField } from "./money-field";
import { Sheet } from "./sheet";
import { TextLink } from "./text-link";

/** The parts of a loan payment, in the order the sheet lists them (FLOW-114, option B). */
export type LoanPartKey = "principal" | "interest" | "escrow" | "fees";

export const LOAN_PART_ORDER: readonly LoanPartKey[] = ["principal", "interest", "escrow", "fees"];

export const LOAN_PART_LABEL: Record<LoanPartKey, string> = {
  principal: "קרן",
  interest: "ריבית",
  escrow: "מסים וביטוח",
  fees: "עמלות",
};

/** The matched row's title: "תשלום הלוואה · <loan name>". */
export function loanPaymentTitle(loanName: string | null | undefined): string {
  return loanName ? `תשלום הלוואה · ${loanName}` : "תשלום הלוואה";
}

/** "4 חלקים" under the matched row. */
export function loanPartsCount(count: number): string {
  return `${String(count)} חלקים`;
}

export type LoanPartField = { part: LoanPartKey; value: string };

/**
 * FLOW-114 option B: the split sheet of a matched loan payment. One amount per part, the total,
 * one "שמירה", and a quiet "ביטול השיוך" under it. Values stay while a save runs or fails.
 * Read-only (a viewer): the parts and the total as static rows, and no actions (screen 11a).
 */
export function LoanPartsSheet({
  open,
  onOpenChange,
  title,
  fields,
  onFieldChange,
  prefix = "₪",
  total,
  problem,
  note,
  loading = false,
  saving = false,
  unmatching = false,
  canSave,
  onSave,
  onUnmatch,
  onRetry,
  retrying = false,
  unmatchDisabled = false,
  readOnly = false,
  onEdit,
  editDisabled = false,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The loan's name. */
  title: string;
  /** Raw digits per part; read-only, each value is the formatted amount. */
  fields: readonly LoanPartField[];
  onFieldChange?: (part: LoanPartKey, raw: string) => void;
  /** ₪ or $, the loan's currency. */
  prefix?: string;
  /** The parts added up, formatted, for the סה״כ row. */
  total: string;
  /** Why שמירה is off, one short line under the total (the parts don't add up to the line). */
  problem?: ReactNode;
  /** One line above the parts, such as why the split waits for review. */
  note?: string;
  /** The stored parts are still being read: the fields wait, שמירה stays off. */
  loading?: boolean;
  saving?: boolean;
  unmatching?: boolean;
  canSave?: boolean;
  onSave?: () => void;
  onUnmatch?: () => void;
  /** The stored parts failed to load: a "ניסיון חוזר" under the problem line reads them again. */
  onRetry?: () => void;
  /** The stored parts are being read again: ניסיון חוזר shows busy. */
  retrying?: boolean;
  /** ביטול השיוך waits, such as while the stored parts are read. */
  unmatchDisabled?: boolean;
  /** A viewer: static amounts, no שמירה and no ביטול השיוך. */
  readOnly?: boolean;
  /** FLOW-106 §3.4: "עריכת הפיצול" under the total opens the split editor on these parts. */
  onEdit?: () => void;
  /** עריכת הפיצול waits, such as while the loan is read. */
  editDisabled?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const problemId = useId();
  const busy = saving || unmatching;
  const ordered = LOAN_PART_ORDER.flatMap((part) => {
    const field = fields.find((item) => item.part === part);
    return field ? [field] : [];
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // A dismiss during a write waits for it (0075).
        if (!next && busy) return false;
        onOpenChange(next);
        return true;
      }}
      title={title}
      returnFocusRef={returnFocusRef}
      action={readOnly ? undefined : (
        <div className="ui-loan-parts-actions">
          <Button
            type="button"
            full
            busy={saving}
            disabled={canSave !== true || loading || unmatching}
            aria-describedby={problem ? problemId : undefined}
            onClick={() => { if (canSave === true && !busy) onSave?.(); }}
          >
            {saving ? "שומר…" : "שמירה"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            quiet
            full
            busy={unmatching}
            disabled={saving || loading || unmatchDisabled}
            onClick={() => { if (!busy) onUnmatch?.(); }}
          >
            {unmatching ? "מבטל…" : "ביטול השיוך"}
          </Button>
        </div>
      )}
    >
      {note ? <p className="t-hint ui-loan-parts-note">{note}</p> : null}
      <div className="ui-loan-parts">
        {ordered.map((field, index) => (
          <div key={field.part} className="ui-loan-parts-row">
            <span className="t-label ui-loan-parts-label">{LOAN_PART_LABEL[field.part]}</span>
            {readOnly ? (
              <bdi className="ui-num t-amount" dir="ltr">{field.value}</bdi>
            ) : (
            <div className="ui-loan-parts-field">
              <MoneyField
                hideLabel
                id={`loan-part-${field.part}`}
                label={`סכום, ${LOAN_PART_LABEL[field.part]}`}
                prefix={prefix}
                value={field.value}
                disabled={loading || busy}
                describedBy={problem ? problemId : undefined}
                enterKeyHint={index === ordered.length - 1 ? "done" : "next"}
                onValueChange={(raw) => { onFieldChange?.(field.part, raw); }}
              />
            </div>
            )}
          </div>
        ))}
        <div className="ui-loan-parts-total">
          <span>סה״כ</span>
          <bdi className="ui-num" dir="ltr">{total}</bdi>
        </div>
        {problem ? <p id={problemId} className="t-hint ui-loan-parts-problem" role="status">{problem}</p> : null}
        {onRetry ? (
          <Button type="button" variant="secondary" className="ui-loan-parts-retry" busy={retrying} onClick={() => { if (!retrying) onRetry(); }}>ניסיון חוזר</Button>
        ) : null}
        {onEdit && !readOnly ? (
          <TextLink className="ui-loan-other" tone="quiet" chevron={false} disabled={loading || busy || editDisabled} onClick={onEdit}>
            עריכת הפיצול
          </TextLink>
        ) : null}
      </div>
    </Sheet>
  );
}

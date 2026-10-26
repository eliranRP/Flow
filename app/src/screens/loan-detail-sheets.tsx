import { useEffect, useState } from "react";
import type { LoanSplitPart } from "@flow/shared";
import { ListRow } from "../ui/list-row";
import { SearchField } from "../ui/search-field";
import { Sheet } from "../ui/sheet";
import { LOAN_PART_LABEL } from "./loan-copy";
import {
  FEES_NONE_DESC,
  keyedCategory,
  partCategoryOptions,
  partDefaultLabel,
  type LoanCategory,
  type LoanDetail,
} from "./loan-detail-data";

/**
 * A sheet's save: null when it saved, else the Hebrew to show inside the sheet. An empty string
 * is a failure the page already told in a toast (with ניסיון חוזר): the sheet stays open with
 * its values.
 */
export type SheetSave<T> = (value: T) => Promise<string | null>;

/** More rows than this get a search field (guide §7.13). */
const SEARCH_FROM = 8;

/**
 * One part's category (plan §3.2): the keyed default (fees: no fixed category) first, then the
 * categories private.loan_part_category_ok allows. A tap saves (0075).
 */
export function LoanPartSheet({
  part,
  loan,
  categories,
  open,
  onOpenChange,
  onSave,
  returnFocusRef,
}: {
  part: LoanSplitPart | null;
  loan: Pick<LoanDetail, "categoryIds">;
  categories: readonly LoanCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: SheetSave<{ part: LoanSplitPart; categoryId: string | null }>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const [saving, setSaving] = useState<{ id: string | null } | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setQuery("");
      setError(null);
    }
  }, [open, part]);
  if (part == null) return null;
  const current = loan.categoryIds[part];
  // A loan that names the keyed category itself files to the default: that row is the checked one.
  const onDefault = current == null || current === keyedCategory(categories, part)?.id;
  const options = partCategoryOptions(categories, part, current);
  const needle = query.trim();
  const searchable = options.length >= SEARCH_FROM;
  const shown = searchable && needle !== "" ? options.filter((row) => row.name.includes(needle)) : options;
  const choose = (id: string | null) => {
    if (saving != null) return;
    if (id === current || (id == null && onDefault)) {
      onOpenChange(false);
      return;
    }
    setSaving({ id });
    setError(null);
    void onSave({ part, categoryId: id }).then((failed) => {
      setSaving(null);
      if (failed == null) onOpenChange(false);
      else setError(failed === "" ? null : failed);
    });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        onOpenChange(next);
      }}
      title={LOAN_PART_LABEL[part]}
      hint="תשלומים שכבר שויכו נשארים בקטגוריה שלהם."
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-fit"
    >
      <div className="ui-change-picker">
        {searchable ? (
          <SearchField label="חיפוש קטגוריה" value={query} onChange={setQuery} placeholder="חיפוש קטגוריה" autoFocus={false} />
        ) : null}
        <div role="radiogroup" aria-label={LOAN_PART_LABEL[part]}>
          <ListRow control="radio"
            layout="picker"
            title={partDefaultLabel(categories, part)}
            description={part === "fees" ? FEES_NONE_DESC : undefined}
            selected={onDefault}
            busy={saving != null && saving.id == null}
            disabled={saving != null && saving.id != null}
            onSelect={() => { choose(null); }}
          />
          {shown.map((row) => (
            <ListRow control="radio"
              key={row.id}
              layout="picker"
              title={row.name}
              description={part !== "principal" && row.excludedFromPnl ? "לא נספר ברווח" : undefined}
              selected={row.id === current}
              busy={saving?.id === row.id}
              disabled={saving != null && saving.id !== row.id}
              onSelect={() => { choose(row.id); }}
            />
          ))}
        </div>
        {searchable && needle !== "" && shown.length === 0 ? <p className="t-caption t-muted">לא נמצאה קטגוריה בשם הזה</p> : null}
        {error ? <p className="ui-field-message ui-loan-sheet-error" role="alert">{error}</p> : null}
      </div>
    </Sheet>
  );
}

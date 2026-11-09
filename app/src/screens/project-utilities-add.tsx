import { formatAmountText } from "@flow/shared";
import type { ScheduleRow } from "../recurring-schedule";
import { PlusIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import type { UtilityPayer } from "../utility-refunds";

/** The property's recurring expenses that are not a utility yet: the suppliers הוספת ספק offers. */
export function supplierChoices(schedule: readonly ScheduleRow[], projectId: string, utilities: readonly UtilityPayer[]): ScheduleRow[] {
  const known = new Set(utilities.map((row) => `${row.supplier_id}:${row.currency}`));
  const seen = new Set<string>();
  return schedule.filter((row) => {
    const key = `${row.party_id}:${row.currency}`;
    if (row.direction !== "expense" || row.project_id !== projectId || known.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * FLOW-1135 (V3-Project-Utilities): הוספת ספק. Flow finds a property's utilities from its חשבונות lines; a supplier
 * filed elsewhere is added here, from the property's recurring expenses, and starts as paid back by the tenant.
 */
export function AddSupplierSheet({ open, onOpenChange, choices, onAdd }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choices: readonly ScheduleRow[];
  onAdd: (row: ScheduleRow) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="הוספת ספק" hint="ספק שנוסף מתחיל כ״שוכר״: בודקים שהשוכר החזיר כל חשבון.">
      {choices.length === 0 ? (
        <p className="t-caption t-muted">אין עוד ספקים קבועים בנכס הזה. ספק שמשלמים לו כל חודש יופיע כאן.</p>
      ) : (
        <List>
          {choices.map((row) => (
            <ListRow
              key={`${row.party_id}:${row.currency}`}
              variant="button"
              title={row.party_name}
              hint={[row.category_name, `בדרך כלל ${formatAmountText(BigInt(row.typical_amount_minor), row.currency, { detail: true })}`].filter(Boolean).join(" · ")}
              icon={<PlusIcon />}
              onClick={() => { onAdd(row); }}
            />
          ))}
        </List>
      )}
    </Sheet>
  );
}

import { type CategoryRow } from "@flow/shared";
import { useState, type RefObject } from "react";
import {
  DELETE_LOAN_USED,
  deleteConsequence,
  deleteDetail,
  deleteItem,
  moveHint,
  moveTitle,
} from "../category-copy";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { LockIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { useCategoryRehab, useDeleteCategory, useMoveCategoryLines } from "./category-manage";
import { CategoryGroupSheet, groupNames } from "./category-group";
import { CategoryRenameSheet } from "./category-rename";
import { KEPT_OUT } from "./screen-shared";

/** FLOW-405 + FLOW-404: the sheet a category's ⋯ opens in Settings → Categories, and the move and delete it starts. */

export type ManagedCategory = CategoryRow & { count?: number };

/** Whether the category counts as rehab now: the server's answer, else decision 0143's default. */
export function countsAsRehab(category: CategoryRow): boolean {
  if (category.in_rehab != null) return category.in_rehab;
  if (category.rehab != null) return category.rehab;
  return category.excluded_from_pnl !== true && category.loan_part == null;
}

function lineCount(lines: number | undefined): string | undefined {
  if (lines == null) return undefined;
  return lines === 1 ? "תנועה אחת" : `${String(lines)} תנועות`;
}

export function CategoryMenuSheet({
  category,
  rows,
  loanLine,
  pnlBusy,
  onClose,
  onPnl,
  onHide,
  onMerge,
  blocked,
  returnFocusRef,
}: {
  category: ManagedCategory | null;
  /** Every category, for the move picker. */
  rows: ManagedCategory[];
  /** The fixed line a built-in loan category shows instead of the P&L, rehab, move and delete rows. */
  loanLine: string | null;
  pnlBusy: boolean;
  onClose: () => void;
  onPnl: (category: ManagedCategory) => void;
  onHide: (category: ManagedCategory) => void;
  onMerge: (category: ManagedCategory) => void;
  /** A preview or a viewer: says why and returns true, so nothing is written. */
  blocked: () => boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [moveFrom, setMoveFrom] = useState<ManagedCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedCategory | null>(null);
  const [renameTarget, setRenameTarget] = useState<ManagedCategory | null>(null);
  const [groupTarget, setGroupTarget] = useState<ManagedCategory | null>(null);
  const rehab = useCategoryRehab();
  const { move } = useMoveCategoryLines({ onMoved: () => { setMoveFrom(null); } });
  const { remove } = useDeleteCategory({ onDeleted: () => { setDeleteTarget(null); } });
  const keptOut = category?.excluded_from_pnl === true;
  const income = category?.kind === "income";
  const hidden = category?.hidden === true;
  const targets = moveFrom == null
    ? []
    // Same kind, visible, and not a built-in loan category: those take only loan payment parts.
    : rows.filter((row) => row.id !== moveFrom.id && row.kind === moveFrom.kind && !row.hidden && row.loan_part == null);

  function openMove(from: ManagedCategory) {
    onClose();
    setMoveFrom(from);
  }

  return (
    <>
      <Sheet
        open={category != null}
        onOpenChange={(open) => {
          // A dismiss during the P&L write waits for it: success closes the sheet, failure keeps it.
          if (open) return true;
          if (pnlBusy) return false;
          onClose();
          return true;
        }}
        title={category?.name ?? "קטגוריה"}
        returnFocusRef={returnFocusRef}
      >
        {category == null ? null : (
          <div className="ui-stack ui-cat-sheet">
            {loanLine == null && !income && !hidden ? (
              <Toggle
                label="נספרת בשיפוץ"
                hint="העלויות בקטגוריה נכנסות לשיפוץ ולהון המאולץ של כל פרויקט."
                checked={countsAsRehab(category)}
                busy={rehab.isPending}
                onChange={(next) => {
                  if (rehab.isPending || blocked()) return;
                  rehab.mutate({
                    target: { id: category.id, name: category.name },
                    rehab: next,
                    before: category.rehab ?? null,
                    undo: false,
                    counts: next,
                  });
                }}
              />
            ) : null}
            <List>
              {loanLine == null ? (
                <ListRow
                  variant="button"
                  title={keptOut ? "החזרה לרווח והפסד" : KEPT_OUT}
                  hint={keptOut ? "הסכומים ייספרו שוב כהכנסה או הוצאה." : "הכסף נשאר בתזרים, ולא נספר כהכנסה או הוצאה."}
                  wrapHint
                  describeHint
                  busy={pnlBusy}
                  onClick={() => {
                    if (pnlBusy || blocked()) return;
                    onPnl(category);
                  }}
                />
              ) : null}
              <ListRow
                variant="button"
                title="שינוי שם"
                disabled={pnlBusy}
                onClick={() => {
                  onClose();
                  setRenameTarget(category);
                }}
              />
              {/* FLOW-401: an expense category can fold into a group on the project page. */}
              {!income ? (
                <ListRow
                  variant="button"
                  title="קבוצה"
                  meta={category.group_name ?? undefined}
                  disabled={pnlBusy}
                  onClick={() => {
                    onClose();
                    setGroupTarget(category);
                  }}
                />
              ) : null}
              {loanLine == null && !hidden ? (
                <ListRow
                  variant="button"
                  title="העברת כל התנועות"
                  hint={moveHint(category.name, category.lines)}
                  wrapHint
                  describeHint
                  disabled={category.lines === 0}
                  clearHint
                  onClick={() => { openMove(category); }}
                />
              ) : null}
              <ListRow
                variant="button"
                title="מיזוג לקטגוריה אחרת"
                hint={`התנועות עוברות, ו${category.name} מוסתרת.`}
                wrapHint
                describeHint
                disabled={pnlBusy}
                onClick={() => { onMerge(category); }}
              />
              <ListRow
                variant="button"
                title={hidden ? "החזרה לרשימה" : "הסתרה"}
                disabled={pnlBusy}
                onClick={() => { onHide(category); }}
              />
            </List>
            {loanLine != null ? (
              <p className="ui-cat-fixed">
                <LockIcon size={18} />
                {loanLine}
              </p>
            ) : (
              <List className="ui-cat-danger">
                <ListRow
                  variant="danger"
                  title="מחיקה"
                  hint={category.loan_used === true ? DELETE_LOAN_USED : undefined}
                  wrapHint
                  describeHint
                  disabled={category.loan_used === true || pnlBusy}
                  clearHint
                  onClick={() => {
                    onClose();
                    setDeleteTarget(category);
                  }}
                />
              </List>
            )}
          </div>
        )}
      </Sheet>
      <Sheet
        open={moveFrom != null}
        onOpenChange={(open) => {
          if (open) return true;
          if (move.isPending) return false;
          setMoveFrom(null);
          return true;
        }}
        title={moveTitle(moveFrom?.lines)}
        returnFocusRef={returnFocusRef}
      >
        {moveFrom == null ? null : (
          <div className="ui-stack ui-cat-sheet">
            <p className="t-hint text-text-secondary">{`מ${moveFrom.name}. הקטגוריה נשארת ברשימה.`}</p>
            <List>
              {targets.map((target) => (
                <ListRow
                  key={target.id}
                  variant="button"
                  title={target.name}
                  meta={lineCount(target.lines)}
                  busy={move.isPending && move.variables.into.id === target.id}
                  disabled={move.isPending}
                  onClick={() => {
                    if (move.isPending || blocked()) return;
                    move.mutate({ from: { id: moveFrom.id, name: moveFrom.name }, into: { id: target.id, name: target.name } });
                  }}
                />
              ))}
            </List>
          </div>
        )}
      </Sheet>
      <CategoryRenameSheet
        category={renameTarget}
        onClose={() => { setRenameTarget(null); }}
        blocked={blocked}
        returnFocusRef={returnFocusRef}
      />
      <CategoryGroupSheet
        category={groupTarget}
        groups={groupNames(rows)}
        onClose={() => { setGroupTarget(null); }}
        blocked={blocked}
        returnFocusRef={returnFocusRef}
      />
      <ConfirmSheet
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
        title="למחוק את הקטגוריה?"
        item={deleteTarget ? deleteItem(deleteTarget.name, deleteTarget.lines) : undefined}
        consequence={deleteConsequence(deleteTarget?.lines)}
        detail={deleteDetail(deleteTarget?.split_lines)}
        confirmLabel="מחיקה"
        destructive
        busy={remove.isPending}
        returnFocusRef={returnFocusRef}
        alternative={deleteTarget != null && deleteTarget.lines !== 0 ? {
          label: "להעביר את התנועות לקטגוריה אחרת במקום",
          onClick: () => {
            const from = deleteTarget;
            setDeleteTarget(null);
            setMoveFrom(from);
          },
        } : undefined}
        onConfirm={() => {
          if (deleteTarget == null || remove.isPending || blocked()) return;
          remove.mutate({ id: deleteTarget.id, name: deleteTarget.name });
        }}
      />
    </>
  );
}

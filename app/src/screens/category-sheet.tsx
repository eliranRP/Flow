import { type CategoryRow } from "@flow/shared";
import { useState, type RefObject } from "react";
import {
  DELETE_LOAN_USED,
  deleteConsequence,
  deleteDetail,
  deleteItem,
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

/**
 * FLOW-405 + FLOW-404: the sheet a category's ⋯ opens in Settings → Categories, and the move and delete it starts.
 * FLOW-341: one move row and no hints; the picker's switch turns the move into a merge.
 */

export type ManagedCategory = CategoryRow & { count?: number };

/** Whether the category counts as rehab now: the server's answer, else decision 0143's default. */
export function countsAsRehab(category: CategoryRow): boolean {
  if (category.in_rehab != null) return category.in_rehab;
  if (category.rehab != null) return category.rehab;
  return category.excluded_from_pnl !== true && category.loan_part == null;
}

/** Where a category's lines can move: same kind and visible. Only a loan category lists the built-in loan categories, which take only loan payment parts. */
export function moveTargets(from: ManagedCategory, rows: ManagedCategory[]): ManagedCategory[] {
  return rows.filter((row) => row.id !== from.id && row.kind === from.kind && !row.hidden && (from.loan_part != null || row.loan_part == null));
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
  /** The picker's switch was on, or the category can only merge: the screen confirms the merge. */
  onMerge: (from: ManagedCategory, into: ManagedCategory) => void;
  /** A preview or a viewer: says why and returns true, so nothing is written. */
  blocked: () => boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [moveFrom, setMoveFrom] = useState<ManagedCategory | null>(null);
  const [hideAfter, setHideAfter] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedCategory | null>(null);
  const [renameTarget, setRenameTarget] = useState<ManagedCategory | null>(null);
  const [groupTarget, setGroupTarget] = useState<ManagedCategory | null>(null);
  const rehab = useCategoryRehab();
  const { move } = useMoveCategoryLines({ onMoved: () => { setMoveFrom(null); } });
  const { remove } = useDeleteCategory({ onDeleted: () => { setDeleteTarget(null); } });
  const keptOut = category?.excluded_from_pnl === true;
  const income = category?.kind === "income";
  const hidden = category?.hidden === true;
  // A loan category, a hidden one, or one with no lines has nothing to move on its own: it can only merge.
  const mergeOnly = moveFrom != null && (moveFrom.loan_part != null || moveFrom.hidden || moveFrom.lines === 0);
  const targets = moveFrom == null ? [] : moveTargets(moveFrom, rows);
  // FLOW-347: a sheet lists only actions that work today, so no move row when there is nowhere to move.
  const canMove = category != null && moveTargets(category, rows).length > 0;

  function openMove(from: ManagedCategory) {
    onClose();
    setHideAfter(false);
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
                  title={keptOut ? "לספור ברווח" : "לא לספור ברווח"}
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
              {canMove ? (
                <ListRow
                  variant="button"
                  title="העברה לקטגוריה אחרת"
                  disabled={pnlBusy}
                  onClick={() => { openMove(category); }}
                />
              ) : null}
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
        title={mergeOnly ? "מיזוג אל" : moveTitle(moveFrom?.lines)}
        returnFocusRef={returnFocusRef}
      >
        {moveFrom == null ? null : (
          <div className="ui-stack ui-cat-sheet">
            {/* Above the list, so a long list never hides it before the pick. */}
            {mergeOnly ? null : (
              <Toggle
                label={`להסתיר את ${moveFrom.name}`}
                checked={hideAfter}
                disabled={move.isPending}
                onChange={setHideAfter}
              />
            )}
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
                    if (move.isPending) return;
                    if (mergeOnly || hideAfter) {
                      // The merge confirm says what happens, and checks the write gate on its own button.
                      setMoveFrom(null);
                      onMerge(moveFrom, target);
                      return;
                    }
                    if (blocked()) return;
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
            setHideAfter(false);
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

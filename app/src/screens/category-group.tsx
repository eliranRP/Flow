import { useEffect, useRef, useState, type RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { Button } from "../ui/button";
import { PlusIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite } from "../use-write";

/**
 * FLOW-401 (decision 0149): the "בחירת קטגוריית אב" sheet a category's ⋯ opens (FLOW-406: a group is a parent category now). One tap on a group applies it,
 * with a ביטול toast. "קטגוריית אב חדשה" asks for a name. A group with no categories left is gone.
 */

export const GROUP_NAME_MAX = 40;
export const GROUP_SAVED = "קטגוריית האב נשמרה";
export const GROUP_UNDONE = "קטגוריית האב הוחזרה";

/** Folds the same group typed with other spaces, as the server stores it. */
export function cleanGroupName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function groupNameError(name: string): string | undefined {
  const clean = cleanGroupName(name);
  if (clean === "") return "צריך שם לקטגוריה";
  if (clean.length > GROUP_NAME_MAX) return `שם ארוך מדי – עד ${String(GROUP_NAME_MAX)} תווים`;
  return undefined;
}

export function groupFailureText(error: Error): string {
  if ((error as Error & { code?: string }).code === "42501") return "רק בעלי העסק יכולים לשנות קטגוריית אב.";
  if (error.message.includes("category not found")) return "הקטגוריה לא נמצאה.";
  // FLOW-406: a group is a parent category now, one level deep.
  if (error.message.includes("category_parent_nested")) return "לקטגוריה הזו יש תת-קטגוריות, אז אין לה קטגוריית אב.";
  if (error.message.includes("category_parent_loan_part")) return "לקטגוריה של הלוואה אין קטגוריית אב.";
  if (error.message.includes("category_parent_kind")) return "קטגוריית האב מסוג אחר.";
  if (error.message.includes("validation") || (error as Error & { code?: string }).code === "23514") return "שם הקטגוריה לא תקין.";
  return "קטגוריית האב לא נשמרה.";
}

/** The groups in use, in Hebrew order. */
export function groupNames(rows: ReadonlyArray<{ group_name?: string | null }>): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.group_name != null && row.group_name !== "") names.add(row.group_name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "he"));
}

type ParentCandidate = {
  id: string;
  name: string;
  kind: string;
  hidden: boolean;
  loan_part?: string | null;
  parent_id?: string | null;
  group_name?: string | null;
};

/**
 * FLOW-406: where a category can go: a visible top-level category of its kind that is not a loan
 * category, plus any group still in use (an older payload has no parent ids). Hebrew order.
 */
export function parentChoices(category: { id: string; kind: string } | null, rows: readonly ParentCandidate[]): string[] {
  if (category == null) return [];
  const names = new Set(groupNames(rows.filter((row) => row.kind === category.kind)));
  for (const row of rows) {
    if (row.id === category.id || row.kind !== category.kind || row.hidden) continue;
    if (row.loan_part != null || row.parent_id != null) continue;
    names.add(row.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "he"));
}

const GROUP_WRITE_KEYS = ["categories", "project"];

type GroupWrite = { id: string; group: string | null; before: string | null };

async function setGroup(id: string, group: string | null): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  // A blank name clears the group.
  assertNoError(await supabase.rpc("set_category_group", { p_category_id: id, p_group_name: group ?? "" }));
}

/** set_category_group, then a toast whose ביטול puts the earlier group back. */
export function useCategoryGroup(options: { onSaved?: () => void } = {}) {
  const toast = useToast();
  const undo = useWrite<GroupWrite>({
    failure: groupFailureText,
    success: GROUP_UNDONE,
    keys: GROUP_WRITE_KEYS,
    run: async ({ id, before }) => { await setGroup(id, before); },
  });
  const save = useWrite<GroupWrite>({
    failure: groupFailureText,
    keys: GROUP_WRITE_KEYS,
    // Also runs after a retry from the failure toast, with that payload.
    onSuccess: (done) => {
      toast.show({ message: GROUP_SAVED, action: "ביטול", onAction: () => { undo.mutate(done); } });
      options.onSaved?.();
    },
    run: async (payload) => { await setGroup(payload.id, payload.group); },
  });
  return { save, undo };
}

export function CategoryGroupSheet({
  category,
  groups,
  onClose,
  blocked,
  returnFocusRef,
}: {
  category: { id: string; name: string; group_name?: string | null } | null;
  /** The groups in use, from every category. */
  groups: string[];
  onClose: () => void;
  /** A preview or a viewer: says why and returns true, so nothing is written. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const open = category != null;
  const current = category?.group_name ?? null;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const wasOpen = useRef(false);
  const { save } = useCategoryGroup({ onSaved: onClose });

  useEffect(() => {
    if (open && !wasOpen.current) {
      setAdding(false);
      setName("");
      setError(undefined);
      save.reset();
    }
    wasOpen.current = open;
  }, [open, save]);

  function pick(group: string | null) {
    if (category == null || save.isPending) return;
    if (group === current) {
      onClose();
      return;
    }
    if (blocked()) return;
    save.mutate({ id: category.id, group, before: current });
  }

  function submitNew() {
    const problem = groupNameError(name);
    setError(problem);
    if (problem) return;
    pick(cleanGroupName(name));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) return true;
        if (save.isPending) return false;
        onClose();
        return true;
      }}
      title="בחירת קטגוריית אב"
      hint={category?.name}
      returnFocusRef={returnFocusRef}
      action={adding ? (
        <Button busy={save.isPending} onClick={submitNew}>
          שמירה
        </Button>
      ) : undefined}
    >
      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitNew();
          }}
        >
          <TextField
            label="שם הקטגוריה"
            value={name}
            maxLength={GROUP_NAME_MAX * 2}
            error={error}
            disabled={save.isPending}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(undefined);
            }}
            enterKeyHint="done"
          />
        </form>
      ) : (
        <div className="ui-stack ui-cat-sheet">
          <div role="radiogroup" aria-label="קטגוריית אב">
            <RadioRow
              label="בלי קטגוריית אב"
              selected={current == null}
              busy={save.isPending && save.variables.group == null}
              disabled={save.isPending}
              onSelect={() => { pick(null); }}
            />
            {groups.map((group) => (
              <RadioRow
                key={group}
                label={group}
                selected={current === group}
                busy={save.isPending && save.variables.group === group}
                disabled={save.isPending}
                onSelect={() => { pick(group); }}
              />
            ))}
          </div>
          <List>
            <ListRow
              variant="button"
              title="קטגוריית אב חדשה"
              icon={<PlusIcon />}
              className="ui-row-add"
              disabled={save.isPending}
              onClick={() => { setAdding(true); }}
            />
          </List>
        </div>
      )}
    </Sheet>
  );
}

import { useEffect, useRef, useState, type RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { CATEGORY_NAME_MAX, categoryNameError, RENAME_CATEGORY_TAKEN } from "../category-copy";
import { Button } from "../ui/button";
import { PlusIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite } from "../use-write";

/**
 * FLOW-401, then FLOW-406 (decision 0164): the "בחירת קטגוריית אב" sheet a category's ⋯ opens.
 * One tap on a parent applies it by id (`set_category_parent`), with a ביטול toast that puts the
 * earlier parent back. "קטגוריית אב חדשה" makes the parent first (`create_category`), then moves.
 */

export const GROUP_SAVED = "קטגוריית האב נשמרה";
export const GROUP_UNDONE = "קטגוריית האב הוחזרה";

/** Folds a name typed with other spaces, as the server stores it. */
export function cleanGroupName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function groupNameError(name: string): string | undefined {
  const clean = cleanGroupName(name);
  if (clean === "") return "צריך שם לקטגוריה";
  return categoryNameError(clean);
}

export function groupFailureText(error: Error): string {
  if ((error as Error & { code?: string }).code === "42501") return "רק בעלי העסק יכולים לשנות קטגוריית אב.";
  if (error.message.includes("already")) return RENAME_CATEGORY_TAKEN;
  if (error.message.includes("category not found")) return "הקטגוריה לא נמצאה.";
  if (error.message.includes("parent not found")) return "קטגוריית האב לא נמצאה.";
  if (error.message.includes("category_parent_nested")) return "לקטגוריה הזו יש תת-קטגוריות, אז אין לה קטגוריית אב.";
  if (error.message.includes("category_parent_loan_part")) return "לקטגוריה של הלוואה אין קטגוריית אב.";
  if (error.message.includes("category_parent_kind")) return "קטגוריית האב מסוג אחר.";
  if (error.message.includes("validation") || (error as Error & { code?: string }).code === "23514") return "שם הקטגוריה לא תקין.";
  return "קטגוריית האב לא נשמרה.";
}

type ParentCandidate = {
  id: string;
  name: string;
  kind: string;
  hidden: boolean;
  loan_part?: string | null;
  parent_id?: string | null;
};

export type ParentChoice = { id: string; name: string };

/** FLOW-406: where a category can go: a visible top-level category of its kind that is not a loan category. Hebrew order. */
export function parentChoices(category: { id: string; kind: string } | null, rows: readonly ParentCandidate[]): ParentChoice[] {
  if (category == null) return [];
  return rows
    .filter((row) => row.id !== category.id && row.kind === category.kind && !row.hidden && row.loan_part == null && row.parent_id == null)
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

const GROUP_WRITE_KEYS = ["categories", "project"];

/** `parent` is a parent's id, or a new parent's name; null takes the category out. */
type GroupWrite = { id: string; kind: string; parent: { id: string } | { name: string } | null; before: string | null };

async function setParent(id: string, parent: string | null): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  // set_category_parent takes null to clear; the generated type misses that.
  assertNoError(await supabase.rpc("set_category_parent", { p_category_id: id, p_parent_id: parent as string }));
}

async function newParent(name: string, kind: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const result = await supabase.rpc("create_category", { p_name: name, p_kind: kind });
  assertNoError(result);
  return result.data as string;
}

/** set_category_parent by id, then a toast whose ביטול puts the earlier parent back. */
export function useCategoryGroup(options: { onSaved?: () => void } = {}) {
  const toast = useToast();
  const undo = useWrite<GroupWrite>({
    failure: groupFailureText,
    success: GROUP_UNDONE,
    keys: GROUP_WRITE_KEYS,
    run: async ({ id, before }) => { await setParent(id, before); },
  });
  const save = useWrite<GroupWrite>({
    failure: groupFailureText,
    keys: GROUP_WRITE_KEYS,
    // Also runs after a retry from the failure toast, with that payload.
    onSuccess: (done) => {
      toast.show({ message: GROUP_SAVED, action: "ביטול", onAction: () => { undo.mutate(done); } });
      options.onSaved?.();
    },
    run: async (payload) => {
      const parent = payload.parent == null ? null : "id" in payload.parent ? payload.parent.id : await newParent(payload.parent.name, payload.kind);
      await setParent(payload.id, parent);
    },
  });
  return { save, undo };
}

/** Which radio a save is writing: a parent's id, null for בלי, undefined for a new parent. */
function savingKey(write: GroupWrite | undefined): string | null | undefined {
  if (write == null) return undefined;
  if (write.parent == null) return null;
  return "id" in write.parent ? write.parent.id : undefined;
}

export function CategoryGroupSheet({
  category,
  choices,
  onClose,
  blocked,
  returnFocusRef,
}: {
  category: { id: string; name: string; kind: string; parent_id?: string | null } | null;
  /** The categories it can go under (parentChoices). */
  choices: ParentChoice[];
  onClose: () => void;
  /** A preview or a viewer: says why and returns true, so nothing is written. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const open = category != null;
  const current = category?.parent_id ?? null;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const wasOpen = useRef(false);
  const { save } = useCategoryGroup({ onSaved: onClose });
  const saving = save.isPending ? savingKey(save.variables) : undefined;

  useEffect(() => {
    if (open && !wasOpen.current) {
      setAdding(false);
      setName("");
      setError(undefined);
      save.reset();
    }
    wasOpen.current = open;
  }, [open, save]);

  function pick(parent: GroupWrite["parent"]) {
    if (category == null || save.isPending) return;
    const same = parent == null ? current == null : "id" in parent && parent.id === current;
    if (same) {
      onClose();
      return;
    }
    if (blocked()) return;
    save.mutate({ id: category.id, kind: category.kind, parent, before: current });
  }

  function submitNew() {
    const problem = groupNameError(name);
    setError(problem);
    if (problem) return;
    const clean = cleanGroupName(name);
    // A name already offered is that parent, so a retyped name never makes a second one.
    const known = choices.find((choice) => choice.name === clean);
    pick(known ? { id: known.id } : { name: clean });
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
            maxLength={CATEGORY_NAME_MAX * 2}
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
              busy={saving === null}
              disabled={save.isPending}
              onSelect={() => { pick(null); }}
            />
            {choices.map((choice) => (
              <RadioRow
                key={choice.id}
                label={choice.name}
                value={choice.id}
                selected={current === choice.id}
                busy={saving === choice.id}
                disabled={save.isPending}
                onSelect={() => { pick({ id: choice.id }); }}
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

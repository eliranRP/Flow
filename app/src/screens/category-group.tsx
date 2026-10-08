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
 * FLOW-401 (decision 0149): the "קבוצה" sheet a category's ⋯ opens. One tap on a group applies it,
 * with a ביטול toast. "קבוצה חדשה" asks for a name. A group with no categories left is gone.
 */

export const GROUP_NAME_MAX = 40;
export const GROUP_SAVED = "הקבוצה נשמרה";
export const GROUP_UNDONE = "הקבוצה הוחזרה";

/** Folds the same group typed with other spaces, as the server stores it. */
export function cleanGroupName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function groupNameError(name: string): string | undefined {
  const clean = cleanGroupName(name);
  if (clean === "") return "צריך שם לקבוצה";
  if (clean.length > GROUP_NAME_MAX) return `שם ארוך מדי – עד ${String(GROUP_NAME_MAX)} תווים`;
  return undefined;
}

export function groupFailureText(error: Error): string {
  if ((error as Error & { code?: string }).code === "42501") return "רק בעלי העסק יכולים לשנות קבוצה.";
  if (error.message.includes("category not found")) return "הקטגוריה לא נמצאה.";
  if (error.message.includes("validation") || (error as Error & { code?: string }).code === "23514") return "שם הקבוצה לא תקין.";
  return "הקבוצה לא נשמרה.";
}

/** The groups in use, in Hebrew order. */
export function groupNames(rows: ReadonlyArray<{ group_name?: string | null }>): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.group_name != null && row.group_name !== "") names.add(row.group_name);
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
      title="קבוצה"
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
            label="שם הקבוצה"
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
          <div role="radiogroup" aria-label="קבוצה">
            <RadioRow
              label="בלי קבוצה"
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
              title="קבוצה חדשה"
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

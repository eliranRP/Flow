import { useEffect, useRef, useState, type RefObject } from "react";
import { CATEGORY_NAME_MAX, categoryNameError } from "../category-copy";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { useRenameCategory } from "./category-manage";

/** The category name sheet the ⋯ sheet's "שינוי שם" opens: one field and שמירה, like the business name. */
export function CategoryRenameSheet({
  category,
  onClose,
  blocked,
  returnFocusRef,
}: {
  category: { id: string; name: string } | null;
  onClose: () => void;
  /** A preview or a viewer: says why and returns true, so nothing is written. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const open = category != null;
  const currentName = category?.name ?? "";
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | undefined>(undefined);
  const wasOpen = useRef(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const { rename } = useRenameCategory({ onRenamed: onClose });

  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(currentName);
      setError(undefined);
    }
    wasOpen.current = open;
  }, [open, currentName]);

  // The field is disabled while saving, so a failed save hands focus back to it.
  const failed = rename.isError;
  useEffect(() => {
    if (failed && open) fieldRef.current?.focus();
  }, [failed, open]);

  const submit = () => {
    if (category == null || rename.isPending) return;
    const problem = categoryNameError(name);
    setError(problem);
    if (problem) return;
    const next = name.trim();
    if (next === category.name.trim()) {
      onClose();
      return;
    }
    if (blocked()) return;
    rename.mutate({ id: category.id, name: next, previous: category.name });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) return true;
        if (rename.isPending) return false;
        onClose();
        return true;
      }}
      title="שינוי שם"
      returnFocusRef={returnFocusRef}
      action={
        <Button busy={rename.isPending} onClick={submit}>
          שמירה
        </Button>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          ref={fieldRef}
          label="שם הקטגוריה"
          value={name}
          maxLength={CATEGORY_NAME_MAX * 2}
          error={error}
          disabled={rename.isPending}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(undefined);
          }}
          onBlur={() => {
            setError(categoryNameError(name));
          }}
          enterKeyHint="done"
        />
      </form>
    </Sheet>
  );
}

import { useEffect, useRef, useState, type RefObject } from "react";
import { getSupabase } from "../lib/supabase";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite, type WriteFailure } from "../use-write";

/** Same bounds as `public.rename_company` (FLOW-602). */
export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 100;

export const RENAME_SAVED = "שם העסק נשמר";
export const RENAME_FAILED = "שם העסק לא נשמר";
export const RENAME_REFUSED = "אין הרשאה לשנות את שם העסק.";
export const RENAME_UNDONE = "שם העסק הוחזר";
export const RENAME_TOO_SHORT = `שם קצר מדי – לפחות ${String(COMPANY_NAME_MIN)} תווים`;
export const RENAME_TOO_LONG = `שם ארוך מדי – עד ${String(COMPANY_NAME_MAX)} תווים`;

export function companyNameError(value: string): string | undefined {
  // Code points, like char_length in the RPC, so an emoji counts once.
  const length = Array.from(value.trim()).length;
  if (length < COMPANY_NAME_MIN) return RENAME_TOO_SHORT;
  if (length > COMPANY_NAME_MAX) return RENAME_TOO_LONG;
  return undefined;
}

function renameFailure(error: Error): WriteFailure {
  const code = (error as Error & { code?: string }).code;
  if (code === "42501") return { message: RENAME_REFUSED, retry: false };
  return RENAME_FAILED;
}

async function renameCompany(companyId: string, name: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  assertNoError(await supabase.rpc("rename_company", { p_company_id: companyId, p_name: name }));
}

type Rename = { companyId: string; name: string; previous: string };

/**
 * The business-name sheet: one field and שמירה (decision 0107). A saved name
 * shows an undo toast; ביטול writes the previous name back.
 */
export function RenameCompanySheet({
  open,
  onOpenChange,
  companyId,
  currentName,
  blocked,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null in a sample or preview, where `blocked` stops the save first. */
  companyId: string | null;
  currentName: string;
  /** Preview mode toasts and returns true. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const toast = useToast();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | undefined>(undefined);
  const wasOpen = useRef(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(currentName);
      setError(undefined);
    }
    wasOpen.current = open;
  }, [open, currentName]);

  const undo = useWrite<Rename>({
    failure: renameFailure,
    success: RENAME_UNDONE,
    keys: ["dashboard"],
    run: async ({ companyId: id, previous }) => {
      await renameCompany(id, previous);
    },
  });

  const saved = useRef<Rename | null>(null);
  const save = useWrite<Rename>({
    failure: renameFailure,
    keys: ["dashboard"],
    // Also runs after a retry from the failure toast, so it reads the last payload.
    onSuccess: () => {
      const payload = saved.current;
      if (payload == null) return;
      onOpenChange(false);
      toast.show({
        message: RENAME_SAVED,
        action: "ביטול",
        onAction: () => { undo.mutate(payload); },
      });
    },
    run: async (payload) => {
      saved.current = payload;
      await renameCompany(payload.companyId, payload.name);
    },
  });

  // The field is disabled while saving, so a failed save hands focus back to it.
  const failed = save.isError;
  useEffect(() => {
    if (failed && open) fieldRef.current?.focus();
  }, [failed, open]);

  const submit = () => {
    if (save.isPending) return;
    const problem = companyNameError(name);
    setError(problem);
    if (problem) return;
    const next = name.trim();
    if (next === currentName.trim()) {
      onOpenChange(false);
      return;
    }
    if (blocked()) return;
    if (companyId == null) return;
    const payload = { companyId, name: next, previous: currentName.trim() };
    save.mutate(payload);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && save.isPending) return;
        onOpenChange(next);
      }}
      title="שם העסק"
      returnFocusRef={returnFocusRef}
      action={
        <Button busy={save.isPending} onClick={submit}>
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
          label="שם"
          value={name}
          maxLength={COMPANY_NAME_MAX + 20}
          error={error}
          disabled={save.isPending}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(undefined);
          }}
          onBlur={() => {
            setError(companyNameError(name));
          }}
          enterKeyHint="done"
        />
      </form>
    </Sheet>
  );
}

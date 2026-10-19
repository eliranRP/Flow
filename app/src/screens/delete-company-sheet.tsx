import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { pinReviewLine } from "../review-pin";
import { useLeaveShownCompany } from "../team-queries";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { TextField } from "../ui/text-field";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite, type WriteFailure } from "../use-write";

export const DANGER_HEAD = "אזור מסוכן";
export const DELETE_ROW = "מחיקת כל הנתונים";
export const DELETE_NOTE = "מוחק את העסק לכל מי שבצוות. החשבון שלך נשאר.";
export const DELETE_TITLE = "למחוק את כל הנתונים?";
export const DELETE_CONSEQUENCE =
  "כל הפרויקטים, התנועות, ההלוואות, החיבורים וההגדרות של העסק יימחקו לכל מי שבצוות. אי אפשר לבטל את המחיקה.";
export const DELETE_FIELD = "כתבו את שם העסק כדי לאשר";
export const DELETE_CONFIRM = "מחיקה לצמיתות";
export const DELETE_DONE = "העסק נמחק";
export const DELETE_FAILED = "לא הצלחנו למחוק את העסק.";
export const DELETE_REFUSED = "רק בעלי העסק יכולים למחוק אותו.";
export const DELETE_MISMATCH = "השם לא תואם. שום דבר לא נמחק.";
/** Where a signed-in user with no company starts; it goes home when another company is left. */
export const AFTER_DELETE_PATH = "/setup/welcome";

/** The typed name matches when it equals the company's name after trimming, as `delete_company` checks. */
export function deleteConfirmMatches(typed: string, companyName: string): boolean {
  const name = companyName.trim();
  return name !== "" && typed.trim() === name;
}

function deleteFailure(error: Error): WriteFailure {
  const code = (error as Error & { code?: string }).code;
  if (code === "42501" || error.message.trim() === "no company") return { message: DELETE_REFUSED, retry: false };
  if (error.message.trim() === "confirmation_mismatch") return { message: DELETE_MISMATCH, retry: false };
  return DELETE_FAILED;
}

type Delete = { companyId: string; confirm: string };

/**
 * The danger zone's confirm (decision 0194): what goes, a field for the company's name, and a
 * destructive button that stays off until the name matches. A delete clears every cached read and
 * opens setup's welcome, which goes home when the user still has another company.
 */
export function DeleteCompanySheet({
  open,
  onOpenChange,
  onLeave,
  companyId,
  companyName,
  blocked,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Closes the sheet without its history step, before the welcome replaces that entry. */
  onLeave: () => void;
  /** Null in a sample or preview, where `blocked` stops the delete first. */
  companyId: string | null;
  companyName: string;
  /** Preview mode toasts and returns true. */
  blocked: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [typed, setTyped] = useState("");
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const leave = useLeaveShownCompany();

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const remove = useWrite<Delete>({
    failure: deleteFailure,
    keys: [],
    onSuccess: () => {
      // The header named the deleted company; the next reads follow the server's choice.
      onLeave();
      leave();
      pinReviewLine(null);
      client.clear();
      void navigate(AFTER_DELETE_PATH, { replace: true });
      toast.show({ message: DELETE_DONE });
    },
    run: async ({ companyId: id, confirm }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("delete_company", { p_company_id: id, p_confirm: confirm }));
    },
  });

  const matches = deleteConfirmMatches(typed, companyName);
  const submit = () => {
    if (remove.isPending || !matches) return;
    if (blocked()) return;
    if (companyId == null) return;
    remove.mutate({ companyId, confirm: typed.trim() });
  };

  return (
    <ConfirmSheet
      open={open}
      onOpenChange={(next) => {
        if (!next && remove.isPending) return;
        onOpenChange(next);
      }}
      title={DELETE_TITLE}
      item={companyName.trim()}
      consequence={DELETE_CONSEQUENCE}
      consequenceSize="body"
      confirmLabel={DELETE_CONFIRM}
      destructive
      busy={remove.isPending}
      confirmDisabled={!matches}
      onConfirm={submit}
      returnFocusRef={returnFocusRef}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={DELETE_FIELD}
          value={typed}
          disabled={remove.isPending}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          onChange={(event) => { setTyped(event.target.value); }}
        />
      </form>
    </ConfirmSheet>
  );
}

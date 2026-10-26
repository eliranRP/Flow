// FLOW-965 (owner, 2026-10-26; decision 0216): after a line's category changes, one offer under its rows
// files the supplier's next lines the same way. "כן, מעכשיו" saves the supplier's remembered category
// (remember_line_category) and toasts under the header with a 5s ביטול; "רק השורה הזו" only closes the
// offer. Earlier lines never change. A project change has no offer: a sync gives a new line its
// remembered category, not a project.
import { useRef, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useToast } from "../ui/toast";
import "../ui/css/59-txn-rule-offer.css";

/** How long a toast offers ביטול on the transaction page (decision 0216, as לאישור's 0212). */
export const LINE_UNDO_MS = 5000;

/** The payee and the category the offer names. */
export type RuleOfferNames = { supplier: string; category: string };

/** The offer: its names and the category the line held when it opened (the server checks it still does). */
export type RuleOffer = RuleOfferNames & { categoryId: string };

/** Only an expense category that is not a loan part is remembered, so only one is offered (0216 §4). */
export function offersRule(category: { kind?: "income" | "expense"; loan_part?: string | null } | undefined): boolean {
  return category != null && (category.kind ?? "expense") === "expense" && category.loan_part == null;
}

type Remembered = { supplier_id: string; category_id: string; prior_category_id: string | null };

/** "להכניס גם את השורות הבאות מ־The Home Depot לקטגוריה ציוד והשכרה? שורות קודמות לא משתנות." */
export function ruleOfferText({ supplier, category }: RuleOfferNames): string {
  return `להכניס גם את השורות הבאות מ־${supplier} לקטגוריה ${category}? שורות קודמות לא משתנות.`;
}

/** "מעכשיו כל השורות מ־The Home Depot ייכנסו לציוד והשכרה" */
export function ruleSavedText({ supplier, category }: RuleOfferNames): string {
  return `מעכשיו כל השורות מ־${supplier} ייכנסו ל${category}`;
}

/** The offer's state and its two writes. `sample` keeps them local (a story's card). */
export function useRuleOffer(lineId: string, sample: boolean) {
  const toast = useToast();
  const [offer, setOffer] = useState<RuleOffer | null>(null);
  const saved = useRef<{ names: RuleOfferNames; remembered: Remembered } | null>(null);
  // No screen reads a supplier's remembered category (a sync uses it for new lines), so neither write
  // refreshes a query.
  const forget = useWrite<Remembered>({
    failure: "לא הצלחנו לבטל.",
    place: "top",
    keys: [],
    success: "השורות הבאות לא ייכנסו לקטגוריה",
    run: async (remembered) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("forget_line_category", {
        p_supplier_id: remembered.supplier_id,
        p_category_id: remembered.category_id,
        // null puts back none; the generated types mark every argument non-null.
        p_prior_category_id: remembered.prior_category_id as string,
      }));
    },
  });
  const remember = useWrite<RuleOffer>({
    failure: "לא הצלחנו לשמור לספק.",
    place: "top",
    keys: [],
    scope: `supplier-rule-${lineId}`,
    onSuccess: (names) => {
      const done = saved.current;
      toast.show({
        message: ruleSavedText(names),
        place: "top",
        durationMs: LINE_UNDO_MS,
        ...(done == null ? {} : { action: "ביטול", onAction: () => { forget.mutate(done.remembered); } }),
      });
    },
    run: async (names) => {
      saved.current = null;
      if (sample) return;
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // The line's category when the offer opened: the server refuses (conflict) once the line holds
      // another one, as when ביטול on the pick is still saving.
      const result = await supabase.rpc("remember_line_category", { p_id: lineId, p_category_id: names.categoryId });
      assertNoError(result);
      const data = result.data as Remembered | null;
      if (data != null) saved.current = { names, remembered: data };
    },
  });
  return {
    offer,
    /** After a category change on a line with a supplier: offer the supplier's next lines. */
    open: (next: RuleOffer) => { setOffer(next); },
    close: () => { setOffer(null); },
    accept: () => {
      if (offer == null || remember.isPending) return;
      setOffer(null);
      remember.mutate(offer);
    },
  };
}

/**
 * The offer card under the project and category rows. Its slot is a polite live region that is always
 * there, so a screen reader hears the offer when the card is added (a region that mounts with its text
 * is not announced).
 */
export function RuleOfferCard({ names, onAccept, onDismiss }: { names: RuleOfferNames | null; onAccept: () => void; onDismiss: () => void }) {
  return (
    <div aria-live="polite">
      {names == null ? null : (
        <div className="ui-rule-offer" role="region" aria-label="החלה על הספק">
          <p className="ui-rule-offer-text">{ruleOfferText(names)}</p>
          <div className="ui-rule-offer-actions">
            <button type="button" className="ui-rule-offer-btn m-press" onClick={onAccept}>כן, מעכשיו</button>
            <button type="button" className="ui-rule-offer-btn m-press" onClick={onDismiss}>רק השורה הזו</button>
          </div>
        </div>
      )}
    </div>
  );
}

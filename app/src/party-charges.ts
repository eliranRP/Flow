import { formatAmountText, type PartyCharges } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { absAgorot } from "./agorot";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { useHomePreview } from "./preview";
import { HEBREW_MONTHS } from "./ui/date-math";
import { waitForAccessToken } from "./wait-for-session";

/**
 * FLOW-431 (the owner's layout A, 2026-10-10 16:07Z): the transaction screen's "חיובים קודמים"
 * section and the sheet with all of them. Every figure is the server's (`party_charges`).
 */

/** A change under this many percent reads as the usual amount ("כרגיל"), so a small wobble is not news. */
const FLAT_BELOW_PERCENT = 5;

/** A row's ±20% mark, shown only from this change on (the sheet's list). */
const MARK_FROM_PERCENT = 20;

export type PartyChangeView = {
  /** "92%", or null when it is the usual amount. */
  percent: string | null;
  arrow: "▲" | "▼" | null;
  /** The change hurts: an expense rose or income fell by 5% or more. Only then is it drawn in the signal colour. */
  hurts: boolean;
  /** The usual amount, "$11.99". */
  usual: string;
  /** The change in words: "עלה ב־92%", "ירד ב־20%" or "כרגיל". */
  change: string;
  /** For screen readers: "עלייה של 92% לעומת הרגיל, $11.99". */
  words: string;
};

/** The section's change line; null when the party has no usual amount yet (too few earlier charges). */
export function partyChangeView(data: PartyCharges | null | undefined): PartyChangeView | null {
  if (!data?.party || data.typical_amount_minor == null || data.change_percent == null) return null;
  const usual = formatAmountText(absAgorot(data.typical_amount_minor), data.party.currency, { detail: true });
  const pct = data.change_percent;
  if (Math.abs(pct) < FLAT_BELOW_PERCENT) {
    return { percent: null, arrow: null, hurts: false, usual, change: "כרגיל", words: `כרגיל, ${usual}` };
  }
  const up = pct > 0;
  const income = data.party.direction === "income";
  const percent = `${String(Math.abs(pct))}%`;
  return {
    percent,
    arrow: up ? "▲" : "▼",
    // An expense going up or income going down is the bad news (DESIGN-RULES: red only then).
    hurts: income ? !up : up,
    usual,
    change: `${up ? "עלה" : "ירד"} ב־${percent}`,
    words: `${up ? "עלייה" : "ירידה"} של ${percent} לעומת הרגיל, ${usual}`,
  };
}

/**
 * FLOW-366: a charge's mark against the usual amount, in the sheet's list: ▲ or ▼ with the percent,
 * from 20% either way. Null when it is closer than that or there is no usual amount.
 */
export function chargeMark(amount: bigint, typical: bigint, income: boolean): { arrow: "▲" | "▼"; percent: string; hurts: boolean } | null {
  const size = absAgorot(amount);
  const usual = absAgorot(typical);
  if (usual === 0n) return null;
  // The cut is on the exact percent, both ways; the shown figure rounds the magnitude, so ±19.5% gets no mark.
  const exact = (Number(size - usual) * 100) / Number(usual);
  if (Math.abs(exact) < MARK_FROM_PERCENT) return null;
  const up = exact > 0;
  return { arrow: up ? "▲" : "▼", percent: `${String(Math.round(Math.abs(exact)))}%`, hurts: income ? !up : up };
}

/** "אוק׳": a month label short enough for 6 bars at 320. */
export function shortMonth(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  const name = HEBREW_MONTHS[index] ?? month;
  return name.length <= 4 ? name : `${name.slice(0, 3)}׳`;
}

/** The section's title: payments out are חיובים, money in is תקבולים. */
export function chargesTitle(data: PartyCharges): string {
  return data.party?.direction === "income" ? "תקבולים קודמים" : "חיובים קודמים";
}

/** The charges before this one, newest first: the section lists 3 and shows only with at least 2. */
export function earlierCharges(data: PartyCharges): PartyCharges["charges"] {
  return data.charges.filter((charge) => charge.id !== data.transaction_id);
}

export function usePartyChargesQuery(transactionId: string, active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: ["party-charges", preview, transactionId],
    enabled: active && preview === "off" && transactionId !== "",
    queryFn: async (): Promise<PartyCharges> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("party_charges", { p_id: transactionId });
      if (error) throw error;
      return (await loadReadSchemas()).partyChargesSchema.parse(data);
    },
  });
}

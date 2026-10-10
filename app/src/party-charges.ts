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

export type ChargeTone = "bad" | "good" | "flat";

export type PartyChangeView = {
  /** "92%", or null when it is the usual amount. */
  percent: string | null;
  arrow: "▲" | "▼" | null;
  tone: ChargeTone;
  /** The usual amount, "$11.99". */
  usual: string;
  /** The change in words: "עלה ב־92%", "ירד ב־20%" or "כמו הרגיל". */
  change: string;
  /** For screen readers: "עלייה של 92% לעומת הרגיל, $11.99". */
  words: string;
};

/** The section's change line; null when the party has no usual amount yet (too few earlier charges). */
export function partyChangeView(data: PartyCharges | null | undefined): PartyChangeView | null {
  if (!data?.party || data.typical_amount_minor == null || data.change_percent == null) return null;
  const usual = formatAmountText(absAgorot(data.typical_amount_minor), data.party.currency, { detail: true });
  const pct = data.change_percent;
  if (pct === 0) {
    return { percent: null, arrow: null, tone: "flat", usual, change: "כמו הרגיל", words: `כמו הרגיל, ${usual}` };
  }
  const up = pct > 0;
  const income = data.party.direction === "income";
  const percent = `${String(Math.abs(pct))}%`;
  const arrow = up ? "▲" : "▼";
  return {
    percent,
    arrow,
    // An expense going up or income going down is the bad news (DESIGN-RULES: red only then).
    tone: income ? (up ? "good" : "bad") : (up ? "bad" : "good"),
    usual,
    change: `${up ? "עלה" : "ירד"} ב־${percent}`,
    words: `${up ? "עלייה" : "ירידה"} של ${percent} לעומת הרגיל, ${usual}`,
  };
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

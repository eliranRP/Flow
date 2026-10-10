import type { PartyCharges } from "@flow/shared";
import { useRef, useState } from "react";
import { partyChangeView, usePartyChargesQuery } from "../party-charges";
import { usePreviewSearch } from "../preview";
import { ChargeChangeChip, PartyChargesSheet } from "../ui/related-charges";

/**
 * FLOW-431 (owner's pick B, 2026-10-10): under the status pills, "▲ 92% לעומת הרגיל $11.99"; a tap
 * opens the party's earlier charges. Nothing shows until the read answers, or when the party has
 * no usual amount yet. A failed read just hides the chip.
 */
export function TxnPartyCharges({ transactionId, sample }: { transactionId: string; sample?: PartyCharges | null }) {
  const search = usePreviewSearch();
  const query = usePartyChargesQuery(sample === undefined ? transactionId : "", sample === undefined);
  const data = sample === undefined ? query.data : sample;
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const view = partyChangeView(data);
  if (data == null || view == null) return null;
  return (
    <>
      <ChargeChangeChip view={view} buttonRef={chipRef} onClick={() => { setOpen(true); }} />
      <PartyChargesSheet open={open} onOpenChange={setOpen} data={data} search={search} returnFocusRef={chipRef} />
    </>
  );
}

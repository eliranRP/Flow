import type { PartyCharges } from "@flow/shared";
import { useRef, useState } from "react";
import { usePartyChargesQuery } from "../party-charges";
import { usePreviewSearch } from "../preview";
import { PartyChargesSection, PartyChargesSheet } from "../ui/related-charges";

/**
 * FLOW-431 (the owner's layout A, 2026-10-10 16:07Z): under the switches, the party's earlier
 * charges in the line's context; "לכל החיובים" opens all of them. Nothing shows until the read
 * answers, and a failed read just hides the section.
 */
export function TxnPartyCharges({ transactionId, sample }: { transactionId: string; sample?: PartyCharges | null }) {
  const search = usePreviewSearch();
  const query = usePartyChargesQuery(sample === undefined ? transactionId : "", sample === undefined);
  const data = sample === undefined ? query.data : sample;
  const [open, setOpen] = useState(false);
  const allRef = useRef<HTMLButtonElement>(null);
  if (data == null) return null;
  return (
    <>
      <PartyChargesSection data={data} search={search} showAllRef={allRef} onShowAll={() => { setOpen(true); }} />
      <PartyChargesSheet open={open} onOpenChange={setOpen} data={data} search={search} returnFocusRef={allRef} />
    </>
  );
}

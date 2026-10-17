import { useRef, useState } from "react";
import type { MyCompanies } from "../team-api";
import { useMyCompaniesQuery } from "../team-queries";
import { useSheetHistory } from "../ui/back";
import { BandCompany } from "../ui/top-band";
import { CompanySheet } from "./company-sheet";

function shownName(data: MyCompanies | undefined, fallback: string | null | undefined): string {
  const active = data?.companies.find((company) => company.id === data.active_id);
  return (active?.name ?? fallback ?? "").trim();
}

/**
 * FLOW-601 (mockup a-3). The shown company's name at the start of Home's band; it opens the
 * העסקים שלך sheet. Until the list answers, Home's own copy of the name stands in.
 */
export function CompanySwitcher({ fallbackName }: { fallbackName?: string | null }) {
  const companies = useMyCompaniesQuery();
  const [open, setOpen] = useState(false);
  const setSheet = useSheetHistory("company", open, setOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const name = shownName(companies.data, fallbackName);
  if (name === "") return null;
  return (
    <>
      <BandCompany name={name} buttonRef={buttonRef} onOpen={() => { setSheet(true); }} />
      <CompanySheet
        open={open}
        onOpenChange={setSheet}
        onLeave={() => { setOpen(false); }}
        returnFocusRef={buttonRef}
      />
    </>
  );
}

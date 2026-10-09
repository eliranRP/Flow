import { useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { SWITCH_FAILED, inviteLine, type MyCompanies } from "../team-api";
import { useLeaveShownCompany, useMyCompaniesQuery, useMyInvitesQuery, useOpenCompany } from "../team-queries";
import { useSheetHistory } from "../ui/back";
import { BandCompany } from "../ui/band-company";
import { PlusIcon } from "../ui/icons";
import { InviteCard } from "../ui/invite-card";
import { List, ListRow } from "../ui/list-row";
import { RadioRow } from "../ui/radio-row";
import { Sheet } from "../ui/sheet";
import { TextLink } from "../ui/text-link";
import { useWrite } from "../use-write";
import { useInviteActions } from "./invite-actions";

/** Where "+ חברה חדשה" goes: the company form, back to Home once it is made. */
export const NEW_COMPANY_PATH = "/onboarding?return=%2F";

function shownName(data: MyCompanies | undefined, fallback: string | null | undefined): string {
  const active = data?.companies.find((company) => company.id === data.active_id);
  return (active?.name ?? fallback ?? "").trim();
}

/**
 * FLOW-601 (mockup a-3). The shown company's name at the start of Home's band; it opens the
 * חברה sheet. Until the list answers, Home's own copy of the name stands in.
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

/**
 * The חברה sheet (mockups a-3, invite-4): one radio row per company (a tap opens it and every
 * read starts over), then the invites with הצטרפות and דחייה, then "+ חברה חדשה".
 */
export function CompanySheet({
  open,
  onOpenChange,
  onLeave,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Closes the sheet without its history step, before "+ חברה חדשה" replaces that entry. */
  onLeave: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const navigate = useNavigate();
  const companies = useMyCompaniesQuery();
  const invites = useMyInvitesQuery(open);
  const openCompany = useOpenCompany();
  const leave = useLeaveShownCompany();
  const switchTo = useWrite<string>({
    keys: [],
    failure: SWITCH_FAILED,
    onSuccess: () => { onOpenChange(false); },
    run: async (companyId) => {
      await openCompany(companyId);
    },
  });
  const actions = useInviteActions({ onJoined: () => { onOpenChange(false); } });
  const data = companies.data;
  const switching = switchTo.isPending ? switchTo.variables : null;
  const held = switching != null || actions.busy != null;
  // A viewer cannot make a company here: the company form is a write, and the write gate sends a viewer back.
  const canCreate = data != null && data.role !== "viewer";
  const pending = invites.data ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="חברה" returnFocusRef={returnFocusRef}>
      {data == null ? (
        companies.isError ? (
          <div className="ui-stack">
            <p className="t-hint" role="status">לא הצלחנו לטעון את החברות.</p>
            <TextLink chevron={false} busy={companies.isFetching} onClick={() => { void companies.refetch(); }}>
              ניסיון חוזר
            </TextLink>
          </div>
        ) : (
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        )
      ) : (
        <div role="radiogroup" aria-label="חברה">
          {data.companies.map((company) => (
            <RadioRow
              key={company.id}
              label={company.name}
              selected={switching == null && company.id === data.active_id}
              busy={switching === company.id}
              disabled={held && switching !== company.id}
              onSelect={() => {
                if (held) return;
                if (company.id === data.active_id) {
                  onOpenChange(false);
                  return;
                }
                switchTo.mutate(company.id);
              }}
            />
          ))}
        </div>
      )}
      {pending.length > 0 ? (
        <section aria-labelledby="company-invites-head">
          <h3 id="company-invites-head" className="ui-company-invites-head">הזמנות</h3>
          {pending.map((invite) => (
            <InviteCard
              key={invite.id}
              company={invite.company_name}
              line={inviteLine(invite)}
              busy={actions.busy?.id === invite.id ? actions.busy.kind : null}
              disabled={held && actions.busy?.id !== invite.id}
              onJoin={() => { actions.join(invite); }}
              onDecline={() => { actions.decline(invite); }}
            />
          ))}
        </section>
      ) : null}
      {canCreate ? (
        <div className="ui-company-new">
          <TextLink
            chevron={false}
            disabled={held}
            icon={<PlusIcon size={16} stroke={2.2} />}
            onClick={() => {
              leave();
              onLeave();
              void navigate(NEW_COMPANY_PATH, { replace: true });
            }}
          >
            חברה חדשה
          </TextLink>
        </div>
      ) : null}
    </Sheet>
  );
}

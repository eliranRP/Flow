import { type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { ROLE_LABEL, SWITCH_FAILED, type MyInvite } from "../team-api";
import { useLeaveShownCompany, useMyCompaniesQuery, useMyInvitesQuery, useOpenCompany } from "../team-queries";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { List, ListRow } from "../ui/list-row";
import { useToast } from "../ui/toast";
import { useWrite } from "../use-write";
import { useInviteActions } from "./invite-actions";

/** Where "+ עסק חדש" goes: the company form, back to Home once it is made. */
export const NEW_COMPANY_PATH = "/onboarding?return=%2F";

function InviteBlock({
  invite,
  busy,
  held,
  onJoin,
  onDecline,
}: {
  invite: MyInvite;
  busy: "join" | "decline" | null;
  held: boolean;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const from = invite.invited_by_name?.trim() || "בעל העסק";
  return (
    <section className="cs-invite" aria-label={invite.company_name}>
      <div className="cs-invite-text">
        <p className="cs-invite-name">{invite.company_name}</p>
        <p className="cs-invite-line">{from} הזמין אותך כ{invite.role === "editor" ? "עורך" : "צופה"}</p>
      </div>
      <div className="cs-invite-actions">
        <Button
          className="cs-join"
          busy={busy === "join"}
          disabled={held}
          aria-label={`הצטרפות ל${invite.company_name}`}
          onClick={onJoin}
        >
          הצטרפות
        </Button>
        <Button
          variant="secondary"
          className="cs-decline"
          busy={busy === "decline"}
          disabled={held}
          aria-label={`דחייה של ${invite.company_name}`}
          onClick={onDecline}
        >
          דחייה
        </Button>
      </div>
    </section>
  );
}

/**
 * The העסקים שלך sheet (board SettingsSwitch): one radio row per business (a tap opens it and every
 * read starts over), the pending invites with הצטרפות and דחייה, then "+ עסק חדש".
 */
export function CompanySheet({
  open,
  onOpenChange,
  onLeave,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Closes the sheet without its history step, before "+ עסק חדש" replaces that entry. */
  onLeave: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const companies = useMyCompaniesQuery();
  const invites = useMyInvitesQuery(open);
  const openCompany = useOpenCompany();
  const leave = useLeaveShownCompany();
  const switchTo = useWrite<{ id: string; name: string }>({
    keys: [],
    failure: SWITCH_FAILED,
    onSuccess: (company) => {
      onOpenChange(false);
      toast.show({ message: `עברת ל־${company.name}` });
    },
    run: async (company) => {
      await openCompany(company.id);
    },
  });
  const actions = useInviteActions({
    onJoined: (invite) => {
      onOpenChange(false);
      toast.show({ message: `הצטרפת ל־${invite.company_name}` });
    },
  });
  const data = companies.data;
  const switching = switchTo.isPending ? switchTo.variables.id : null;
  const held = switching != null || actions.busy != null;
  // A viewer cannot make a company here: the company form is a write, and the write gate sends a viewer back.
  const canCreate = data != null && data.role !== "viewer";
  const pending = (invites.data ?? []).filter((invite) => invite.status !== "expired");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="העסקים שלך" returnFocusRef={returnFocusRef} panelClassName="cs-sheet">
      {data == null ? (
        companies.isError ? (
          <div className="cs-error">
            <p className="t-hint" role="status">לא הצלחנו לטעון את העסקים.</p>
            <Button variant="link" busy={companies.isFetching} onClick={() => { void companies.refetch(); }}>
              ניסיון חוזר
            </Button>
          </div>
        ) : (
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        )
      ) : (
        <div role="radiogroup" aria-label="העסקים שלך" className="cs-list">
          {/* The legacy demo book (a viewer row) cannot be switched to; it shows only while open. */}
          {data.companies.filter((company) => !(company.is_demo && company.role === "viewer") || company.id === data.active_id).map((company) => {
            const current = company.id === data.active_id;
            const on = switching == null ? current : switching === company.id;
            return (
              <button
                key={company.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={company.name}
                aria-busy={switching === company.id || undefined}
                className="cs-row"
                data-on={on}
                disabled={held && switching !== company.id}
                onClick={() => {
                  if (held) return;
                  if (current) {
                    onOpenChange(false);
                    return;
                  }
                  switchTo.mutate({ id: company.id, name: company.name });
                }}
              >
                <span className="cs-tile" aria-hidden="true">{company.name.trim().charAt(0)}</span>
                <span className="cs-text">
                  <span>{company.name}</span>
                  <span className="cs-note">{ROLE_LABEL[company.role]}{current ? " · פתוח עכשיו" : ""}</span>
                </span>
                <span className="cs-radio" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      {pending.length > 0 ? (
        <section aria-labelledby="company-invites-head" className="cs-invites">
          <h3 id="company-invites-head" className="cs-invites-head">הזמנות</h3>
          {pending.map((invite) => (
            <InviteBlock
              key={invite.id}
              invite={invite}
              busy={actions.busy?.id === invite.id ? actions.busy.kind : null}
              held={held}
              onJoin={() => { actions.join(invite); }}
              onDecline={() => { actions.decline(invite); }}
            />
          ))}
        </section>
      ) : null}
      {canCreate ? (
        <button
          type="button"
          className="cs-new"
          disabled={held}
          onClick={() => {
            leave();
            onLeave();
            void navigate(NEW_COMPANY_PATH, { replace: true });
          }}
        >
          <span aria-hidden="true">+ </span>עסק חדש
        </button>
      ) : null}
    </Sheet>
  );
}

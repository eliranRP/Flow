import { useNavigate } from "react-router-dom";
import { screenPhase } from "../query-phase";
import { inviteLine } from "../team-api";
import { useMyCompaniesQuery, useMyInvitesQuery } from "../team-queries";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { MailIcon } from "../ui/icons";
import { InviteCard } from "../ui/invite-card";
import { ScreenHeader } from "../ui/screen-header";
import { Skeleton } from "../ui/skeleton";
import { TextLink } from "../ui/text-link";
import { useInviteActions } from "./invite-actions";

/** Where אחר כך goes: Home for someone with a company, else the first setup step. */
export function laterPath(hasCompany: boolean): string {
  return hasCompany ? "/" : "/setup/0";
}

/**
 * `/invites` (FLOW-601, mockup invite-3): after sign-in, someone with no company and open
 * invites sees them all. הצטרפות opens that company on Home; דחייה offers ביטול; אחר כך goes on to
 * setting up their own business. The invites stay in the חברה sheet on Home.
 */
export function InvitesScreen() {
  const navigate = useNavigate();
  const invites = useMyInvitesQuery();
  const companies = useMyCompaniesQuery();
  const actions = useInviteActions({
    onJoined: () => { void navigate("/", { replace: true }); },
  });
  const hasCompany = companies.data?.active_id != null;
  const phase = screenPhase("off", invites);
  const rows = invites.data ?? [];
  const empty = phase.kind === "ready" && rows.length === 0;
  return (
    <div className="ui-invites-screen">
      <ScreenHeader title="הזמנות" />
      {phase.kind === "loading" ? (
        <div className="ui-invites-list" aria-busy="true">
          <Skeleton width="md" />
          <Skeleton width="sm" />
          <Skeleton width="md" />
          <Skeleton width="sm" />
        </div>
      ) : phase.kind === "error" ? (
        <ErrorState offline={phase.offline} onRetry={() => { void invites.refetch(); }} />
      ) : empty ? (
        <EmptyState
          icon={<MailIcon />}
          title="אין הזמנות פתוחות"
          body={hasCompany ? "אפשר לחזור לבית." : "אפשר להמשיך לפרטי העסק."}
        />
      ) : (
        <div className="ui-invites-list">
          {rows.map((invite) => (
            <InviteCard
              key={invite.id}
              company={invite.company_name}
              line={inviteLine(invite)}
              busy={actions.busy?.id === invite.id ? actions.busy.kind : null}
              disabled={actions.busy != null && actions.busy.id !== invite.id}
              onJoin={() => { actions.join(invite); }}
              onDecline={() => { actions.decline(invite); }}
            />
          ))}
        </div>
      )}
      <div className="ui-invites-later">
        <TextLink chevron={false} disabled={actions.busy != null} to={laterPath(hasCompany)} replace>
          {empty ? "המשך" : "אחר כך"}
        </TextLink>
      </div>
    </div>
  );
}

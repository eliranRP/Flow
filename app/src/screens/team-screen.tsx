import { useCallback, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { screenPhase } from "../query-phase";
import { ROLE_LABEL, memberName, type Team, type TeamInvite, type TeamMember } from "../team-api";
import { useMyCompaniesQuery, useTeamQuery } from "../team-queries";
import { ActionBar } from "../ui/action-bar";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { PeopleIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { PersonRow } from "../ui/person-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { InviteSheet, MemberSheet, PendingInviteSheet } from "./team-sheets";

const TITLE = "צוות";
const BACK = "/settings";

/** The owner first, then the members, in the server's order. */
function ordered(members: readonly TeamMember[]): TeamMember[] {
  return [...members].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
}

/** "הוזמנה · צופה" under a pending invite (mockup invite-2). */
export function inviteHint(invite: Pick<TeamInvite, "role">): string {
  return `הוזמנה · ${ROLE_LABEL[invite.role]}`;
}

/**
 * `/settings/team` (FLOW-601, mockups a-1 and invite-2): one row per person with the role under
 * the name, then the pending invites. The owner opens a member's or an invite's sheet and invites
 * from the bar; anyone else who reaches the page reads the list.
 */
export function TeamScreen() {
  const companies = useMyCompaniesQuery();
  const team = useTeamQuery();
  if (companies.data != null && companies.data.active_id == null) return <Navigate to={BACK} replace />;
  const phase = screenPhase("off", team);
  if (phase.kind === "loading" || phase.kind === "error" || team.data == null) {
    return (
      <ScreenState
        title={TITLE}
        kicker="הגדרות"
        backTo={BACK}
        phase={phase.kind === "error" ? phase : { kind: "loading" }}
        onRetry={() => { void team.refetch(); }}
        loading={(
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        )}
      />
    );
  }
  return <TeamList team={team.data} />;
}

export function TeamList({ team }: { team: Team }) {
  const manage = team.can_manage;
  const opener = useRef<HTMLElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const setInviteSheet = useSheetHistory("team-invite", inviteOpen, setInviteOpen);
  const [memberId, setMemberId] = useState<string | null>(null);
  const closeMember = useCallback((open: boolean) => { if (!open) setMemberId(null); }, []);
  const setMemberSheet = useSheetHistory("team-member", memberId != null, closeMember);
  const [inviteId, setInviteId] = useState<string | null>(null);
  const closeInvite = useCallback((open: boolean) => { if (!open) setInviteId(null); }, []);
  const setPendingSheet = useSheetHistory("team-pending", inviteId != null, closeInvite);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const members = ordered(team.members);
  const invites = manage ? team.invites : [];
  // A removed member or a cancelled invite leaves the list, and its sheet closes with it.
  const member = members.find((row) => row.user_id === memberId && row.role !== "owner") ?? null;
  const invite = invites.find((row) => row.id === inviteId) ?? null;
  const alone = members.length <= 1 && invites.length === 0;
  const remember = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  return (
    <div className={manage ? "ui-team-page" : undefined}>
      <ScreenHeader title={TITLE} kicker="הגדרות" backTo={BACK} />
      <List>
        {members.map((row) => {
          const name = memberName(row);
          const hint = ROLE_LABEL[row.role];
          const opens = manage && row.role !== "owner" && !row.you;
          return (
            <PersonRow
              key={row.user_id}
              name={name}
              hint={hint}
              onOpen={opens ? () => { remember(); setMemberId(row.user_id); } : undefined}
            />
          );
        })}
        {invites.map((row) => (
          <PersonRow
            key={row.id}
            name={row.email}
            hint={inviteHint(row)}
            invite
            onOpen={() => { remember(); setInviteId(row.id); }}
          />
        ))}
      </List>
      {alone && manage ? (
        <EmptyState
          icon={<PeopleIcon />}
          title="עוד אין אנשים בצוות"
          body="הזמינו מישהו לראות את הספרים או לעבוד עליהם איתכם."
        />
      ) : null}
      {manage ? (
        <>
          <ActionBar>
            <Button full buttonRef={inviteButton} onClick={() => { setInviteSheet(true); }}>
              הזמנה
            </Button>
          </ActionBar>
          <InviteSheet
            open={inviteOpen}
            onOpenChange={setInviteSheet}
            invites={team.invites}
            returnFocusRef={inviteButton}
          />
          <MemberSheet member={member} onClose={() => { setMemberSheet(false); }} returnFocusRef={opener} />
          <PendingInviteSheet invite={invite} onClose={() => { setPendingSheet(false); }} returnFocusRef={opener} />
        </>
      ) : null}
    </div>
  );
}

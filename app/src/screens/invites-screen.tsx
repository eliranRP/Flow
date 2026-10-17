import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { screenPhase } from "../query-phase";
import { useTeamApi, type MyCompanies, type MyInvite } from "../team-api";
import { useMyCompaniesQuery, useMyInvitesQuery } from "../team-queries";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { CheckIcon, MailIcon } from "../ui/icons";
import { ScreenHeader } from "../ui/screen-header";
import { Skeleton } from "../ui/skeleton";
import { useInviteActions } from "./invite-actions";
import { FactsCard, RoleCard, inviteDate, inviterName, roleName } from "./invite-screen-parts";

/** Where אחר כך goes: Home for someone with a company, else the first setup step. */
export function laterPath(hasCompany: boolean): string {
  return hasCompany ? "/" : "/setup/welcome";
}

type InviteState = "open" | "joined" | "declined";

/** The newest pending invite not seen yet, else the newest pending, else the newest expired. */
function pickInvite(rows: MyInvite[], id: string | null): MyInvite | null {
  const byNewest = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const asked = id == null ? undefined : byNewest.find((row) => row.id === id);
  const pending = byNewest.filter((row) => row.status !== "expired");
  return asked ?? pending.find((row) => row.seen_at == null) ?? pending[0] ?? byNewest[0] ?? null;
}

/** The business the person already has: the active one, unless it is the one inviting. */
function ownBusiness(data: MyCompanies | undefined, invite: MyInvite | null): string | null {
  const active = data?.companies.find((company) => company.id === data.active_id);
  return active != null && active.id !== invite?.company_id ? active.name.trim() : null;
}

/**
 * `/invites` (FLOW-513, board Invite): one full-screen invitation in five states: open (viewer or
 * editor), expired, joined and declined. The first sign-in after an invite lands here once (it is
 * marked seen); later the invite waits in the החלפת עסק sheet. `sample` only sets the start state
 * of a dev frame.
 */
export function InvitesScreen({ sample }: { sample?: { state: InviteState } }) {
  const navigate = useNavigate();
  const api = useTeamApi();
  const [params] = useSearchParams();
  const invites = useMyInvitesQuery();
  const companies = useMyCompaniesQuery();
  const [state, setState] = useState<InviteState>(sample?.state ?? "open");
  // The invite shown stays while its list refreshes (a decline or a join removes it from the list).
  const [pinned, setPinned] = useState<MyInvite | null>(null);
  const ownAtJoin = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const actions = useInviteActions({
    onJoined: () => { setState("joined"); },
    onDeclined: () => { setState("declined"); },
    onReopened: () => { setState("open"); },
  });
  const rows = invites.data;
  const hasCompany = companies.data?.active_id != null;
  const phase = screenPhase("off", invites);
  const invite = pinned ?? (rows ? pickInvite(rows, params.get("id")) : null);
  useEffect(() => {
    if (pinned == null && invite != null) setPinned(invite);
  }, [pinned, invite]);
  // A pinned invite that is gone (another device answered it) leaves the screen while it is still open.
  useEffect(() => {
    if (pinned && rows && state === "open" && actions.busy == null && !invites.isFetching && !rows.some((row) => row.id === pinned.id)) setPinned(null);
  }, [pinned, rows, state, actions.busy, invites.isFetching]);
  // The first showing marks the invite seen. It never blocks the screen and a failure stays silent.
  useEffect(() => {
    if (sample || invite == null || invite.seen_at != null || seen.current.has(invite.id)) return;
    seen.current.add(invite.id);
    void api.markInviteSeen(invite.id).catch(() => undefined);
  }, [api, invite, sample]);
  const later = laterPath(hasCompany);

  if (invite == null || phase.kind !== "ready") {
    return (
      <div className="invite-plain">
        <ScreenHeader title="הזמנות" />
        {phase.kind === "error" ? (
          <ErrorState offline={phase.offline} onRetry={() => { void invites.refetch(); }} />
        ) : phase.kind === "ready" ? (
          <EmptyState
            icon={<MailIcon />}
            title="אין הזמנות פתוחות"
            body={hasCompany ? "אפשר לחזור לבית." : "אפשר להמשיך לפרטי העסק."}
          />
        ) : (
          <div className="invite-plain-skeleton" aria-busy="true">
            <Skeleton width="md" />
            <Skeleton width="sm" />
          </div>
        )}
        {phase.kind === "loading" ? null : (
          <div className="invite-plain-later">
            <Button variant="link" to={later} replace>{phase.kind === "ready" ? "המשך" : "אחר כך"}</Button>
          </div>
        )}
      </div>
    );
  }

  const business = invite.company_name;
  const inviter = inviterName(invite);
  // Once joined, the joined business is the active one: the own business was noted at the click.
  const own = ownAtJoin.current ?? ownBusiness(companies.data, invite);
  const busy = actions.busy != null;
  const expired = invite.status === "expired";
  const joining = actions.busy?.kind === "join";
  const toFlow = <Button variant="primary" full to={later} replace className="invite-soft">המשך ל־Flow</Button>;

  if (state === "joined") {
    return (
      <main className="invite-screen">
        <div className="invite-glow" aria-hidden="true" />
        <div className="invite-center">
          <span className="invite-done" aria-hidden="true"><CheckIcon size={34} /></span>
          <div className="invite-rise invite-step-3"><h1 className="invite-title">הצטרפת ל־{business}</h1></div>
          <div className="invite-rise invite-step-4-5">
            <p className="invite-lead">
              {own != null
                ? `הוא מופיע עכשיו בהחלפת עסק, ליד ${own}. Flow זוכר את העסק האחרון שפתחת.`
                : "זה העסק הראשון שלך ב־Flow. הכל כבר מחובר ומוכן."}
            </p>
          </div>
        </div>
        <div className="invite-rise invite-step-6 invite-foot">
          <Button variant="primary" full onClick={() => { void navigate("/", { replace: true }); }}>פתיחת {business}</Button>
        </div>
      </main>
    );
  }

  if (state === "declined") {
    return (
      <main className="invite-screen">
        <div className="invite-glow" aria-hidden="true" />
        <div className="invite-center invite-center-declined">
          <h1 className="invite-title">ההזמנה נדחתה</h1>
          <p className="invite-lead">{inviter} יראה שדחית. אם זו טעות, אפשר לבקש ממנו הזמנה חדשה.</p>
          <Button variant="link" busy={actions.reopening} onClick={() => { actions.reopen(invite); }}>ביטול הדחייה</Button>
        </div>
        <div className="invite-foot">{toFlow}</div>
      </main>
    );
  }

  return (
    <main className="invite-screen">
      <div className="invite-glow" aria-hidden="true" />
      <div className="invite-body">
        <span className="invite-tile" aria-hidden="true">{business.trim().charAt(0)}</span>
        <div className="invite-rise invite-step-2 invite-head">
          <span className="invite-eyebrow">{expired ? "ההזמנה פגה" : "הוזמנת להצטרף"}</span>
          <h1 className="invite-title">{business}</h1>
          <p className="invite-lead">
            {expired
              ? `${inviter} הזמין אותך לעסק הזה, אבל ההזמנה כבר לא בתוקף.`
              : `${inviter} מזמין אותך לראות את הספרים של העסק ב־Flow${invite.role === "editor" ? " ולעבוד עליהם." : "."}`}
          </p>
        </div>
        {expired ? (
          <div className="invite-rise invite-step-4">
            <p className="invite-expired-box">
              ההזמנה הייתה בתוקף עד {inviteDate(invite.expires_at ?? invite.created_at, false)}. בקשו מ{inviter} לשלוח הזמנה חדשה מההגדרות של {business}.
            </p>
          </div>
        ) : (
          <>
            <div className="invite-rise invite-step-4"><RoleCard role={invite.role} /></div>
            <div className="invite-rise invite-step-5-5"><FactsCard invite={invite} /></div>
            <div className="invite-rise invite-step-6-5">
              <p className="invite-note">
                {own != null
                  ? `העסק שלך, ${own}, נשאר כמו שהוא. אפשר לעבור בין העסקים מההגדרות.`
                  : "אם תדחו, אפשר לפתוח עסק משלכם ב־Flow."}
              </p>
            </div>
          </>
        )}
      </div>
      <div className="invite-rise invite-step-7-5 invite-foot">
        {expired ? toFlow : (
          <>
            <Button
              variant="primary"
              full
              disabled={busy}
              onClick={() => {
                ownAtJoin.current = ownBusiness(companies.data, invite);
                actions.join(invite);
              }}
            >
              {joining ? "מצטרפים…" : `הצטרפות כ${roleName(invite.role)}`}
            </Button>
            <div className="invite-foot-row">
              <Button variant="link" to={later} replace disabled={busy}>אחר כך</Button>
              <Button variant="danger-link" disabled={busy} onClick={() => { actions.decline(invite); }}>דחיית ההזמנה</Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

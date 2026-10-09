import { useEffect, useRef, useState, type RefObject } from "react";
import {
  CANCEL_FAILED,
  INVITE_CANCELLED,
  INVITE_FAILED,
  INVITE_SENT,
  INVITE_UPDATED,
  MEMBER_REMOVED,
  REMOVE_FAILED,
  ROLE_FAILED,
  ROLE_LABEL,
  ROLE_SAVED,
  inviteEmailError,
  inviteRefusal,
  memberName,
  teamFailure,
  useTeamApi,
  type InviteResult,
  type MemberRole,
  type TeamInvite,
  type TeamMember,
} from "../team-api";
import { TEAM_KEY } from "../team-queries";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { CloseIcon, LogoutIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { RoleChoice } from "../ui/role-choice";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { useToast } from "../ui/toast";
import { useWrite } from "../use-write";

/** The team page's toasts sit above its pinned הזמנה bar (decision 0137). */
const PLACE = "bar" as const;
const KEYS = [TEAM_KEY];

type Invite = { email: string; role: MemberRole };
type InviteSent = { result: InviteResult; previous: MemberRole | null };

/**
 * The undo of an invite: a new one is cancelled, a changed one goes back to the role it had.
 * Shared by the invite sheet and the pending-invite sheet.
 */
function useInviteUndo() {
  const api = useTeamApi();
  const cancel = useWrite<string>({
    keys: KEYS,
    place: PLACE,
    success: INVITE_CANCELLED,
    failure: teamFailure(CANCEL_FAILED),
    run: async (inviteId) => {
      await api.cancelInvite(inviteId);
    },
  });
  const restore = useWrite<Invite>({
    keys: KEYS,
    place: PLACE,
    success: INVITE_UPDATED,
    failure: teamFailure(INVITE_FAILED),
    run: async ({ email, role }) => {
      await api.inviteMember(email, role);
    },
  });
  return { cancel, restore };
}

/**
 * Mockup invite-1: אימייל, then צופה (the default) or עורך with their hints, then שליחת הזמנה.
 * No name: the person's Google name shows once they join. A refusal about the address stays on
 * the field ("already a member", "invalid email"); any other shows a toast.
 */
export function InviteSheet({
  open,
  onOpenChange,
  invites,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pending invites, so a changed one can go back to the role it had. */
  invites: readonly TeamInvite[];
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const api = useTeamApi();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [error, setError] = useState<string | undefined>(undefined);
  const fieldRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setEmail("");
      setRole("viewer");
      setError(undefined);
    }
    wasOpen.current = open;
  }, [open]);
  const undo = useInviteUndo();
  const sent = useRef<InviteSent | null>(null);
  const send = useWrite<Invite>({
    keys: KEYS,
    place: PLACE,
    silent: (failure) => {
      const refusal = inviteRefusal(failure);
      if (!("field" in refusal)) return false;
      setError(refusal.field);
      fieldRef.current?.focus();
      return true;
    },
    failure: (failure) => {
      const refusal = inviteRefusal(failure);
      return "toast" in refusal ? refusal.toast : INVITE_FAILED;
    },
    onSuccess: () => {
      const done = sent.current;
      if (done == null) return;
      onOpenChange(false);
      const { result, previous } = done;
      toast.show({
        place: PLACE,
        message: result.existing ? INVITE_UPDATED : INVITE_SENT,
        action: "ביטול",
        onAction: () => {
          if (result.existing && previous != null) undo.restore.mutate({ email: result.email, role: previous });
          else if (!result.existing) undo.cancel.mutate(result.id);
        },
      });
    },
    run: async (payload) => {
      const before = invites.find((invite) => invite.email.toLowerCase() === payload.email.toLowerCase());
      const result = await api.inviteMember(payload.email, payload.role);
      sent.current = { result, previous: before?.role ?? null };
    },
  });
  const submit = () => {
    if (send.isPending) return;
    const problem = inviteEmailError(email);
    setError(problem);
    if (problem) {
      fieldRef.current?.focus();
      return;
    }
    send.mutate({ email: email.trim(), role });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && send.isPending) return;
        onOpenChange(next);
      }}
      title="הזמנה"
      returnFocusRef={returnFocusRef}
      action={(
        <Button full busy={send.isPending} onClick={submit}>
          שליחת הזמנה
        </Button>
      )}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          ref={fieldRef}
          label="אימייל"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          placeholder="name@example.com"
          maxLength={254}
          value={email}
          error={error}
          disabled={send.isPending}
          enterKeyHint="send"
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(undefined);
          }}
        />
      </form>
      <RoleChoice value={role} hints disabled={send.isPending} onChange={setRole} />
    </Sheet>
  );
}

type RoleChange = { userId: string; role: MemberRole; previous: MemberRole };

/**
 * Mockup a-2: the person's name, צופה / עורך (a tap saves at once and offers ביטול), and
 * הסרה מהצוות behind a confirm. The owner's row opens nothing, so `member` is never the owner.
 */
export function MemberSheet({
  member,
  onClose,
  returnFocusRef,
}: {
  member: TeamMember | null;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const api = useTeamApi();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  // Keeps the name on screen while the sheet animates out.
  const shown = useRef<TeamMember | null>(member);
  if (member != null) shown.current = member;
  const current = shown.current;
  const name = current ? memberName(current) : "";
  const undoRole = useWrite<RoleChange>({
    keys: KEYS,
    place: PLACE,
    success: ROLE_SAVED,
    failure: teamFailure(ROLE_FAILED),
    run: async ({ userId, previous }) => {
      await api.setMemberRole(userId, previous);
    },
  });
  const setRole = useWrite<RoleChange>({
    keys: KEYS,
    place: PLACE,
    failure: teamFailure(ROLE_FAILED),
    onSuccess: (change) => {
      onClose();
      toast.show({
        place: PLACE,
        message: ROLE_SAVED,
        action: "ביטול",
        onAction: () => { undoRole.mutate(change); },
      });
    },
    run: async ({ userId, role }) => {
      await api.setMemberRole(userId, role);
    },
  });
  const remove = useWrite<string>({
    keys: KEYS,
    place: PLACE,
    success: MEMBER_REMOVED,
    failure: teamFailure(REMOVE_FAILED),
    onSuccess: () => {
      setConfirmOpen(false);
      onClose();
    },
    run: async (userId) => {
      await api.removeMember(userId);
    },
  });
  const memberRole: MemberRole = current?.role === "editor" ? "editor" : "viewer";
  return (
    <>
      <Sheet
        open={member != null}
        onOpenChange={(next) => {
          if (!next && !setRole.isPending) onClose();
        }}
        title={name}
        returnFocusRef={returnFocusRef}
      >
        <RoleChoice
          value={memberRole}
          busy={setRole.isPending ? setRole.variables.role : null}
          disabled={undoRole.isPending || remove.isPending}
          onChange={(role) => {
            if (current == null || setRole.isPending) return;
            setRole.mutate({ userId: current.user_id, role, previous: memberRole });
          }}
        />
        <List className="ui-sheet-danger-group">
          <ListRow
            variant="danger"
            title="הסרה מהצוות"
            icon={<LogoutIcon />}
            buttonRef={removeRef}
            disabled={setRole.isPending}
            onClick={() => { setConfirmOpen(true); }}
          />
        </List>
      </Sheet>
      <ConfirmSheet
        open={confirmOpen && member != null}
        onOpenChange={(next) => {
          if (!next && !remove.isPending) setConfirmOpen(false);
        }}
        title="להסיר מהצוות?"
        item={name}
        consequence="הגישה לעסק תיסגר מיד. אפשר להזמין שוב."
        confirmLabel="הסרה"
        destructive
        busy={remove.isPending}
        returnFocusRef={removeRef}
        onConfirm={() => {
          if (current == null || remove.isPending) return;
          remove.mutate(current.user_id);
        }}
      />
    </>
  );
}

/**
 * A pending invite (mockup invite-2): its role can change (invite_member again answers
 * `existing`), or it can be cancelled with ביטול on the toast to send it again.
 */
export function PendingInviteSheet({
  invite,
  onClose,
  returnFocusRef,
}: {
  invite: TeamInvite | null;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const api = useTeamApi();
  const toast = useToast();
  const shown = useRef<TeamInvite | null>(invite);
  if (invite != null) shown.current = invite;
  const current = shown.current;
  const undo = useInviteUndo();
  const change = useWrite<Invite & { previous: MemberRole }>({
    keys: KEYS,
    place: PLACE,
    failure: (failure) => {
      const refusal = inviteRefusal(failure);
      return "toast" in refusal ? refusal.toast : refusal.field;
    },
    onSuccess: ({ email, previous }) => {
      onClose();
      toast.show({
        place: PLACE,
        message: INVITE_UPDATED,
        action: "ביטול",
        onAction: () => { undo.restore.mutate({ email, role: previous }); },
      });
    },
    run: async ({ email, role }) => {
      await api.inviteMember(email, role);
    },
  });
  const cancel = useWrite<TeamInvite>({
    keys: KEYS,
    place: PLACE,
    failure: teamFailure(CANCEL_FAILED),
    onSuccess: (cancelled) => {
      onClose();
      toast.show({
        place: PLACE,
        message: INVITE_CANCELLED,
        action: "ביטול",
        onAction: () => { undo.restore.mutate({ email: cancelled.email, role: cancelled.role }); },
      });
    },
    run: async (row) => {
      await api.cancelInvite(row.id);
    },
  });
  const busy = change.isPending || cancel.isPending;
  return (
    <Sheet
      open={invite != null}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={current?.email ?? ""}
      hint={current ? `הוזמנה · ${ROLE_LABEL[current.role]}` : undefined}
      returnFocusRef={returnFocusRef}
    >
      <RoleChoice
        value={current?.role ?? "viewer"}
        hints
        busy={change.isPending ? change.variables.role : null}
        disabled={cancel.isPending}
        onChange={(role) => {
          if (current == null || busy) return;
          change.mutate({ email: current.email, role, previous: current.role });
        }}
      />
      <List className="ui-sheet-danger-group">
        <ListRow
          variant="danger"
          title="ביטול ההזמנה"
          icon={<CloseIcon />}
          busy={cancel.isPending}
          disabled={change.isPending}
          onClick={() => {
            if (current == null || busy) return;
            cancel.mutate(current);
          }}
        />
      </List>
    </Sheet>
  );
}

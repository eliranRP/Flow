import { useQueryClient } from "@tanstack/react-query";
import {
  DECLINE_FAILED,
  INVITE_DECLINED,
  JOIN_FAILED,
  REOPEN_FAILED,
  teamFailure,
  useTeamApi,
  type MyInvite,
} from "../team-api";
import { MY_INVITES_KEY, useOpenCompany } from "../team-queries";
import { useToast } from "../ui/toast";
import { useTopToast } from "../ui/top-toast";
import { isTransientWriteError, useWrite, type WriteFailure } from "../use-write";

export type InviteBusy = { id: string; kind: "join" | "decline" } | null;

/** After ten minutes the server keeps a decline (`invite is not declined`), so ביטול says it is too late. */
function reopenFailure(error: Error): WriteFailure {
  if (/not declined|not found/.test(error.message)) return { message: REOPEN_FAILED, retry: false };
  return { message: REOPEN_FAILED, retry: isTransientWriteError(error) };
}

/**
 * FLOW-601 (mockups invite-3, invite-4, invite-5). הצטרפות accepts and opens that company (the
 * server already made it the last one opened); דחייה declines with ביטול on the toast, which
 * reopens the invite while the server still allows it. A gone invite leaves the list.
 */
export function useInviteActions({
  onJoined,
  onDeclined,
  onReopened,
  place,
}: {
  onJoined: (invite: MyInvite) => void;
  /** Where the toasts sit: "top" in החלפת עסק on Settings (decision 0222); the default elsewhere. */
  place?: "top";
  /** The invitation screen shows its own declined state, so no toast: it offers `reopen` itself. */
  onDeclined?: (invite: MyInvite) => void;
  onReopened?: (invite: MyInvite) => void;
}) {
  const api = useTeamApi();
  const plainToast = useToast();
  const topToast = useTopToast();
  const toast = place === "top" ? topToast : plainToast;
  const client = useQueryClient();
  const openCompany = useOpenCompany();
  const refreshInvites = () => {
    void client.invalidateQueries({ queryKey: [MY_INVITES_KEY] });
  };
  const join = useWrite<MyInvite>({
    place,
    keys: [],
    failure: teamFailure(JOIN_FAILED),
    onSuccess: onJoined,
    run: async (invite) => {
      try {
        await api.acceptInvite(invite.id);
      } catch (error) {
        refreshInvites();
        throw error;
      }
      await openCompany(invite.company_id, { opened: true });
    },
  });
  const reopen = useWrite<MyInvite>({
    place,
    keys: [MY_INVITES_KEY],
    failure: reopenFailure,
    onSuccess: onReopened,
    run: async (invite) => {
      await api.reopenInvite(invite.id);
    },
  });
  const decline = useWrite<MyInvite>({
    place,
    keys: [MY_INVITES_KEY],
    failure: (error) => {
      refreshInvites();
      return teamFailure(DECLINE_FAILED)(error);
    },
    onSuccess: (invite) => {
      if (onDeclined) {
        onDeclined(invite);
        return;
      }
      toast.show({
        message: INVITE_DECLINED,
        action: "ביטול",
        onAction: () => { reopen.mutate(invite); },
      });
    },
    run: async (invite) => {
      await api.declineInvite(invite.id);
    },
  });
  const busy: InviteBusy = join.isPending
    ? { id: join.variables.id, kind: "join" }
    : decline.isPending
      ? { id: decline.variables.id, kind: "decline" }
      : null;
  return {
    busy,
    join: (invite: MyInvite) => {
      if (busy == null) join.mutate(invite);
    },
    decline: (invite: MyInvite) => {
      if (busy == null) decline.mutate(invite);
    },
    reopen: (invite: MyInvite) => { reopen.mutate(invite); },
    reopening: reopen.isPending,
  };
}

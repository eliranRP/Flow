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
export function useInviteActions({ onJoined }: { onJoined: (invite: MyInvite) => void }) {
  const api = useTeamApi();
  const toast = useToast();
  const client = useQueryClient();
  const openCompany = useOpenCompany();
  const refreshInvites = () => {
    void client.invalidateQueries({ queryKey: [MY_INVITES_KEY] });
  };
  const join = useWrite<MyInvite>({
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
    keys: [MY_INVITES_KEY],
    failure: reopenFailure,
    run: async (invite) => {
      await api.reopenInvite(invite.id);
    },
  });
  const decline = useWrite<MyInvite>({
    keys: [MY_INVITES_KEY],
    failure: (error) => {
      refreshInvites();
      return teamFailure(DECLINE_FAILED)(error);
    },
    onSuccess: (invite) => {
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
  };
}

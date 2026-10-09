import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "./auth";
import { writeRoleCache } from "./company-role-cache";
import { setShownCompany, shownCompanyFor } from "./lib/company-header";
import { pinReviewLine } from "./review-pin";
import { useTeamApi, type MyCompanies } from "./team-api";

/** FLOW-601: the switcher's list and the shown company's role share this one read. */
export const MY_COMPANIES_KEY = "my-companies";
export const TEAM_KEY = "team";
export const MY_INVITES_KEY = "my-invites";

/**
 * Who the team reads answer for: the session's user, or an in-memory team's sample user (a story
 * or a dev fixture, which has no session). A sample never moves the real company header.
 */
export function useTeamUser(): { userId: string | null; signedIn: boolean; sample: boolean } {
  const { status, session } = useAuth();
  const api = useTeamApi();
  if (api.sampleUser != null) return { userId: api.sampleUser, signedIn: true, sample: true };
  return { userId: session?.user.id ?? null, signedIn: status === "authed", sample: false };
}

/**
 * `list_my_companies` for the signed-in user. The answer names the company this request opened
 * (the `x-flow-company` header when the user still belongs to it, else the last one opened), and
 * the app shows that one from then on. A switch made while this read was out wins over its answer.
 */
export function useMyCompaniesQuery(active = true) {
  const { userId, signedIn, sample } = useTeamUser();
  const client = useQueryClient();
  const api = useTeamApi();
  const previousUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = previousUser.current;
    if (previous !== undefined && previous !== userId && previous != null) {
      client.removeQueries({ queryKey: [MY_COMPANIES_KEY, previous] });
    }
    previousUser.current = userId;
  }, [client, userId]);
  const canRead = api.ready();
  const query = useQuery({
    queryKey: [MY_COMPANIES_KEY, userId],
    enabled: active && signedIn && userId != null && canRead,
    retry: false,
    queryFn: async ({ signal }): Promise<MyCompanies> => {
      if (userId == null) throw new Error("no user");
      const sent = shownCompanyFor(userId);
      const data = await api.listMyCompanies();
      // A sign-out clears the cache and aborts this read. A late answer saves nothing.
      signal.throwIfAborted();
      if (!sample && shownCompanyFor(userId) === sent) {
        if (data.active_id !== sent) {
          setShownCompany(userId, data.active_id);
          // The server showed another company (this user left the one sent): no screen keeps its rows.
          if (sent != null) {
            pinReviewLine(null);
            void client.resetQueries({ predicate: (cached) => cached.queryKey[0] !== MY_COMPANIES_KEY });
          }
        }
        writeRoleCache(userId, data.active_id ?? "", data.role ?? "owner");
      }
      return data;
    },
  });
  return { ...query, canRead, userId, signedIn };
}

/** The pending invites addressed to the signed-in user's Google email. */
export function useMyInvitesQuery(active = true) {
  const { userId, signedIn } = useTeamUser();
  const api = useTeamApi();
  return useQuery({
    queryKey: [MY_INVITES_KEY, userId],
    enabled: active && signedIn && userId != null && api.ready(),
    queryFn: () => api.myInvites(),
  });
}

/** The shown company's team: the owner first, then members, then (for the owner) pending invites. */
export function useTeamQuery(active = true) {
  const { userId, signedIn } = useTeamUser();
  const api = useTeamApi();
  return useQuery({
    queryKey: [TEAM_KEY, userId],
    enabled: active && signedIn && userId != null && api.ready(),
    queryFn: () => api.listTeam(),
  });
}

/**
 * Shows another company: the header names it from the next request, the server saves it as the
 * one last opened (unless `opened` says accept_invite already did), and every read starts over,
 * so no screen keeps the last company's figures. A refused switch keeps the company shown before.
 */
export function useOpenCompany(): (companyId: string, options?: { opened?: boolean }) => Promise<void> {
  const client = useQueryClient();
  const { userId, sample } = useTeamUser();
  const api = useTeamApi();
  return async (companyId, options) => {
    if (userId == null) throw new Error("no user");
    const before = shownCompanyFor(userId);
    if (!sample) setShownCompany(userId, companyId);
    if (options?.opened !== true) {
      try {
        await api.switchCompany(companyId);
      } catch (error) {
        if (!sample) setShownCompany(userId, before);
        throw error;
      }
    }
    // The review pin names a line of the last company's books.
    pinReviewLine(null);
    void client.resetQueries();
  };
}

/**
 * "+ חברה חדשה": the header is dropped, so the next reads follow the server's last opened
 * company, which create_company moves to the new one. The list is read again on the way back.
 */
export function useLeaveShownCompany(): () => void {
  const { userId, sample } = useTeamUser();
  return () => {
    if (userId != null && !sample) setShownCompany(userId, null);
  };
}

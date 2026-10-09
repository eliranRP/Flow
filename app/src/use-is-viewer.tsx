import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useId, type ReactElement, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { shownCompanyFor } from "./lib/company-header";
import { usePreviewSearch } from "./preview";
import { readRoleCache } from "./company-role-cache";
import { MY_COMPANIES_KEY, useMyCompaniesQuery, useTeamUser } from "./team-queries";
import { TextLink } from "./ui/text-link";

type PinnedRole = "owner" | "editor" | "viewer";

const PinnedRoleContext = createContext<PinnedRole | null>(null);
const ViewerNoteContext = createContext<string | null>(null);

/** One quiet line. Settings puts it under the header. Review puts it where the actions were. */
export const VIEWER_NOTE = "צפייה בלבד · שינויים נעשים על ידי בעל העסק";

/** Pins the viewer role for a story or a test. No session and no companies read. */
export function ViewerPreview({ children }: { children: ReactNode }) {
  return <PinnedRoleContext.Provider value="viewer">{children}</PinnedRoleContext.Provider>;
}

/** Pins a role for a story or a test (FLOW-601: an editor writes the books, not the owner's settings). */
export function RolePreview({ role, children }: { role: PinnedRole; children: ReactNode }) {
  return <PinnedRoleContext.Provider value={role}>{children}</PinnedRoleContext.Provider>;
}

export type CompanyRole = "loading" | "viewer" | "editor" | "owner" | "unknown";

/**
 * The signed-in user's role in the company the app shows, from `list_my_companies` (FLOW-601):
 * owner, editor, or viewer (a viewer member or the demo viewer). No company yet is an owner, so
 * setup can create one. The role stays loading until that read settles. A failed read uses the
 * last role saved for this user when it was for the company shown now; the server refuses a
 * viewer's writes either way. With nothing saved, the role is unknown: write controls stay
 * hidden, and a later focus or reconnect tries again.
 */
export function useCompanyRole(): CompanyRole {
  const pinned = useContext(PinnedRoleContext);
  const companies = useMyCompaniesQuery(pinned == null);
  const { userId, canRead, signedIn } = companies;
  const failed = companies.isError;
  const refetch = companies.refetch;
  useEffect(() => {
    if (!failed) return;
    const retry = () => { void refetch(); };
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
    };
  }, [failed, refetch]);
  if (pinned != null) return pinned;
  // No session yet, so there is no company to wait for.
  if (!signedIn || userId == null || !canRead) return "owner";
  if (companies.data) return companies.data.role ?? "owner";
  if (failed) {
    const saved = readRoleCache(userId);
    const shown = shownCompanyFor(userId);
    // A role saved for another company than the one shown now says nothing about this one.
    if (saved != null && (shown == null || saved.companyId === shown)) return saved.role;
    return "unknown";
  }
  return "loading";
}

/** Tries the company read again. The quiet line uses this after a failed read. */
export function useRetryCompanyRole(): () => void {
  const client = useQueryClient();
  const { userId } = useTeamUser();
  return () => { void client.refetchQueries({ queryKey: [MY_COMPANIES_KEY, userId] }); };
}

/** True only once the read says this session only reads the company (a viewer member or the demo viewer). */
export function useIsViewer(): boolean {
  return useCompanyRole() === "viewer";
}

/** Hide write affordances while the role is unknown and for a viewer. An editor writes the books. */
export function useHoldWrites(): boolean {
  const role = useCompanyRole();
  return role !== "owner" && role !== "editor";
}

/**
 * FLOW-601: the owner's own settings (the team, the company's name and currency, connectors,
 * Jev, the MCP key) stay read-only for an editor as well as a viewer.
 */
export function useHoldOwnerSettings(): boolean {
  return useCompanyRole() !== "owner";
}

/**
 * A write route renders nothing while the role is loading, and leaves the
 * screen once the session is a viewer.
 */
export function useWriteGate(fallback: string): "show" | "wait" | ReactElement {
  const role = useCompanyRole();
  const search = usePreviewSearch();
  if (role === "viewer" || role === "unknown") return <Navigate to={`${fallback}${search}`} replace />;
  if (role === "loading") return "wait";
  return "show";
}

/** Shares the note id with disabled controls on this screen. */
export function ViewerScope({ children }: { children: ReactNode }) {
  const role = useCompanyRole();
  const id = useId();
  const noted = role === "viewer" || role === "unknown";
  return <ViewerNoteContext.Provider value={noted ? id : null}>{children}</ViewerNoteContext.Provider>;
}

export function ViewerNote({ className = "ui-page-pad t-hint ui-viewer-note" }: { className?: string }) {
  const id = useContext(ViewerNoteContext);
  const role = useCompanyRole();
  const retry = useRetryCompanyRole();
  if (role === "loading") {
    return <p className={className} aria-hidden="true">{VIEWER_NOTE}</p>;
  }
  if (id == null) return null;
  return (
    <p id={id} className={className}>
      {VIEWER_NOTE}
      {role === "unknown" ? (
        <>
          {" "}
          <TextLink size="hint" chevron={false} onClick={retry}>ניסיון חוזר</TextLink>
        </>
      ) : null}
    </p>
  );
}

export function useViewerNoteId(): string | null {
  return useContext(ViewerNoteContext);
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./auth";
import { getSupabase } from "./lib/supabase";
import { usePreviewSearch } from "./preview";

const ViewerContext = createContext<boolean | null>(null);
const ViewerNoteContext = createContext<string | null>(null);

/** One quiet line. Settings puts it under the header. Review puts it where the actions were. */
export const VIEWER_NOTE = "צפייה בלבד · שינויים נעשים על ידי בעל העסק";

/** Pins the viewer role for a story or a test. No session and no companies read. */
export function ViewerPreview({ children }: { children: ReactNode }) {
  return <ViewerContext.Provider value={true}>{children}</ViewerContext.Provider>;
}

export type CompanyRole = "loading" | "viewer" | "owner";

/**
 * Viewer when this session can read a company it does not own.
 * The role stays loading until `owner_id` is known, including a failed read,
 * so a viewer never sees the owner controls. A missing company row is an owner
 * with no company yet. The key includes the user id.
 */
export function useCompanyRole(): CompanyRole {
  const pinned = useContext(ViewerContext);
  const { status, session } = useAuth();
  const userId = session?.user.id ?? null;
  const client = useQueryClient();
  const previousUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = previousUser.current;
    if (previous !== undefined && previous !== userId && previous != null) {
      client.removeQueries({ queryKey: ["company-owner", previous] });
    }
    previousUser.current = userId;
  }, [client, userId]);
  const supabase = getSupabase();
  const canReadOwner = supabase != null && typeof supabase.from === "function";
  const owner = useQuery({
    queryKey: ["company-owner", userId],
    enabled: pinned !== true && status === "authed" && userId != null && canReadOwner,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const client = getSupabase();
      if (!client || typeof client.from !== "function") return null;
      const { data, error } = await client.from("companies").select("owner_id").maybeSingle();
      if (error) throw error;
      return data?.owner_id ?? null;
    },
  });
  if (pinned === true) return "viewer";
  // No session yet, so there is no owner_id to wait for. Once this session is
  // authed, an unknown owner_id stays loading and the write controls stay hidden.
  if (status !== "authed" || userId == null || !canReadOwner) return "owner";
  if (owner.data === undefined) return "loading";
  if (owner.data == null) return "owner";
  return owner.data === userId ? "owner" : "viewer";
}

/** True only once the read says this session does not own the company. */
export function useIsViewer(): boolean {
  return useCompanyRole() === "viewer";
}

/** Hide write affordances while the role is unknown and for a viewer. */
export function useHoldWrites(): boolean {
  return useCompanyRole() !== "owner";
}

/**
 * A write route renders nothing while the role is loading, and leaves the
 * screen once the session is a viewer.
 */
export function useWriteGate(fallback: string): "show" | "wait" | ReactElement {
  const role = useCompanyRole();
  const search = usePreviewSearch();
  if (role === "viewer") return <Navigate to={`${fallback}${search}`} replace />;
  if (role === "loading") return "wait";
  return "show";
}

/** Shares the note id with disabled controls on this screen. */
export function ViewerScope({ children }: { children: ReactNode }) {
  const viewer = useIsViewer();
  const id = useId();
  return <ViewerNoteContext.Provider value={viewer ? id : null}>{children}</ViewerNoteContext.Provider>;
}

export function ViewerNote({ className = "ui-page-pad t-hint ui-viewer-note" }: { className?: string }) {
  const id = useContext(ViewerNoteContext);
  if (id == null) return null;
  return <p id={id} className={className}>{VIEWER_NOTE}</p>;
}

export function useViewerNoteId(): string | null {
  return useContext(ViewerNoteContext);
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./auth";
import { getSupabase } from "./lib/supabase";
import { usePreviewSearch } from "./preview";
import { TextLink } from "./ui/text-link";

const ViewerContext = createContext<boolean | null>(null);
const ViewerNoteContext = createContext<string | null>(null);

/** One quiet line. Settings puts it under the header. Review puts it where the actions were. */
export const VIEWER_NOTE = "צפייה בלבד · שינויים נעשים על ידי בעל העסק";

/** Last successful role, keyed by user id. The value names the company. */
const COMPANY_ROLE_CACHE_KEY = "flow-company-role";

type KnownRole = { companyId: string; role: "owner" | "viewer" };

function readRoleCache(userId: string): KnownRole | null {
  try {
    const raw = localStorage.getItem(COMPANY_ROLE_CACHE_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed == null) return null;
    const entry = (parsed as Record<string, unknown>)[userId];
    if (typeof entry !== "object" || entry == null) return null;
    const companyId = (entry as { companyId?: unknown }).companyId;
    const role = (entry as { role?: unknown }).role;
    if (typeof companyId !== "string") return null;
    if (role !== "owner" && role !== "viewer") return null;
    return { companyId, role };
  } catch {
    return null;
  }
}

function writeRoleCache(userId: string, companyId: string, role: "owner" | "viewer") {
  try {
    const raw = localStorage.getItem(COMPANY_ROLE_CACHE_KEY);
    const parsed: Record<string, KnownRole> = {};
    if (raw != null) {
      const stored: unknown = JSON.parse(raw);
      if (typeof stored === "object" && stored != null) {
        for (const [key, value] of Object.entries(stored)) {
          if (typeof value !== "object" || value == null) continue;
          const storedCompany = (value as { companyId?: unknown }).companyId;
          const storedRole = (value as { role?: unknown }).role;
          if (typeof storedCompany !== "string") continue;
          if (storedRole !== "owner" && storedRole !== "viewer") continue;
          parsed[key] = { companyId: storedCompany, role: storedRole };
        }
      }
    }
    parsed[userId] = { companyId, role };
    localStorage.setItem(COMPANY_ROLE_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // This visit still resolves from the read itself.
  }
}

/** Pins the viewer role for a story or a test. No session and no companies read. */
export function ViewerPreview({ children }: { children: ReactNode }) {
  return <ViewerContext.Provider value={true}>{children}</ViewerContext.Provider>;
}

export type CompanyRole = "loading" | "viewer" | "owner" | "unknown";

function roleFromRow(userId: string, data: { id?: unknown; owner_id?: unknown } | null): KnownRole {
  const companyId = typeof data?.id === "string" ? data.id : "";
  const ownerId = typeof data?.owner_id === "string" ? data.owner_id : null;
  const role = ownerId == null || ownerId === userId ? "owner" : "viewer";
  return { companyId, role };
}

/**
 * Viewer when this session can read a company it does not own.
 * The role stays loading until that read settles. A failed read uses the last
 * role saved for this user and company. With nothing saved, the role is
 * unknown: write controls stay hidden, and a later focus or reconnect tries
 * again. A missing company row is an owner with no company yet. The key
 * includes the user id.
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
    queryFn: async (): Promise<KnownRole> => {
      const read = getSupabase();
      if (!read || typeof read.from !== "function" || userId == null) return { companyId: "", role: "owner" };
      const { data, error } = await read.from("companies").select("id, owner_id").maybeSingle();
      if (error) throw error;
      const known = roleFromRow(userId, data);
      writeRoleCache(userId, known.companyId, known.role);
      return known;
    },
  });
  const failed = owner.isError;
  const refetch = owner.refetch;
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
  if (pinned === true) return "viewer";
  // No session yet, so there is no owner_id to wait for.
  if (status !== "authed" || userId == null || !canReadOwner) return "owner";
  if (owner.data) return owner.data.role;
  if (failed) return readRoleCache(userId)?.role ?? "unknown";
  return "loading";
}

/** Tries the company read again. The quiet line uses this after a failed read. */
export function useRetryCompanyRole(): () => void {
  const client = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  return () => { void client.refetchQueries({ queryKey: ["company-owner", userId] }); };
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

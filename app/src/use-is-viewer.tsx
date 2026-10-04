import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "./auth";
import { getSupabase } from "./lib/supabase";

const ViewerContext = createContext<boolean | null>(null);

/** Pins the viewer role for a story or a test. No session and no companies read. */
export function ViewerPreview({ children }: { children: ReactNode }) {
  return <ViewerContext.Provider value={true}>{children}</ViewerContext.Provider>;
}

/**
 * True when this session can read a company it does not own.
 * The key stays shared on purpose. Per-user keys wait until the Jev scope work lands.
 * A missing row or a failed read stays false, so an owner is not locked out of a write.
 */
export function useIsViewer(): boolean {
  const pinned = useContext(ViewerContext);
  const { status, session } = useAuth();
  const userId = session?.user.id ?? null;
  const owner = useQuery({
    queryKey: ["company-owner"],
    enabled: pinned !== true && status === "authed" && userId != null,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const supabase = getSupabase();
      if (!supabase) return null;
      const { data, error } = await supabase.from("companies").select("owner_id").maybeSingle();
      if (error) throw error;
      return data?.owner_id ?? null;
    },
  });
  if (pinned === true) return true;
  if (userId == null || owner.data == null) return false;
  return owner.data !== userId;
}

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { getSupabase } from "../lib/supabase";
import { usePreviewMode } from "../preview";

/**
 * Same rule as the viewer read: a missing row or a failed owner read is not a viewer.
 * The query key is shared so the two reads stay one cache entry.
 */
export function useSetupViewer(): { ready: boolean; viewer: boolean } {
  const preview = usePreviewMode();
  const { status, session } = useAuth();
  const userId = session?.user.id;
  const query = useQuery({
    queryKey: ["company-owner"],
    enabled: status === "authed" && !preview && userId != null,
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase || typeof supabase.from !== "function") return false;
      const { data, error } = await supabase.from("companies").select("owner_id").maybeSingle();
      if (error || data == null || typeof data.owner_id !== "string") return false;
      return data.owner_id !== userId;
    },
  });
  if (status !== "authed" || preview) return { ready: true, viewer: false };
  if (query.isLoading) return { ready: false, viewer: false };
  return { ready: true, viewer: query.data === true };
}

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { getSupabase } from "../lib/supabase";
import { usePreviewMode } from "../preview";

/**
 * Fail closed until the shared role gate exists.
 * TODO: switch to #42's useCompanyRole / useWriteGate once #42 merges.
 * An error or a missing row counts as a viewer, so setup does not write.
 */
export function useSetupViewer(): { ready: boolean; viewer: boolean } {
  const preview = usePreviewMode();
  const { status, session } = useAuth();
  const userId = session?.user.id;
  const query = useQuery({
    queryKey: ["company-owner", userId],
    enabled: status === "authed" && !preview && userId != null,
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase || typeof supabase.from !== "function") throw new Error("owner");
      const { data, error } = await supabase.from("companies").select("owner_id").maybeSingle();
      if (error || data == null || typeof data.owner_id !== "string") throw new Error("owner");
      return data.owner_id !== userId;
    },
  });
  if (status !== "authed" || preview || userId == null) return { ready: true, viewer: false };
  if (query.isError) return { ready: true, viewer: true };
  if (!query.isSuccess) return { ready: false, viewer: false };
  return { ready: true, viewer: query.data };
}

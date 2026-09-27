import { homeSummarySchema } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { EmptyState } from "../components/EmptyState";
import { OfflineIcon, UploadIcon } from "../components/icons";
import { HomeSkeleton } from "../components/Skeleton";
import { Wordmark } from "../components/Wordmark";
import { getSupabase } from "../lib/supabase";
import { usePreviewMode } from "../preview";

export function HomeScreen() {
  const preview = usePreviewMode();
  const { status } = useAuth();
  const supabase = getSupabase();

  const home = useQuery({
    queryKey: ["home"],
    enabled: !preview && status === "authed" && supabase != null,
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("get_home");
      if (error) throw error;
      return homeSummarySchema.parse(data);
    },
  });

  const loading = !preview && (status === "loading" || home.isLoading);
  const failed = !preview && home.isError;
  const showExample = preview || home.data?.is_demo === true;

  if (loading) return <HomeSkeleton />;

  return (
    <div>
      <header className="band-pad rounded-b-band bg-band px-side pb-10 text-on-band">
        <Wordmark tone="on-band" />
        <p className="mt-8 text-title-2">כאן יופיע הרווח הנקי של העסק</p>
      </header>

      {showExample ? (
        <p className="px-side pt-4 text-hint text-text-muted">נתוני דוגמה · Example data</p>
      ) : null}

      {failed ? (
        <EmptyState
          icon={<OfflineIcon />}
          title="לא הצלחנו לטעון"
          body="בדקו את החיבור ונסו שוב. שום דבר לא נמחק."
          action={
            <button
              type="button"
              onClick={() => void home.refetch()}
              className="inline-flex h-touch items-center rounded-chip bg-tint px-4 text-label text-accent-text"
            >
              ניסיון חוזר
            </button>
          }
        />
      ) : (
        <EmptyState
          icon={<UploadIcon />}
          title="עוד אין נתונים"
          body="מעלים דוח Excel מאפליקציית פועלים, ובונים ממנו רווח והפסד תוך דקה."
          action={
            <Link
              to={preview ? "/add?preview=1" : "/add"}
              className="inline-flex h-touch items-center rounded-chip bg-tint px-4 text-label text-accent-text"
            >
              העלאת דוח בנק
            </Link>
          }
        />
      )}
    </div>
  );
}

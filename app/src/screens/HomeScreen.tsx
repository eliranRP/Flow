import { homeSummarySchema } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { EmptyState } from "../components/EmptyState";
import { ChartIcon, OfflineIcon } from "../components/icons";
import { HomeSkeleton } from "../components/Skeleton";
import { Wordmark } from "../components/Wordmark";
import { homeGreeting, profitBandLabel } from "../home-label";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";

function readOwnerName(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fullName = "full_name" in metadata ? metadata.full_name : undefined;
  const name = "name" in metadata ? metadata.name : undefined;
  const raw = fullName ?? name;
  return typeof raw === "string" ? raw : null;
}

export function HomeScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { status, session } = useAuth();
  const supabase = getSupabase();
  const previewing = preview !== "off";

  const home = useQuery({
    queryKey: ["home"],
    enabled: !previewing && status === "authed" && supabase != null,
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("get_home");
      if (error) throw error;
      return homeSummarySchema.parse(data);
    },
  });

  const loading = preview === "loading" || (!previewing && (status === "loading" || home.isLoading));
  const failed = preview === "error" || (!previewing && home.isError);
  const greeting = homeGreeting(readOwnerName(session?.user.user_metadata));
  // Phase 0 does not wire the P&L yet, so the band stays the first-run placeholder.
  const label = profitBandLabel(false);

  if (loading) return <HomeSkeleton previewing={previewing} />;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="band">
        <div className="band-row">
          <Wordmark tone="on-band" />
        </div>
        <div className="band-hero">
          <p className="t-title-2">{greeting}</p>
          <h1 className="band-label t-label">{label}</h1>
        </div>
        {previewing ? <p className="preview-banner t-hint">מצב תצוגה</p> : null}
      </header>

      {failed ? (
        <EmptyState
          icon={<OfflineIcon />}
          title="לא הצלחנו לטעון"
          body="בדקו את החיבור ונסו שוב. שום דבר לא נמחק."
          action={
            <button
              type="button"
              className="btn-sec"
              onClick={() => {
                if (previewing) {
                  void navigate("/?preview=1");
                  return;
                }
                void home.refetch();
              }}
            >
              ניסיון חוזר
            </button>
          }
        />
      ) : (
        <EmptyState
          icon={<ChartIcon />}
          title="עוד אין נתונים"
          body="הרווח יופיע כאן אחרי ש-SUMIT מחובר."
          action={
            <Link to={`/settings${search}`} className="btn-sec">
              חיבור SUMIT
            </Link>
          }
        />
      )}
    </div>
  );
}

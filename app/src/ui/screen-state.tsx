import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useHomePreview } from "../preview";
import type { ScreenPhase } from "./screen-phase";
import { ErrorState } from "./error-state";
import { ScreenHeader } from "./screen-header";
import { ListSkeleton } from "./skeleton";

export function ScreenState({
  title,
  subtitle,
  backTo,
  action,
  kicker,
  phase,
  onRetry,
  empty,
  loading,
  children,
  stacked = false,
  trailing,
  below,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  action?: ReactNode;
  kicker?: string;
  phase: ScreenPhase;
  onRetry: () => void;
  empty?: ReactNode;
  loading?: ReactNode;
  children?: ReactNode;
  /** The title sits under the bar, like the ready screen it stands in for. */
  stacked?: boolean;
  /** Known chrome that stays real while the data loads, e.g. a period pill. */
  trailing?: ReactNode;
  /** A control under the title that stays real while the data loads (ScreenHeader `below`). */
  below?: ReactNode;
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const location = useLocation();
  function retry() {
    if (preview === "error" || preview === "error-server") {
      const params = new URLSearchParams(location.search);
      params.set("preview", "1");
      // Keep the entry's state: a card opened from a list keeps its prev and next.
      void navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true, state: location.state as unknown });
      return;
    }
    onRetry();
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {stacked ? (
        <ScreenHeader layout="stacked" title={title} subtitle={phase.kind === "ready" ? subtitle : undefined} backTo={backTo} trailing={trailing ?? action} kicker={kicker} below={below} />
      ) : (
        <ScreenHeader title={title} subtitle={phase.kind === "ready" ? subtitle : undefined} backTo={backTo} action={action} trailing={trailing} kicker={kicker} />
      )}
      {phase.kind === "loading" ? (loading ?? <ListSkeleton />) : null}
      {phase.kind === "error" ? <ErrorState offline={phase.offline} onRetry={retry} /> : null}
      {phase.kind === "empty" ? empty : null}
      {phase.kind === "ready" ? children : null}
    </div>
  );
}

import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useHomePreview } from "../preview";
import type { ScreenPhase } from "./screen-phase";
import { ErrorState } from "./error-state";
import { ScreenHeader } from "./screen-header";
import { ListSkeleton, SkeletonSwap } from "./skeleton";
import { SyncStrip } from "./sync-strip";

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
  leading,
  trailing,
  below,
  syncing,
  barOnly = false,
  headerClassName,
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
  /** A stacked bar's start control in place of Back (the Projects tab's "+ פרויקט חדש"). */
  leading?: ReactNode;
  /** Known chrome that stays real while the data loads, e.g. a period pill. */
  trailing?: ReactNode;
  /** A control under the title that stays real while the data loads (ScreenHeader `below`). */
  below?: ReactNode;
  /** A background refresh is running: the strip says what it syncs (FLOW-371). Null when none runs. */
  syncing?: string | null;
  /** Draws only the back bar (with `kicker` as Back's label), not the title: the invoice page's board header. */
  barOnly?: boolean;
  /** The header's own class (the invoice pages scope their bar's spacing with it). */
  headerClassName?: string;
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
      <SyncStrip label={syncing ?? null} />
      {barOnly ? (
        <ScreenHeader barOnly backTo={backTo} kicker={kicker} className={headerClassName} />
      ) : stacked ? (
        <ScreenHeader layout="stacked" title={title} subtitle={phase.kind === "ready" ? subtitle : undefined} backTo={backTo} leading={leading} trailing={trailing ?? action} kicker={kicker} below={below} className={headerClassName} />
      ) : (
        <ScreenHeader title={title} subtitle={phase.kind === "ready" ? subtitle : undefined} backTo={backTo} action={action} trailing={trailing} kicker={kicker} className={headerClassName} />
      )}
      {/* The body is the overlay's frame: a skeleton fades out over it while the content fades in (FLOW-371). */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <SkeletonSwap loading={phase.kind === "loading"}>{loading ?? <ListSkeleton />}</SkeletonSwap>
        {phase.kind === "error" ? <ErrorState offline={phase.offline} onRetry={retry} /> : null}
        {phase.kind === "empty" ? empty : null}
        {phase.kind === "ready" ? <div className="ui-phase-in flex min-h-0 min-w-0 flex-1 flex-col">{children}</div> : null}
      </div>
    </div>
  );
}

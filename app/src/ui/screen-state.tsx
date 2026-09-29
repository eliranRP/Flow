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
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const location = useLocation();
  function retry() {
    if (preview === "error" || preview === "error-server") {
      const params = new URLSearchParams(location.search);
      params.set("preview", "1");
      void navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true });
      return;
    }
    onRetry();
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title={title} subtitle={phase.kind === "ready" ? subtitle : undefined} backTo={backTo} action={action} kicker={kicker} />
      {phase.kind === "loading" ? (loading ?? <ListSkeleton />) : null}
      {phase.kind === "error" ? <ErrorState offline={phase.offline} onRetry={retry} /> : null}
      {phase.kind === "empty" ? empty : null}
      {phase.kind === "ready" ? children : null}
    </div>
  );
}

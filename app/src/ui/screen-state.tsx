import type { ReactNode } from "react";
import type { ScreenPhase } from "./screen-phase";
import { ErrorState } from "./error-state";
import { ScreenHeader } from "./screen-header";
import { ListSkeleton } from "./skeleton";

export function ScreenState({
  title,
  subtitle,
  backTo,
  phase,
  onRetry,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  phase: ScreenPhase;
  onRetry: () => void;
  empty?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title={title} subtitle={phase.kind === "ready" ? subtitle : undefined} backTo={backTo} />
      {phase.kind === "loading" ? <ListSkeleton /> : null}
      {phase.kind === "error" ? <ErrorState offline={phase.offline} onRetry={onRetry} /> : null}
      {phase.kind === "empty" ? empty : null}
      {phase.kind === "ready" ? children : null}
    </div>
  );
}

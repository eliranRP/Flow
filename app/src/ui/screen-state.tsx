import type { ReactNode } from "react";
import type { ScreenPhase } from "../query-phase";
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
    <div>
      <ScreenHeader title={title} subtitle={phase.kind === "ready" ? subtitle : undefined} backTo={backTo} />
      {phase.kind === "loading" ? <ListSkeleton /> : null}
      {phase.kind === "error" ? <ErrorState offline={phase.offline} onRetry={onRetry} /> : null}
      {phase.kind === "empty" ? empty : null}
      {phase.kind === "ready" ? children : null}
    </div>
  );
}

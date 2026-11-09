import { onlineManager } from "@tanstack/react-query";
import { Component, Suspense, type ReactNode } from "react";
import { FailureLine } from "./ui/empty-state";

type BoundaryState = { failed: boolean };

/**
 * FLOW-804: a screen whose code failed to load (offline before it was cached, or a deploy
 * replaced it) shows the load error instead of blanking the app. React keeps a failed lazy()
 * import, so the retry reloads the page.
 */
class ScreenLoadBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("Screen failed to load", error);
  }

  override render() {
    if (this.state.failed) {
      return (
        <FailureLine
          offline={!onlineManager.isOnline()}
          onRetry={() => {
            window.location.reload();
          }}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Where an on-demand screen renders: the load error if its code fails. While the code loads, nothing,
 * or `fallback` (FLOW-1140, the full-screen outlet). React shows a fallback only in a boundary that is
 * new; one already on screen keeps the screen it shows while a navigation (a transition) loads the next.
 */
export function ScreenSuspense({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return (
    <ScreenLoadBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ScreenLoadBoundary>
  );
}

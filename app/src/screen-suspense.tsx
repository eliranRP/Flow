import { Component, Suspense, type ReactNode } from "react";
import { ErrorState } from "./ui/error-state";

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
        <ErrorState
          offline={typeof navigator !== "undefined" && !navigator.onLine}
          onRetry={() => {
            window.location.reload();
          }}
        />
      );
    }
    return this.props.children;
  }
}

/** Where an on-demand screen renders: nothing while its code loads, the load error if it fails. */
export function ScreenSuspense({ children }: { children: ReactNode }) {
  return (
    <ScreenLoadBoundary>
      <Suspense fallback={null}>{children}</Suspense>
    </ScreenLoadBoundary>
  );
}

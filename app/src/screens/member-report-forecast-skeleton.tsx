import { DelayedSkeleton, Skeleton } from "../ui/skeleton";

/**
 * FLOW-1136: the תחזית tab while its inputs or its code load, in the tab's own shape: the year stepper,
 * the bars, the refinance's calculation and עד אז, then the properties. It waits 300ms like the app's
 * other skeletons (a fast load shows nothing), and says it is loading in one sr-only line.
 */
const BARS = [38, 44, 50, 56, 62, 68, 74, 80, 88, 96] as const;

function CalcCardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="ui-msr-skel-card">
      <Skeleton className="ui-msr-skel-title" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-msr-skel-row">
          <Skeleton className="ui-msr-skel-line" />
          <Skeleton className="ui-msr-skel-figure" />
        </div>
      ))}
    </div>
  );
}

export function ForecastSkeleton() {
  return (
    <DelayedSkeleton>
      {/* The status line sits outside the busy blocks, so screen readers announce it at once. */}
      <p className="sr-only" role="status">טוען את התחזית…</p>
      <div className="ui-msr-skel" aria-busy="true" aria-hidden="true">
        <Skeleton className="ui-msr-skel-stepper" />
        <div className="ui-msr-skel-bars" aria-hidden="true">
          {BARS.map((h) => <Skeleton key={h} className={`ui-msr-skel-bar ui-msr-skel-bar-${String(h)}`} />)}
        </div>
        <CalcCardSkeleton rows={4} />
        <CalcCardSkeleton rows={3} />
        <Skeleton className="ui-msr-skel-title" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="ui-msr-skel-row ui-msr-skel-prop">
            <span className="ui-msr-skel-lines">
              <Skeleton className="ui-msr-skel-line" />
              <Skeleton className="ui-msr-skel-hint" />
            </span>
            <Skeleton className="ui-msr-skel-figure" />
          </div>
        ))}
      </div>
    </DelayedSkeleton>
  );
}

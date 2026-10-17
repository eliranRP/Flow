import type { CSSProperties } from "react";

/**
 * Per-screen skeletons (FLOW-371), drawn from the States board presets linesLoading, projectsLoading,
 * loansLoading, recurringLoading, profitLoading and detailLoading. Each block pulses (the shared
 * .ui-skeleton-bar rule) and the whole screen says it is loading in one sr-only line. The caller
 * decides when to show one; each caller waits 300ms first (ScreenState's SkeletonSwap, or DelayedSkeleton).
 */

type BarProps = { w: string; h: number; pill?: boolean; className?: string };

function Bar({ w, h, pill = false, className }: BarProps) {
  const style: CSSProperties = { inlineSize: w, blockSize: h, flex: "none", ...(pill ? { borderRadius: "var(--radius-chip)" } : {}) };
  return <span aria-hidden="true" className={`ui-skeleton-bar ${className ?? ""}`.trim()} style={style} />;
}

function Loading() {
  return (
    <p className="sr-only" role="status">
      טוען…
    </p>
  );
}

const rows = [0, 1, 2, 3, 4, 5] as const;
const cards = [0, 1, 2] as const;

/** Month lines: a title and a chip, then the lines of the month. */
export function LinesSkeleton() {
  return (
    <div className="ui-page-pad ui-stack" aria-busy="true">
      <Loading />
      <Bar w="150px" h={34} />
      <Bar w="84px" h={36} pill />
      <div className="ui-stack">
        {rows.map((key) => (
          <div className="ui-skel-row" key={key}>
            <Bar w="38%" h={10} />
            <Bar w="20%" h={10} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Projects: a title, then a card per project with its name, period and a progress track. */
export function ProjectsSkeleton() {
  return (
    <div className="ui-page-pad ui-stack" aria-busy="true">
      <Loading />
      <Bar w="170px" h={34} />
      {cards.map((key) => (
        <div className="ui-stack" key={key}>
          <Bar w="30%" h={10} />
          <Bar w="100%" h={6} className="ui-skel-track" />
        </div>
      ))}
    </div>
  );
}

/** Loans: a title and a row of figures per loan, with its payments line. */
export function LoansSkeleton() {
  return (
    <div className="ui-page-pad ui-stack" aria-busy="true">
      <Loading />
      <Bar w="90px" h={12} />
      {cards.map((key) => (
        <div className="ui-stack" key={key}>
          <div className="ui-skel-row">
            <Bar w="80px" h={12} />
            <Bar w="64px" h={12} />
          </div>
          <Bar w="64%" h={10} />
        </div>
      ))}
    </div>
  );
}

/**
 * קבועים (recurring), as the States board draws it (FLOW-447c): the real title, a 12px line, a card block,
 * a 6px track, then two groups, each a head bar and avatar rows with two lines and an amount bar.
 */
export function RecurringSkeleton() {
  return (
    <div className="ui-recurring-skeleton" aria-busy="true">
      <Loading />
      <h1 className="t-title">קבועים</h1>
      <Bar w="120px" h={12} />
      <Bar w="150px" h={34} className="ui-recurring-skeleton-card" />
      <Bar w="100%" h={6} pill />
      {[0, 1].map((group) => (
        <div className="ui-recurring-skeleton-group" key={group}>
          <Bar w={group === 0 ? "80px" : "110px"} h={16} />
          {[0, 1].map((line) => (
            <div className="ui-recurring-skeleton-row" key={line}>
              <span aria-hidden="true" className="ui-skeleton-bar ui-recurring-skeleton-avatar" />
              <div className="ui-recurring-skeleton-lines">
                <Bar w="130px" h={12} />
                <Bar w="84px" h={10} />
              </div>
              <Bar w="64px" h={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Profit: a headline, a pair of figures, the period's total and its progress track. */
export function ProfitSkeleton() {
  return (
    <div className="ui-page-pad ui-stack" aria-busy="true">
      <Loading />
      <Bar w="180px" h={12} />
      <div className="ui-skel-row">
        <Bar w="84px" h={14} />
        <Bar w="90px" h={14} />
      </div>
      <Bar w="120px" h={16} />
      <Bar w="100%" h={6} className="ui-skel-track" />
      <div className="ui-skel-row">
        <Bar w="84px" h={14} />
        <Bar w="90px" h={14} />
      </div>
    </div>
  );
}

/** A transaction page: its title and amount, then the fields as label and value pairs. */
export function DetailSkeleton() {
  return (
    <div className="ui-page-pad ui-stack" aria-busy="true">
      <Loading />
      <Bar w="150px" h={22} />
      <Bar w="120px" h={12} />
      <Bar w="44%" h={13} />
      {rows.slice(0, 3).map((key) => (
        <div className="ui-skel-row" key={key}>
          <Bar w="24px" h={24} />
          <Bar w="60px" h={10} />
        </div>
      ))}
    </div>
  );
}

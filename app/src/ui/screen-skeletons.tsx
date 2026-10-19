import type { CSSProperties } from "react";

/**
 * Per-screen skeletons (FLOW-371), drawn from the States board presets linesLoading, projectsLoading,
 * loansLoading, recurringLoading, profitLoading and detailLoading. Each block pulses (the shared
 * .ui-skeleton-bar rule) and the whole screen says it is loading in one sr-only line. The caller
 * decides when to show one; each caller waits 300ms first (ScreenState's SkeletonSwap, or DelayedSkeleton).
 */

/** `r`: the board's own corner radius in px, for the blocks that are not the 6px default. */
type BarProps = { w: string; h: number; pill?: boolean; r?: number; className?: string };

function Bar({ w, h, pill = false, r, className }: BarProps) {
  const style: CSSProperties = {
    inlineSize: w,
    blockSize: h,
    flex: "none",
    ...(pill ? { borderRadius: "var(--radius-chip)" } : r == null ? {} : { borderRadius: `${String(r)}px` }),
  };
  return <span aria-hidden="true" className={`ui-skeleton-bar ${className ?? ""}`.trim()} style={style} />;
}

function Loading() {
  return (
    <p className="sr-only" role="status">
      טוען…
    </p>
  );
}

const cards = [0, 1, 2] as const;

/**
 * One row of a list skeleton: a 40px circle, two lines and a trailing figure (board linesLoading, loansLoading).
 * `avatar` false drops the circle, for lists whose rows have none (the profit page's months).
 */
function ListRowSkeleton({ first, second, avatar = true }: { first: string; second: string; avatar?: boolean }) {
  return (
    <div className="ui-skel-list-row">
      {avatar ? <Bar w="40px" h={40} r={20} /> : null}
      <div className="ui-skel-list-lines">
        <Bar w={first} h={12} />
        <Bar w={second} h={10} />
      </div>
      <Bar w="64px" h={12} />
    </div>
  );
}

/** Month lines (board States, linesLoading): a figure, its caption, three chips, then two date groups of avatar rows. */
export function LinesSkeleton() {
  return (
    <div className="ui-state-skel" aria-busy="true">
      <Loading />
      <div className="ui-skel-lines-figure">
        <Bar w="150px" h={34} r={8} />
        <Bar w="110px" h={12} />
      </div>
      <div className="ui-skel-lines-chips">
        <Bar w="96px" h={36} pill />
        <Bar w="84px" h={36} pill />
        <Bar w="74px" h={36} pill />
      </div>
      {[3, 3].map((count, group) => (
        <div className="ui-skel-group" key={group}>
          <Bar w={group === 0 ? "100px" : "120px"} h={16} />
          {Array.from({ length: count }, (_, line) => (
            <ListRowSkeleton key={line} first="58%" second="38%" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Projects (board States, projectsLoading): under the title, a label and a figure bar, then a card per project. */
export function ProjectsSkeleton() {
  return (
    <div className="ui-page-pad ui-projects-skel" aria-busy="true">
      <Loading />
      <div className="ui-projects-skel-head">
        <Bar w="130px" h={12} />
        <Bar w="170px" h={34} className="ui-skel-figure" />
      </div>
      <div className="ui-projects-skel-cards">
        {cards.map((key) => (
          <div className="ui-projects-skel-card" key={key}>
            <div className="ui-projects-skel-row">
              <Bar w="40px" h={40} className="ui-skel-tile" />
              <span className="ui-projects-skel-text">
                <Bar w="46%" h={14} />
                <Bar w="30%" h={10} />
              </span>
              <Bar w="70px" h={14} />
            </div>
            <Bar w="100%" h={6} className="ui-skel-track" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Loans (board States, loansLoading): the summary card's blocks, then a head and three avatar rows. */
export function LoansSkeleton() {
  return (
    <div className="ui-state-skel" aria-busy="true">
      <Loading />
      <section className="ui-skel-card ui-skel-loans-card">
        <Bar w="90px" h={12} />
        <Bar w="180px" h={34} r={8} />
        <div className="ui-skel-card-split">
          <Bar w="100px" h={12} />
          <Bar w="80px" h={12} />
        </div>
        <Bar w="100%" h={8} r={4} />
      </section>
      <div className="ui-skel-group">
        <Bar w="70px" h={16} />
        {cards.map((key) => (
          <ListRowSkeleton key={key} first="50%" second="64%" />
        ))}
      </div>
    </div>
  );
}

/**
 * קבועים (recurring), as the States board draws it (FLOW-447c): the real title, a 12px line, a card block,
 * a 6px track, then two groups, each a head bar and avatar rows with two lines and an amount bar.
 */
export function RecurringSkeleton() {
  return (
    <div className="ui-recurring ui-recurring-skeleton" aria-busy="true">
      <Loading />
      <header className="ui-recurring-head">
        <h1 className="t-title">קבועים</h1>
      </header>
      <div className="ui-recurring-skeleton-top">
        <Bar w="120px" h={12} />
        <Bar w="150px" h={34} className="ui-recurring-skeleton-card" />
        <Bar w="100%" h={6} pill />
      </div>
      {[2, 3].map((rows, group) => (
        <div className="ui-recurring-skeleton-group" key={group}>
          <Bar w={group === 0 ? "80px" : "110px"} h={16} />
          {Array.from({ length: rows }, (_, line) => (
            <div className="ui-recurring-skeleton-row" key={line}>
              <span aria-hidden="true" className="ui-skeleton-bar ui-recurring-skeleton-avatar" />
              <div className="ui-recurring-skeleton-lines">
                <Bar w="58%" h={12} />
                <Bar w="38%" h={10} />
              </div>
              <Bar w="64px" h={12} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ProfitFigureRow() {
  return (
    <div className="ui-skel-figure-row">
      <Bar w="90px" h={14} />
      <Bar w="84px" h={14} />
    </div>
  );
}

/** Profit (board States, profitLoading): a figure and a line, a card of three figure rows, a head and three rows with a track. */
export function ProfitSkeleton() {
  return (
    <div className="ui-state-skel" aria-busy="true">
      <Loading />
      <div className="ui-skel-lines-figure">
        <Bar w="150px" h={34} r={8} />
        <Bar w="180px" h={12} />
      </div>
      <section className="ui-skel-card">
        {cards.map((key) => (
          <ProfitFigureRow key={key} />
        ))}
      </section>
      <div className="ui-skel-group ui-skel-profit-group">
        <Bar w="120px" h={16} />
        {cards.map((key) => (
          <div className="ui-skel-profit-row" key={key}>
            <ProfitFigureRow />
            <Bar w="100%" h={6} className="ui-skel-track" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The profit page's month rows while they load, under a figure that is already in: three 64px rows without an
 * avatar, each a name line over a totals line and a trailing figure, 12px under what comes before (.ui-pp-months).
 */
export function ProfitRowsSkeleton() {
  return (
    <div className="ui-state-skel ui-skel-pp-rows" aria-busy="true">
      <Loading />
      {cards.map((key) => (
        <ListRowSkeleton key={key} first="34%" second="62%" avatar={false} />
      ))}
    </div>
  );
}

/** The dashed next-month card's place while its forecast loads: the card's own box (.ui-fc-card), its title and two columns. */
export function NextMonthCardSkeleton() {
  return (
    <div className="ui-fc-card" aria-hidden="true">
      <Bar w="30%" h={14} />
      <span className="ui-fc-cols">
        <span className="ui-fc-col"><Bar w="60%" h={10} /><Bar w="80%" h={24} /></span>
        <span className="ui-fc-col"><Bar w="60%" h={10} /><Bar w="80%" h={24} /></span>
      </span>
    </div>
  );
}

function DetailFieldSkeleton() {
  return (
    <div className="ui-skel-detail-row">
      <Bar w="24px" h={24} />
      <div className="ui-skel-detail-lines">
        <Bar w="60px" h={10} />
        <Bar w="44%" h={13} />
      </div>
    </div>
  );
}

/** A transaction page (board States, detailLoading): an avatar, a title, an amount and a line, then two cards of three and two fields. */
export function DetailSkeleton() {
  return (
    <div className="ui-state-skel ui-skel-detail" aria-busy="true">
      <Loading />
      <div className="ui-skel-detail-head">
        <Bar w="56px" h={56} r={28} />
        <Bar w="150px" h={22} r={8} />
        <Bar w="170px" h={40} r={8} />
        <Bar w="120px" h={12} />
      </div>
      {[3, 2].map((count, card) => (
        <section className="ui-skel-card ui-skel-detail-card" key={card}>
          {Array.from({ length: count }, (_, line) => (
            <DetailFieldSkeleton key={line} />
          ))}
        </section>
      ))}
    </div>
  );
}

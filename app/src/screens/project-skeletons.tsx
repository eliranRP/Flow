import type { CSSProperties } from "react";

/**
 * FLOW-1138: the projects' and the property returns' skeletons, each in its content's own shape: grey
 * blocks that pulse (the shared .ui-skeleton-bar rule), the page busy, and one sr-only "טוען…" line.
 * The caller decides when to show one and waits 300ms first (ScreenState's SkeletonSwap, or DelayedSkeleton).
 */

type BarProps = { w: string; h: number; r?: number };

/** A block of `w` by `h` px; `r` is its corner radius in px when it is not the 6px default. */
function Bar({ w, h, r }: BarProps) {
  const style: CSSProperties = { inlineSize: w, blockSize: h, flex: "none", ...(r == null ? {} : { borderRadius: `${String(r)}px` }) };
  return <span aria-hidden="true" className="ui-skeleton-bar" style={style} />;
}

function Loading() {
  return (
    <p className="sr-only" role="status">
      טוען…
    </p>
  );
}

/** One line of a list: a 40px circle (none with `avatar` false), a name over a hint, and the figure at the end. */
function RowSkeleton({ first, second, avatar = true }: { first: string; second: string; avatar?: boolean }) {
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

const GROUPS = [3, 3] as const;

function Groups() {
  return (
    <>
      {GROUPS.map((count, group) => (
        <div className="ui-skel-group" key={group}>
          <Bar w={group === 0 ? "100px" : "120px"} h={16} />
          {Array.from({ length: count }, (_, line) => (
            <RowSkeleton key={line} first="58%" second="38%" />
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * A page's lines while they load, in their groups: a head, then rows with an avatar, a name, a hint and an
 * amount (the project page's month, a project's category). `status` false: the page already says it is loading.
 */
export function LineGroupsSkeleton({ status = true }: { status?: boolean }) {
  return (
    <div className="ui-state-skel" aria-busy="true">
      {status ? <Loading /> : null}
      <Groups />
    </div>
  );
}

/** שורות בלי פרויקט while they load: the figure, the note under it, then the lines by month. */
export function UnassignedSkeleton() {
  return (
    <div className="ui-state-skel" aria-busy="true">
      <Loading />
      <div className="ui-skel-lines-figure">
        <Bar w="150px" h={34} r={8} />
        <Bar w="85%" h={12} />
      </div>
      <Groups />
    </div>
  );
}

/** A calculation block (CalcSection) while it loads: its head, then `rows` rows of a name, a hint and a figure. */
function CalcSkeleton({ rows }: { rows: number }) {
  return (
    <section className="ui-ret-calc" aria-hidden="true">
      <div className="ui-ret-calc-head">
        <Bar w="80px" h={14} />
        <Bar w="56px" h={12} />
      </div>
      <ul className="ui-ret-formula">
        {Array.from({ length: rows }, (_, row) => (
          <li key={row}>
            <div className="ui-ret-row">
              <span className="ui-ret-text ui-ret-skel-text">
                <Bar w={row % 2 === 0 ? "46%" : "38%"} h={14} />
                <Bar w="28%" h={10} />
              </span>
              <Bar w="72px" h={16} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A returns page (the statement, a line, a metric, a part) while it loads: the hero's figure and line, then two blocks. */
export function ReturnsSkeleton() {
  return (
    <div className="ui-rep-content" aria-busy="true">
      <Loading />
      <div className="ui-ret-hero" aria-hidden="true">
        <Bar w="150px" h={40} r={8} />
        <Bar w="180px" h={14} />
      </div>
      <CalcSkeleton rows={4} />
      <CalcSkeleton rows={2} />
    </div>
  );
}

/**
 * The investment page's groups while they load (נתוני הנכס, the metrics' groups): a head, then rows of a name,
 * a hint and a figure, no avatar. Silent: the parts' card above says the page is loading (ReturnsCardsSkeleton).
 */
export function InvestmentGroupsSkeleton({ groups }: { groups: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: groups }, (_, group) => (
        <div className="ui-skel-group" key={group}>
          <Bar w={group % 2 === 0 ? "90px" : "120px"} h={16} />
          {[0, 1, 2].map((line) => (
            <RowSkeleton key={line} first="44%" second="60%" avatar={false} />
          ))}
        </div>
      ))}
    </div>
  );
}

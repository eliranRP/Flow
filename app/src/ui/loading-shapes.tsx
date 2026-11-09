import "./css/65-loading-shapes.css";
import { Fragment } from "react";
import { List, ListRow } from "./list-row";
import { Skeleton } from "./skeleton";

/**
 * FLOW-1137: loading states in the content's own shape, for the screens and sheets that drew a blank,
 * generic list rows or a placeholder value while their data loads. Each draws grey blocks only; the ones
 * that stand in for a whole screen or sheet say they are loading in one sr-only line. The caller decides
 * when to show one (ScreenState's SkeletonSwap, or DelayedSkeleton, waits 300ms first).
 */

function Loading() {
  return (
    <p className="sr-only" role="status">
      טוען…
    </p>
  );
}

/**
 * A form while its data or the user's role loads: a label bar over a control bar per field (the loan
 * form's `ui-loan-skel-field`). `figure` puts the line's figure on top, as the journal composer and the
 * line split open with the line's amount.
 */
export function FormSkeleton({ fields, figure = false }: { fields: number; figure?: boolean }) {
  return (
    <div className="ui-form-skel" aria-busy="true">
      <Loading />
      {figure ? (
        <div className="ui-form-skel-figure">
          <Skeleton width="md" />
          <Skeleton className="ui-form-skel-amount" />
        </div>
      ) : null}
      {Array.from({ length: fields }, (_, index) => (
        <div className="ui-loan-skel-field" key={index}>
          <Skeleton width="sm" />
          <Skeleton className="ui-loan-skel-control" />
        </div>
      ))}
    </div>
  );
}

/** A choice sheet's radio rows while its choices load, as the change picker draws them. */
export function RadioRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ui-radio-skel" aria-busy="true">
      <Loading />
      {Array.from({ length: rows }, (_, index) => (
        <div className="ui-radio-row" key={index} aria-hidden="true">
          <Skeleton width="md" />
        </div>
      ))}
    </div>
  );
}

/** A chip field's chips while its list loads: three 44px pills of different widths, in the chips' row. */
export function ChipsSkeleton() {
  return (
    <div className="ui-chips-skel" aria-hidden="true">
      <Skeleton className="ui-chip-skel ui-chip-skel-a" />
      <Skeleton className="ui-chip-skel ui-chip-skel-b" />
      <Skeleton className="ui-chip-skel ui-chip-skel-c" />
    </div>
  );
}

/** The + sheet while the user's role loads: its three tiles and its rows card, as blocks. */
export function TileMenuSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true">
      <Loading />
      <div className="ui-add-tiles" aria-hidden="true">
        <Skeleton className="ui-tile-skel" />
        <Skeleton className="ui-tile-skel" />
        <Skeleton className="ui-tile-skel" />
      </div>
      <div className="ui-add-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <ListRow variant="skeleton" key={index} end={false} />
        ))}
      </div>
    </div>
  );
}

/**
 * A settings-style page while it loads (Settings, חיבורים, קטגוריות, the AI connection): per group, a head
 * bar over an inset card of icon rows. `segment` puts the page's segmented control first (קטגוריות).
 */
export function GroupedSkeleton({ groups, segment = false }: { groups: readonly number[]; segment?: boolean }) {
  return (
    <div className="ui-settings-page ui-grouped-skel" aria-busy="true">
      <Loading />
      {segment ? <Skeleton className="ui-grouped-skel-segment" /> : null}
      {groups.map((rows, group) => (
        <Fragment key={group}>
          <div className="ui-settings-group-head" aria-hidden="true">
            <Skeleton className={group % 2 === 0 ? "ui-grouped-skel-head" : "ui-grouped-skel-head ui-grouped-skel-head-short"} />
          </div>
          <List layout="inset">
            {Array.from({ length: rows }, (_, row) => (
              <ListRow variant="skeleton" key={row} icon />
            ))}
          </List>
        </Fragment>
      ))}
    </div>
  );
}

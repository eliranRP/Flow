import { useElapsed } from "./skeleton";

/**
 * The pill waits this long, so a quick refresh shows only the line (FLOW-371, REDESIGN-PLAN §2.2 and
 * --motion-fade). The board's "syncing" preset draws the pill at once; the plan's decision wins.
 */
export const SYNC_PILL_DELAY_MS = 200;

/**
 * A background refresh (FLOW-371): a 3px indeterminate line at the top and, after 200ms, a pill with
 * a 16px spinner and the label. The content under it stays usable, so the strip takes no taps. The
 * label is in the text from the start, so a screen reader hears what syncs. Renders nothing when
 * `label` is null or empty.
 */
export function SyncStrip({ label }: { label: string | null }) {
  if (label == null || label === "") return null;
  return <SyncStripActive label={label} />;
}

/** Mounted only while a sync runs, so each sync starts its own 200ms wait. */
function SyncStripActive({ label }: { label: string }) {
  const pill = useElapsed(SYNC_PILL_DELAY_MS);
  return (
    <div className="ui-sync" role="status">
      <span className="ui-sync-line" aria-hidden="true" />
      {pill ? (
        <span className="ui-sync-pill">
          <span className="ui-sync-spin" aria-hidden="true" />
          {label}
        </span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}

/**
 * A background refresh (FLOW-371, board States "syncing"): a 3px indeterminate line at the top and a
 * pill with a 16px spinner and the label. The pill shows at once: the board draws it that way, so
 * the 200ms wait in the task file gives way. The content under it stays usable, so the strip takes
 * no taps. Renders nothing when `label` is null or empty.
 */
export function SyncStrip({ label }: { label: string | null }) {
  if (label == null || label === "") return null;
  return (
    <div className="ui-sync" role="status">
      <span className="ui-sync-line" aria-hidden="true" />
      <span className="ui-sync-pill">
        <span className="ui-sync-spin" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

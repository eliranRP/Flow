import type { ReactNode, RefObject } from "react";
import { LogoutIcon, RefreshIcon } from "./icons";
import { List, ListRow } from "./list-row";
import { Sheet } from "./sheet";

/**
 * A connected SUMIT or Mercury (FLOW-508): the sync line, the last failure, רענון עכשיו and ניתוק.
 * One block for both connectors, so their sheets stay the same.
 */
export function ConnectorStatusSheet({
  open,
  onOpenChange,
  title,
  returnFocusRef,
  detail,
  syncPhrase,
  failed,
  held,
  errorText,
  refreshHint,
  busy,
  onRefresh,
  onDisconnect,
  disconnectRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Beside "מחובר", e.g. SUMIT's company number. */
  detail?: ReactNode;
  syncPhrase: string | null;
  /** The last run failed for a reason other than the key (the key has its own reconnect sheet). */
  failed: boolean;
  /** Refresh waits for a retry time, shown in `refreshHint`. */
  held: boolean;
  errorText: string | null;
  refreshHint?: ReactNode;
  busy: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
  disconnectRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} returnFocusRef={returnFocusRef}>
      <div className="ui-stack">
        <p>
          מחובר
          {detail}
          {syncPhrase != null ? <><br /><span className="ui-nowrap">{syncPhrase}</span></> : null}
        </p>
        {failed && held ? <p>הרענון נכשל</p> : null}
        {failed && !held && errorText ? <p>{errorText}</p> : null}
      </div>
      <List>
        <ListRow
          variant="button"
          title={busy ? "מרענן…" : "רענון עכשיו"}
          hint={refreshHint}
          icon={<RefreshIcon />}
          chevron
          clearHint={held}
          describeHint={refreshHint != null}
          wrapHint
          busy={busy}
          disabled={held}
          onClick={() => {
            if (held || busy) return;
            onRefresh();
          }}
        />
      </List>
      {/* FLOW-335: ניתוק in its own group, a section away from where the thumb lands for רענון. */}
      <List className="ui-sheet-danger-group">
        <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={disconnectRef} onClick={onDisconnect} />
      </List>
    </Sheet>
  );
}

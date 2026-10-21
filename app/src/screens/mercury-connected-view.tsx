import type { ReactNode } from "react";
import { accountName, connectionName, newAccounts, syncedSummary, type MercuryAccount, type MercuryConnection } from "../mercury-connections";
import { Button } from "../ui/button";
import { ConnectionFacts } from "../ui/connection-page";
import { BankIcon, ChevronIcon } from "../ui/icons";

/**
 * A Mercury connection's page once it syncs (FLOW-938, the board's SettingsMercury, SettingsMercuryNewAccount
 * and SettingsMercuryMulti frames): the facts (no accounts or card rows any more), a tinted card when Mercury
 * lists an account no one answered yet, the synced accounts row, and the actions.
 */
export function MercuryConnectedView({
  connection,
  multi,
  readOnly,
  syncLine,
  imported,
  refreshing,
  answering,
  onAllConnections,
  onEditAccounts,
  onAnswer,
  onRefresh,
  onReplaceKey,
  onAdd,
  onDisconnect,
}: {
  connection: MercuryConnection;
  /** The company has more than one connection: the page links back to the list. */
  multi: boolean;
  /** A viewer or an editor sees the facts and nothing to change. */
  readOnly: boolean;
  syncLine: string | null;
  /** What has come in so far, already in words (a sample; live has no count). */
  imported?: string;
  refreshing: boolean;
  /** An answer to the new account is being saved. */
  answering: boolean;
  onAllConnections: () => void;
  onEditAccounts: () => void;
  onAnswer: (account: MercuryAccount, sync: boolean) => void;
  onRefresh: () => void;
  onReplaceKey: () => void;
  onAdd: () => void;
  onDisconnect: (event: { currentTarget: HTMLElement }) => void;
}) {
  const summary = syncedSummary(connection);
  const fresh = readOnly ? undefined : newAccounts(connection)[0];
  const facts: Array<{ label: string; value: ReactNode; ltr?: boolean }> = [
    { label: "מצב", value: "מחובר" },
    ...(connection.org != null ? [{ label: "ארגון ב־Mercury", value: connection.org, ltr: true }] : []),
    { label: "עדכון אחרון", value: syncLine ?? "—" },
    ...(imported != null ? [{ label: "נכנסו עד היום", value: imported }] : []),
  ];
  const syncedRow = (
    <>
      <BankIcon size={22} />
      <span className="ui-merc-row-text">
        <span className="ui-merc-row-title">חשבונות מסונכרנים</span>
        <bdi dir="ltr" className="ui-merc-row-sub ui-merc-row-names">{summary.names}</bdi>
      </span>
      <span className="ui-merc-row-value">{summary.count}</span>
    </>
  );
  return (
    <>
      {multi ? (
        <Button variant="link" className="ui-merc-all" onClick={onAllConnections}>כל חיבורי Mercury</Button>
      ) : null}
      <div className="ui-settings-card ui-connection-card">
        <ConnectionFacts rows={facts} />
      </div>
      {fresh != null ? (
        <div className="ui-merc-new" role="status">
          <p>ב־Mercury נפתח חשבון חדש: <bdi dir="ltr">{accountName(fresh)}</bdi>. לסנכרן אותו ל־Flow?</p>
          <div className="ui-merc-new-actions">
            <Button busy={answering} onClick={() => { onAnswer(fresh, true); }}>כן, לסנכרן</Button>
            <Button variant="secondary" disabled={answering} onClick={() => { onAnswer(fresh, false); }}>לא</Button>
          </div>
        </div>
      ) : null}
      {readOnly ? (
        <div className="ui-settings-card ui-merc-row" aria-label={`חשבונות מסונכרנים: ${summary.count}`}>{syncedRow}</div>
      ) : (
        <button type="button" className="ui-settings-card ui-merc-row m-press" onClick={onEditAccounts} aria-label={`חשבונות מסונכרנים: ${summary.count}, ${connectionName(connection)}`}>
          {syncedRow}
          <ChevronIcon size={18} />
        </button>
      )}
      {readOnly ? null : (
        <div className="ui-connection-actions">
          <Button variant="secondary" busy={refreshing} onClick={onRefresh}>רענון עכשיו</Button>
          <Button variant="link" onClick={onReplaceKey}>החלפת מפתח API</Button>
          {multi ? null : <Button variant="link" onClick={onAdd}>+ חיבור Mercury נוסף</Button>}
          <Button variant="danger-link" onClick={onDisconnect}>{multi ? "ניתוק החיבור הזה" : "ניתוק"}</Button>
        </div>
      )}
    </>
  );
}

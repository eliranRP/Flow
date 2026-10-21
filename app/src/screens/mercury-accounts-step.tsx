import { useState } from "react";
import {
  ADDED_HINT,
  DROPPED_HINT,
  TREASURY_HINT,
  accountName,
  accountNote,
  balanceText,
  defaultSelection,
  fromRow,
  fromValue,
  syncButtonLabel,
  type FromChoice,
  type MercuryConnection,
} from "../mercury-connections";
import { Button } from "../ui/button";
import { cx } from "../ui/cx";
import { importFromDefault } from "../ui/import-from-field";
import { CalendarIcon, CheckIcon, ChevronIcon } from "../ui/icons";
import { ConnectionNote } from "../ui/connection-page";
import { MercuryFromSheet } from "./mercury-from-sheet";

export type MercuryAccountsPick = { accounts: string[]; from: string | null };

/** The line under the list: what checking an account means (the board's words). */
export const ACCOUNTS_NOTE = "רק חשבונות מסומנים נכנסים לתזרים, לרווח ולהתראות. העברה בין שני חשבונות מסומנים לא נספרת; העברה לחשבון שלא מסומן נספרת כ״יצא״. אפשר לשנות מתי שרוצים בהגדרות › Mercury.";

/**
 * Step 3 of a Mercury connection, and the synced accounts list (FLOW-938, the board's SettingsMercuryPick
 * and SettingsMercuryAccounts): a checkbox row per account, בחירת כולם / ניקוי הבחירה, the date row
 * (on connect, and on the list once a new account is checked), the line on what it means, and the
 * primary button.
 */
export function MercuryAccountsStep({
  connection,
  editing,
  busy,
  onSave,
  onBack,
  initialFrom = "start",
  initialFromOpen = false,
  initialSelected,
}: {
  connection: MercuryConnection;
  editing: boolean;
  busy: boolean;
  onSave: (pick: MercuryAccountsPick) => void;
  onBack: () => void;
  /** Stories and the board frames open on a choice, or with the sheet up. */
  initialFrom?: FromChoice;
  initialFromOpen?: boolean;
  /** A board frame's checks (the edit list with one account unchecked and one checked). */
  initialSelected?: readonly string[];
}) {
  const accounts = connection.accounts;
  const [selected, setSelected] = useState<string[]>(() => initialSelected != null ? [...initialSelected] : (editing ? connection.synced.filter((id) => accounts.some((account) => account.id === id)) : defaultSelection(accounts)));
  // A new account added on the list starts today unless the owner picks more history.
  const [choice, setChoice] = useState<FromChoice>(editing ? "today" : initialFrom);
  const [date, setDate] = useState(() => importFromDefault());
  const [sheetOpen, setSheetOpen] = useState(initialFromOpen);
  const on = (id: string) => selected.includes(id);
  const toggle = (id: string) => { setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id])); };
  const all = selected.length === accounts.length;
  const added = editing ? selected.filter((id) => !connection.synced.includes(id)) : selected;
  const showFrom = !editing || added.length > 0;
  const row = fromRow(choice, date);
  const save = () => {
    if (busy || selected.length === 0) return;
    onSave({ accounts: selected, from: showFrom ? fromValue(choice, date) : null });
  };
  return (
    <>
      <div className="ui-merc-step-head">
        <h2 className="ui-merc-step-title">{editing ? "חשבונות מסונכרנים" : "3 · אילו חשבונות לסנכרן, ומאיזה תאריך"}</h2>
        <p className="ui-merc-step-lead">{editing ? "סמנו את החשבונות שנכנסים ל־Flow." : `Flow מצא ${String(accounts.length)} חשבונות ב־Mercury. סמנו את אלה של העסק.`}</p>
      </div>
      <div role="group" aria-label="חשבונות" className="ui-settings-card ui-merc-accounts">
        {accounts.map((account) => {
          const checked = on(account.id);
          const dropped = editing && connection.synced.includes(account.id) && !checked;
          const fresh = editing && !connection.synced.includes(account.id) && checked;
          const hint = dropped ? DROPPED_HINT : fresh ? ADDED_HINT : account.kind === "treasury" && !checked ? TREASURY_HINT : null;
          return (
            <button
              key={account.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              disabled={busy}
              className="ui-merc-account m-press"
              onClick={() => { toggle(account.id); }}
            >
              <span className="ui-merc-check" data-on={checked ? "true" : "false"} aria-hidden="true">
                {checked ? <CheckIcon size={14} /> : null}
              </span>
              <span className="ui-merc-account-text">
                <bdi dir="ltr" className="ui-merc-account-name">{accountName(account)}</bdi>
                <span className="ui-merc-account-note">{accountNote(account)}</span>
                {hint != null ? <span className={cx("ui-merc-account-hint", dropped && "ui-merc-hint-dropped", fresh && "ui-merc-hint-added")}>{hint}</span> : null}
              </span>
              <bdi dir="ltr" className="ui-merc-balance ui-num" data-on={checked ? "true" : "false"}>{balanceText(account.balanceCents)}</bdi>
            </button>
          );
        })}
      </div>
      <Button variant="link" onClick={() => { setSelected(all ? [] : accounts.map((account) => account.id)); }}>
        {all ? "ניקוי הבחירה" : "בחירת כולם"}
      </Button>
      {showFrom ? (
        <button type="button" className="ui-settings-card ui-merc-row m-press" aria-haspopup="dialog" disabled={busy} onClick={() => { setSheetOpen(true); }}>
          <CalendarIcon size={22} />
          <span className="ui-merc-row-text">
            <span className="ui-merc-row-title">{editing ? "מאיזה תאריך לייבא לחשבון החדש" : "מאיזה תאריך לייבא"}</span>
            <span className="ui-merc-row-sub">{row.note}</span>
          </span>
          <span className="ui-merc-row-value">{row.label}</span>
          <ChevronIcon size={18} />
        </button>
      ) : null}
      <ConnectionNote>{ACCOUNTS_NOTE}</ConnectionNote>
      <Button busy={busy} disabled={selected.length === 0} onClick={save}>
        {busy ? "שומר…" : syncButtonLabel(selected.length, editing)}
      </Button>
      <Button variant="link" onClick={onBack}>{editing ? "ביטול" : "חזרה למפתח"}</Button>
      <MercuryFromSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editing}
        choice={choice}
        date={date}
        onChoose={(next, day) => { setChoice(next); setDate(day); }}
      />
    </>
  );
}

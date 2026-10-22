import { formatAmountText } from "@flow/shared";
import { useId, type ReactNode, type Ref } from "react";
import { ACCOUNT_GROUPS, type ComposerAccount, type ComposerHold, type ComposerSide } from "../line-composer";
import { useSheetHistory } from "./back";
import { Picker } from "./change-picker";
import type { ChangeChoice } from "./change-sheet-copy";
import { CardIcon, CheckIcon, ChevronDownIcon } from "./icons";
import { AccountName } from "./journal-card";
import { ListRow } from "./list-row";
import { MoneyField } from "./money-field";
import { Sheet } from "./sheet";
import "./css/56-journal-composer.css";

/**
 * FLOW-955 (board LedgerComposer, LedgerComposerTemplates). The parts of the journal entry composer,
 * פקודת יומן: where it starts, the balance line, the bank line that does not change (שורה 1), each
 * editable line (account, project, amount, חובה|זכות), "+ שורה נוספת", the account picker and the
 * "כמו תנועה קודמת" sheet. The screen (journal-composer-screen.tsx) holds the state.
 */

function money(minor: bigint, currency: string): string {
  return formatAmountText(minor, currency, { detail: true });
}

export type ComposerStartKind = "jev" | "copy" | "free";

/**
 * "✦ הצעה של Jev" | "כמו תנועה קודמת": a radio pair (the segment style). A start with nothing behind
 * it is drawn disabled; with neither, the pair is left out. Under it, the note on where the entry
 * came from and, unless it is already free, "התחלה מאפס".
 */
export function ComposerStart({
  value,
  jev,
  copy,
  note,
  onJev,
  onCopy,
  onClear,
  disabled = false,
}: {
  value: ComposerStartKind;
  /** Jev has a suggestion for this line. */
  jev: boolean;
  /** The party has booked lines to copy. */
  copy: boolean;
  note: string;
  onJev: () => void;
  onCopy: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      {jev || copy ? (
        <div className="ui-seg ui-jc-start" role="radiogroup" aria-label="התחלה">
          <button type="button" className="ui-seg-btn" role="radio" aria-checked={value === "jev"} disabled={disabled || !jev} onClick={onJev}>
            <span className="ui-seg-label" data-clip-ok=""><span className="ui-jc-spark" aria-hidden="true">✦ </span>הצעה של Jev</span>
          </button>
          <button type="button" className="ui-seg-btn" role="radio" aria-checked={value === "copy"} disabled={disabled || !copy} onClick={onCopy}>
            <span className="ui-seg-label" data-clip-ok="">כמו תנועה קודמת</span>
          </button>
        </div>
      ) : null}
      <div className="ui-jc-note-row">
        <span className="ui-jc-note">{note}</span>
        {value !== "free" ? (
          <button type="button" className="ui-jc-clear" disabled={disabled} onClick={onClear}>התחלה מאפס</button>
        ) : null}
      </div>
    </>
  );
}

/** The live balance: "מאוזן · $X בחובה ובזכות", or what is missing, on which side. */
export function ComposerStatus({ hold, currency }: { hold: ComposerHold; currency: string }) {
  const ok = hold.kind === "balanced";
  return (
    <p className="ui-jc-status" role="status" data-ok={ok ? "" : undefined}>
      {ok ? <CheckIcon size={16} /> : null}
      {hold.kind === "balanced" ? (
        <span>
          {"מאוזן · "}
          <bdi className="ui-num" dir="ltr">{money(hold.total, currency)}</bdi>
          {" בחובה ובזכות"}
        </span>
      ) : hold.kind === "short" ? (
        <span>
          {"חסרים "}
          <bdi className="ui-num" dir="ltr">{money(hold.minor, currency)}</bdi>
          {hold.side === "debit" ? " בחובה" : " בזכות"}
        </span>
      ) : hold.kind === "single" ? (
        <span>צריך לפחות 2 שורות מלבד הבנק</span>
      ) : (
        <span>בחרו חשבון וסכום לכל שורה</span>
      )}
    </p>
  );
}

/** שורה 1: the bank account the line moved through, its side and amount. Read only. */
export function ComposerBankLeg({ name, side, amount, currency }: { name: string; side: ComposerSide; amount: bigint; currency: string }) {
  return (
    <section className="ui-jc-card ui-jc-bank" aria-label="שורה 1, מהתנועה">
      <span className="ui-jc-bank-icon" aria-hidden="true"><CardIcon size={22} /></span>
      <span className="ui-jc-bank-text">
        <span className="ui-jc-label">שורה 1 · מהתנועה, לא משתנה</span>
        <AccountName name={name} />
        <span className="ui-jc-label">{`בנק · ${side === "debit" ? "חובה" : "זכות"}`}</span>
      </span>
      <bdi className="ui-num ui-jc-bank-amount" dir="ltr">{money(amount, currency)}</bdi>
    </section>
  );
}

/** A picker button: the value (or a muted placeholder) and a chevron. */
function PickButton({ label, value, placeholder, disabled, onOpen, buttonRef }: {
  label: string;
  value: string | null;
  placeholder: string;
  disabled: boolean;
  onOpen: (opener: HTMLButtonElement) => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="ui-jc-pick"
      data-empty={value == null ? "" : undefined}
      aria-label={`${value ?? placeholder}, ${label}, שינוי`}
      disabled={disabled}
      onClick={(event) => { onOpen(event.currentTarget); }}
    >
      <span className="ui-jc-pick-value" data-clip-ok="">{value ?? placeholder}</span>
      <ChevronDownIcon size={16} />
    </button>
  );
}

/** One editable line: its number, הסרה, the account and project pickers, the amount with חובה|זכות, and its note. */
export function ComposerLegCard({
  index,
  account,
  project,
  amount,
  side,
  note,
  disabled = false,
  onAccount,
  onProject,
  onAmount,
  onSide,
  onRemove,
}: {
  /** The line's number on screen; the bank line is 1. */
  index: number;
  account: string | null;
  project: string | null;
  amount: string;
  side: ComposerSide;
  note: ReactNode;
  disabled?: boolean;
  onAccount: (opener: HTMLButtonElement) => void;
  onProject: (opener: HTMLButtonElement) => void;
  onAmount: (value: string) => void;
  onSide: (side: ComposerSide) => void;
  onRemove: () => void;
}) {
  const label = `שורה ${String(index)}`;
  const noteId = useId();
  return (
    <section className="ui-jc-card ui-jc-leg m-page-enter" aria-label={label}>
      <div className="ui-jc-leg-head">
        <span className="ui-jc-label">{label}</span>
        <button type="button" className="ui-jc-remove" aria-label={`הסרת ${label}${account != null ? `, ${account}` : ""}`} disabled={disabled} onClick={onRemove}>הסרה</button>
      </div>
      <div className="ui-jc-picks">
        <PickButton label="חשבון" value={account} placeholder="בחירת חשבון" disabled={disabled} onOpen={onAccount} />
        <PickButton label="פרויקט" value={project} placeholder="בלי פרויקט" disabled={disabled} onOpen={onProject} />
      </div>
      <div className="ui-jc-amount">
        <MoneyField
          hideLabel
          label={`סכום, ${account ?? label}`}
          prefix=""
          placeholder="0"
          value={amount}
          disabled={disabled}
          describedBy={noteId}
          onValueChange={onAmount}
          trailing={(
            <span className="ui-jc-side" role="radiogroup" aria-label="צד בפקודה">
              {(["debit", "credit"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={side === value} disabled={disabled} onClick={() => { onSide(value); }}>
                  {value === "debit" ? "חובה" : "זכות"}
                </button>
              ))}
            </span>
          )}
        />
      </div>
      <p className="ui-jc-label ui-jc-leg-note" id={noteId}>{note}</p>
    </section>
  );
}

/** "+ שורה נוספת": a dashed full-width button. */
export function ComposerAddLeg({ onAdd, disabled = false }: { onAdd: () => void; disabled?: boolean }) {
  return <button type="button" className="ui-jc-add" disabled={disabled} onClick={onAdd}>+ שורה נוספת</button>;
}

/** The account picker: the bookable accounts under their type's heading, the chosen one checked. */
export function AccountPickSheet({
  open,
  onOpenChange,
  title,
  accounts,
  selectedId,
  onPick,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  accounts: readonly ComposerAccount[];
  selectedId: string | null;
  onPick: (id: string) => void;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const headId = useId();
  // Its own history entry, so Back (and the iOS swipe) closes the sheet, not the composer.
  const setOpen = useSheetHistory("journal-account", open, onOpenChange);
  return (
    <Sheet open={open} onOpenChange={(next) => { setOpen(next); }} title={title} returnFocusRef={returnFocusRef} panelClassName="ui-sheet-choice">
      <div className="ui-change-picker ui-choice-sheet" role="radiogroup" aria-label={title}>
        {ACCOUNT_GROUPS.map(({ group, heading }) => {
          const listed = accounts.filter((account) => account.group === group);
          if (listed.length === 0) return null;
          return (
            <div key={group} className="ui-pick-group" role="group" aria-labelledby={`${headId}-${group}`}>
              <p className="t-line2 ui-pick-group-head" id={`${headId}-${group}`}>{heading}</p>
              {listed.map((account) => (
                <ListRow
                  control="radio"
                  key={account.id}
                  layout="picker"
                  title={account.name}
                  description={account.inPnl ? undefined : "לא נספר ברווח"}
                  selected={account.id === selectedId}
                  onSelect={() => { onPick(account.id); setOpen(false); }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** A line's project: בלי פרויקט first, then the company's projects (by group when it has groups). */
export function ProjectPickSheet({
  open,
  onOpenChange,
  title,
  projects,
  selectedId,
  onPick,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  projects: ChangeChoice[];
  selectedId: string | null;
  /** null is בלי פרויקט. */
  onPick: (id: string | null) => void;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const setOpen = useSheetHistory("journal-project", open, onOpenChange);
  return (
    <Sheet open={open} onOpenChange={(next) => { setOpen(next); }} title={title} returnFocusRef={returnFocusRef} panelClassName="ui-sheet-choice">
      <Picker
        kind="project"
        searchable={false}
        query=""
        onQuery={() => undefined}
        loading={false}
        listed={projects}
        selectedId={selectedId ?? ""}
        suggestionId=""
        savingId={null}
        noneLabel="בלי פרויקט"
        compact
        splitLink={false}
        onSelect={(id) => { onPick(id === "" ? null : id); setOpen(false); }}
      />
    </Sheet>
  );
}

export type CopyOption = {
  id: string;
  /** "Kiavi Funding · 02/08". */
  title: string;
  /** Formatted, signed as the line moved ("+$150,000"). */
  amount: string;
  /** The line counts as income: its amount is green. */
  income: boolean;
  /** "name $amount" pairs, each kept on one line. */
  debit: readonly string[];
  credit: readonly string[];
};

function Pairs({ title, pairs }: { title: string; pairs: readonly string[] }) {
  return (
    <span className="ui-jc-label">
      {`${title}: `}
      {pairs.map((pair, index) => (
        <span key={pair}>
          {index > 0 ? " · " : null}
          <span className="ui-jc-pair">{pair}</span>
        </span>
      ))}
    </span>
  );
}

/** כמו תנועה קודמת: the party's booked lines, each with its חובה and זכות; a pick copies it, scaled. */
export function CopySheet({
  open,
  onOpenChange,
  party,
  options,
  selectedId,
  onPick,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: string;
  options: readonly CopyOption[];
  selectedId: string | null;
  onPick: (id: string) => void;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const setOpen = useSheetHistory("journal-copy", open, onOpenChange);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { setOpen(next); }}
      title="כמו תנועה קודמת"
      subtitle={`תנועות של ${party} שכבר נרשמו. הפקודה מועתקת, והסכומים מותאמים לתנועה הזו.`}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-choice"
    >
      <div className="ui-jc-copies" role="radiogroup" aria-label="תנועה להעתקה">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="ui-jc-copy"
            role="radio"
            aria-checked={option.id === selectedId}
            onClick={() => { onPick(option.id); setOpen(false); }}
          >
            <span className="ui-jc-copy-text">
              <span className="ui-jc-copy-head">
                <span className="ui-jc-copy-title" data-clip-ok="">{option.title}</span>
                <bdi className={option.income ? "ui-num ui-income" : "ui-num"} dir="ltr">{option.amount}</bdi>
              </span>
              <Pairs title="חובה" pairs={option.debit} />
              <Pairs title="זכות" pairs={option.credit} />
            </span>
            <span className="ui-radio" data-on={option.id === selectedId ? "true" : "false"} aria-hidden="true">
              {option.id === selectedId ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

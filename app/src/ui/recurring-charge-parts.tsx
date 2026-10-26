import { ChevronIcon, PencilIcon, ProjectsIcon, RepeatIcon, TagIcon } from "./icons";
import { IconRow } from "./icon-row";
import { cx } from "./cx";
import { PACE_LABEL } from "./pace";
import type { RecurringPace } from "@flow/shared";
import "./css/48-recurring-charge.css";
import "./css/49-recurring-answers.css";

/**
 * FLOW-447c: the charge page's pieces, as the board draws them (RecurringItem, RecurringLate). The
 * screen decides what they show; these only draw it.
 */

/** The header: the status line, the name, the amount and its line. */
export function ChargeHead({
  headRef,
  status,
  statusBad,
  name,
  amount,
  muted,
  income,
  meta,
}: {
  /** The page's top bar takes its line once this head is under it (TransactionTopBar). */
  headRef?: (node: HTMLElement | null) => void;
  status: string;
  statusBad: boolean;
  name: string;
  amount: string;
  /** The usual amount of a bill not paid yet: grey. */
  muted: boolean;
  /** An arrived income: the income green and a "+". */
  income: boolean;
  meta: string;
}) {
  return (
    <header ref={headRef} className="ui-charge-head">
      <p className={cx("ui-charge-status", statusBad && "ui-charge-status-bad")}>{status}</p>
      <h1 className="ui-charge-name">{name}</h1>
      <p className={cx("ui-charge-amount", muted && "ui-charge-amount-muted", income && "ui-charge-amount-income")} dir="ltr">
        {amount}
      </p>
      <p className="ui-charge-meta">{meta}</p>
    </header>
  );
}

/** The alert banner: its words and the "התעלמות" action at the end. */
export function ChargeBanner({ text, onIgnore, disabled }: { text: string; onIgnore: () => void; disabled: boolean }) {
  return (
    <div className="ui-charge-banner" role="status">
      <span className="ui-charge-banner-text">{text}</span>
      <button type="button" className="ui-charge-banner-action ui-hit" onClick={onIgnore} disabled={disabled}>
        התעלמות
      </button>
    </div>
  );
}

/** After an ignore: the grey line and "החזרה", which brings the alert back. */
export function ChargeIgnored({ text, onRestore, disabled }: { text: string; onRestore: () => void; disabled: boolean }) {
  return (
    <div className="ui-charge-ignored">
      <span className="ui-charge-ignored-text">{text}</span>
      <button type="button" className="ui-charge-ignored-action ui-hit" onClick={onRestore} disabled={disabled}>
        החזרה
      </button>
    </div>
  );
}

/**
 * The project and category rows. FLOW-963: each opens its picker, which moves every payment of the charge;
 * with no handler (a viewer) they are read-only facts.
 */
export function ChargeCard({ project, category, onProject, onCategory, busy = false }: {
  project: string;
  category: string;
  onProject?: () => void;
  onCategory?: () => void;
  busy?: boolean;
}) {
  return (
    <section className="ui-card ui-charge-card" aria-label="פרויקט וקטגוריה">
      {onProject == null ? (
        <IconRow icon={<ProjectsIcon />} label="פרויקט" value={project} className="ui-charge-row" />
      ) : (
        <IconRow icon={<ProjectsIcon />} label="פרויקט" value={project} className="ui-charge-row" busy={busy} onClick={onProject} />
      )}
      {onCategory == null ? (
        <IconRow icon={<TagIcon />} label="קטגוריה" value={category} className="ui-charge-row" />
      ) : (
        <IconRow icon={<TagIcon />} label="קטגוריה" value={category} className="ui-charge-row" busy={busy} onClick={onCategory} />
      )}
    </section>
  );
}

/** The recurring row: the kind, its usual day and whether it was set or found, and the pace; it opens the pace sheet. */
export function RecurringRow({
  title,
  sub,
  pace,
  onOpen,
  disabled,
}: {
  title: string;
  sub: string;
  pace: RecurringPace;
  onOpen: () => void;
  disabled: boolean;
}) {
  return (
    <button type="button" className="ui-charge-rec ui-hit m-press" onClick={onOpen} disabled={disabled}>
      <span className="ui-charge-rec-icon" aria-hidden="true">
        <RepeatIcon />
      </span>
      <span className="ui-charge-rec-text">
        <span className="ui-charge-rec-title">{title}</span>
        <span className="ui-charge-rec-sub">{sub}</span>
      </span>
      <span className="ui-charge-rec-tag">{PACE_LABEL[pace]}</span>
      <span className="ui-charge-rec-end" aria-hidden="true">
        <ChevronIcon size={18} />
      </span>
    </button>
  );
}

/** Decision 0189: the usual amount row. "קבעת" when the owner set it; it opens the amount sheet. */
export function UsualAmountRow({
  amount,
  owner,
  onOpen,
  disabled,
  buttonRef,
}: {
  amount: string;
  owner: boolean;
  onOpen: () => void;
  disabled: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={buttonRef} type="button" className="ui-charge-rec ui-hit m-press" onClick={onOpen} disabled={disabled}>
      <span className="ui-charge-rec-icon" aria-hidden="true">
        <PencilIcon />
      </span>
      <span className="ui-charge-rec-text">
        <span className="ui-charge-rec-title">הסכום הרגיל</span>
        <span className="ui-charge-rec-sub">{owner ? "קבעת" : "לפי החודשים האחרונים"}</span>
      </span>
      <span className="ui-charge-rec-tag" dir="ltr">{amount}</span>
      <span className="ui-charge-rec-end" aria-hidden="true">
        <ChevronIcon size={18} />
      </span>
    </button>
  );
}

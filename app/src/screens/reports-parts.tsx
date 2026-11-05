import { formatAmountText } from "@flow/shared";
import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { balanceWarning, type BalanceCurrency } from "../reports";
import type { NetRow, ViewGroup, ViewRow } from "../report-views";
import { Amount } from "../ui/amount";
import { BackButton, useGoBack } from "../ui/back";
import { BandLoadFailed, BandOfflineLine } from "../ui/band-states";
import { CompactBar } from "../ui/compact-bar";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { FocusTitle } from "../ui/focus-title";
import { GroupHead } from "../ui/group-head";
import { IconButton } from "../ui/icon-button";
import { AlertIcon, BackIcon, CheckIcon, ChevronDownIcon, ChevronIcon, ShareIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Skeleton } from "../ui/skeleton";
import { slashBreaks } from "../ui/slash-breaks";
import { TopBand, useBandGone } from "../ui/top-band";

/**
 * FLOW-161: the reports' older parts that other pages still compose (a collapsible section, a row, a total
 * and the summary figure: the lines and account pages, the returns pages). FLOW-1045: the v3 report's shell
 * (the band, its compact bar and the docking view control) and its list parts.
 */

export type Collapse = { isOpen: (id: string) => boolean; onToggle: (id: string) => void };

/** A section's head: the chevron turns, the title, and the total that stays in view when it is closed. */
export function ReportSection({ id, title, total, collapse, children, tone = "section", fixed = false }: {
  id: string;
  title: string;
  total: ReactNode;
  collapse: Collapse;
  children: ReactNode;
  /** A parent category inside a section is a step smaller. */
  tone?: "section" | "group";
  /** A section of one row does not fold: its head is a plain line (FLOW-457). */
  fixed?: boolean;
}) {
  const bodyId = useId();
  const open = collapse.isOpen(id);
  if (fixed) {
    return (
      <section className={tone === "section" ? "ui-rep-section" : "ui-rep-group"} aria-label={title}>
        <div className="ui-rep-head ui-rep-head-fixed">
          <span className="ui-rep-chevron-space" aria-hidden="true" />
          <span className="ui-rep-head-title" dir="auto">{title}</span>
          <span className="ui-rep-head-total">{total}</span>
        </div>
        <div className="ui-rep-body">{children}</div>
      </section>
    );
  }
  return (
    <section className={tone === "section" ? "ui-rep-section" : "ui-rep-group"} aria-label={title}>
      <button type="button" className="ui-rep-head" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => { collapse.onToggle(id); }}>
        <span className="ui-chevron-turn ui-rep-chevron" data-open={open ? "true" : "false"} aria-hidden="true">
          <ChevronDownIcon size={16} />
        </span>
        <span className="ui-rep-head-title" dir="auto">{title}</span>
        <span className="ui-rep-head-total">{total}</span>
      </button>
      {open ? <div id={bodyId} className="ui-rep-body">{children}</div> : null}
    </section>
  );
}

/** One row: a name and an amount, a link when it opens its lines. */
export function ReportRow({ name, meta, amount, href }: { name: string; meta?: string; amount: ReactNode; href?: string }) {
  const content = (
    <>
      <span className="ui-rep-row-text">
        <span className="ui-rep-row-name" dir="auto">{slashBreaks(name)}</span>
        {meta ? <span className="ui-rep-row-meta">{meta}</span> : null}
      </span>
      <span className="ui-rep-row-amount">{amount}</span>
      {href != null ? <span className="ui-rep-row-go" aria-hidden="true"><ChevronIcon size={16} /></span> : null}
    </>
  );
  return <li className="ui-rep-row">{href != null ? <Link className="ui-rep-row-link m-press" to={href}>{content}</Link> : <div className="ui-rep-row-link">{content}</div>}</li>;
}

/** A bold line under a section: a subtotal, or the bottom line in `strong`. */
export function ReportTotal({ label, amount, strong = false }: { label: string; amount: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "ui-rep-total ui-rep-total-strong" : "ui-rep-total"}>
      <span>{label}</span>
      <span className="ui-rep-total-amount">{amount}</span>
    </div>
  );
}

/** The number that leads a page: capped at the total step (rule tables § 19). */
export function ReportSummary({ label, amount, currency, sub, ok = false, loss = amount < 0n }: {
  label: string;
  amount: bigint;
  currency: string;
  sub: string;
  ok?: boolean;
  /** A net below zero is a loss; a side's total (the drill-down's expenses) is not. */
  loss?: boolean;
}) {
  return (
    <div className="ui-rep-summary">
      <span className="ui-rep-summary-label">{label}</span>
      <p className="ui-rep-summary-figure">
        <Amount agorot={amount} currency={currency} size="total" loss={loss} />
      </p>
      <span className="ui-rep-summary-sub">
        {ok ? <span className="ui-rep-ok" aria-hidden="true"><CheckIcon size={16} /></span> : null}
        {sub}
      </span>
    </div>
  );
}

// ---- FLOW-1045: the v3 report ---------------------------------------------------------------------

/** The band bar's height (BUILD-PLAN §3.1: 6 + 52 + 6). */
const BAND_BAR = 64;

/** Back on a report: to the hub, or out of a drill-down to the view it came from ("‹ לפי פרויקט"). */
export type ReportBack = { kind: "hub"; to: string } | { kind: "undrill"; label: string; onBack: () => void };

export type BandFigure = { amount: bigint; currency: string; loss: boolean };

/** One of the two rows under the band's figure: income and expenses, or assets and liabilities. */
export type BandRow = { label: string; amount: bigint; income?: boolean };

/** A figure as text, for the bar and the group heads: LTR, the minus U+2212 (formatAmountText). */
export function amountText(amount: bigint, currency: string, signed = false): string {
  return formatAmountText(amount, currency, signed ? { direction: amount < 0n ? "expense" : "income", plus: amount > 0n } : undefined);
}

function UndrillButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button type="button" className="ui-back-labelled ui-rep-undrill m-press" aria-label={`חזרה ל${label}`} onClick={onBack}>
      <BackIcon />
      <span className="ui-back-text" data-clip-ok="">{label}</span>
    </button>
  );
}

/**
 * FLOW-1045 (board V3-Report, the Overview pattern): the report's violet band (the name, the period or date
 * pill that opens its sheet, the figure and its two rows), the band bar that slides in once the figures fade
 * (Back, the name and figure, share), and the view control that docks into that bar. `control(onBand)` draws
 * the same SegmentedControl in the page and in the bar; none in a drill-down. `top` sits above the control
 * (the attention card, the drill-down's way on), the children under it.
 */
export function ReportShell({ name, back, pill, figureLabel, figure, figureSub, rows, onShare, control, offlineSince, failed, top, children }: {
  name: string;
  back: ReportBack;
  pill: { label: string; onOpen: () => void };
  figureLabel: string;
  /** Null while the read is in: a band skeleton. */
  figure: BandFigure | null;
  figureSub?: string;
  rows: readonly BandRow[];
  onShare?: (() => void) | null;
  control?: ((onBand: boolean, scrollUnderBar: () => void) => ReactNode) | null;
  offlineSince?: number | null;
  /** The read failed: the band says so with its retry (V3-States), and the page shows nothing under it. */
  failed?: { offline: boolean; onRetry: () => void } | null;
  top?: ReactNode;
  children?: ReactNode;
}) {
  const goBack = useGoBack();
  const barShown = useBandGone();
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown, bar: BAND_BAR });
  const leading = back.kind === "hub" ? <BackButton fallback={back.to} text="דוחות" onBand /> : <UndrillButton label={back.label} onBack={back.onBack} />;
  const share = onShare == null ? null : <IconButton label="שיתוף הדוח" onBand onClick={onShare}><ShareIcon size={22} /></IconButton>;
  if (failed != null) {
    return (
      <div className="ui-rep-v3">
        <BandLoadFailed title="הדוח לא נטען" offline={failed.offline} onRetry={failed.onRetry} leading={leading} />
      </div>
    );
  }
  const currency = figure?.currency ?? "ILS";
  return (
    <div className="ui-rep-v3">
      <TopBand
        wordmark={false}
        leading={leading}
        trailing={share}
        hero={
          <div className="ui-rep-band ui-band-fade">
            <FocusTitle className="t-name ui-rep-band-name">{name}</FocusTitle>
            {offlineSince == null ? null : <BandOfflineLine since={offlineSince} />}
            <button type="button" className="ui-rep-pill m-press" aria-haspopup="dialog" onClick={pill.onOpen}>
              <span className="ui-rep-pill-label">{pill.label}</span>
              <ChevronDownIcon size={14} />
            </button>
            <div className="ui-rep-band-figure">
              <p className="ui-band-title">{figureLabel}</p>
              {figure == null ? (
                <Skeleton tone="band" hero />
              ) : (
                <p className="ui-band-net">
                  <Amount agorot={figure.amount} currency={figure.currency} loss={figure.loss} size="hero" compact />
                </p>
              )}
              {figureSub == null ? null : <p className="ui-rep-band-sub t-line2">{figureSub}</p>}
            </div>
            {figure == null ? null : (
              <div className="ui-rep-band-rows">
                {rows.map((row) => (
                  <p key={row.label} className="ui-rep-band-row">
                    <span>{row.label}</span>
                    <span className="ui-rep-band-row-amount">
                      <Amount agorot={row.amount} currency={currency} size="list" income={row.income === true} />
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        }
      />
      <CompactBar
        title=""
        shown={barShown}
        tone="band"
        start={
          <IconButton label={back.kind === "hub" ? "חזרה לדוחות" : `חזרה ל${back.label}`} onBand onClick={() => { if (back.kind === "hub") goBack(back.to); else back.onBack(); }}>
            <BackIcon />
          </IconButton>
        }
        centre={
          <button type="button" className="ui-compact-bar-centre m-press" aria-haspopup="dialog" onClick={pill.onOpen}>
            <span className="ui-compact-bar-centre-title">
              <span className="ui-rep-bar-title" data-clip-ok="">{`${name} · ${pill.label}`}</span>
              <ChevronDownIcon size={10} />
            </span>
            <span className="ui-compact-bar-centre-net">
              <bdi dir="ltr">{figure == null ? "" : amountText(figure.amount, figure.currency)}</bdi>
            </span>
          </button>
        }
        end={share ?? <span className="ui-rep-bar-space" aria-hidden="true" />}
        dock={control == null ? undefined : control(true, scrollUnderBar)}
        docked={docked}
      />
      <div className="ui-rep-page">
        {top}
        {control == null ? null : (
          <>
            <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
            <DockSlot docked={docked}>{control(false, scrollUnderBar)}</DockSlot>
          </>
        )}
        {children}
      </div>
    </div>
  );
}

/** The rows' amount: income with its plus in green, a cost as it is (its group says so), a net with its sign. */
function rowAmount(tone: ViewRow["tone"], amount: bigint): { agorot: bigint; amountDirection?: "income"; loss?: boolean; amountPlus?: boolean } {
  if (tone === "income") return { agorot: amount, amountDirection: "income" };
  if (tone === "net") return { agorot: amount, loss: amount < 0n, amountPlus: amount > 0n };
  return { agorot: amount };
}

/** Category groups, each under a one-line sticky head with its total; a row opens its lines when `href` gives one. */
export function ViewGroups({ id, groups, currency, href }: { id: string; groups: readonly ViewGroup[]; currency: string; href?: (row: ViewRow) => string | undefined }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className="ui-month ui-rep-v3-group" aria-labelledby={`${id}-${group.key}`}>
          <GroupHead id={`${id}-${group.key}`} title={group.title} summary={<bdi dir="ltr">{amountText(group.total, currency, group.tone === "income")}</bdi>} />
          <List>
            {group.rows.map((row) => {
              const to = href?.(row);
              return (
                <ListRow
                  key={row.key}
                  variant="project"
                  title={slashBreaks(row.name)}
                  titleFull={row.name}
                  wrapTitle
                  {...(row.hint == null ? {} : { hint: row.hint })}
                  {...(to == null ? {} : { href: to })}
                  chevron={to != null}
                  chevronSpace={to == null}
                  currency={currency}
                  {...rowAmount(row.tone, row.amount)}
                />
              );
            })}
          </List>
        </section>
      ))}
    </>
  );
}

/** By project or by month: a group of rows, each its net with its income and expenses under it, each opening its own report. */
export function NetGroup({ id, title, rows, currency, open, hint }: {
  id: string;
  title: string;
  rows: readonly NetRow[];
  currency: string;
  /** The drill-down a row opens; none for a row that has nothing to open. */
  open: (row: NetRow) => string | undefined;
  hint?: (row: NetRow) => string;
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.net, 0n);
  return (
    <section className="ui-month ui-rep-v3-group" aria-labelledby={id}>
      <GroupHead id={id} title={title} summary={<bdi dir="ltr">{amountText(total, currency, true)}</bdi>} />
      <List>
        {rows.map((row) => {
          const to = open(row);
          return (
            <ListRow
              key={row.key}
              variant="project"
              title={slashBreaks(row.name)}
              titleFull={row.name}
              wrapTitle
              hint={hint?.(row) ?? `הכנסות ${amountText(row.income, currency)} · הוצאות ${amountText(row.expense, currency)}`}
              {...(to == null ? {} : { href: to, state: { reportDrill: true } })}
              chevron={to != null}
              chevronSpace={to == null}
              currency={currency}
              {...rowAmount("net", row.net)}
            />
          );
        })}
      </List>
    </section>
  );
}

/** The bottom line under the groups: "רווח נקי" or "הון עצמי", the band's figure again. */
export function ReportBottomLine({ label, amount, currency }: { label: string; amount: bigint; currency: string }) {
  return <ReportTotal label={label} amount={<Amount agorot={amount} currency={currency} loss={amount < 0n} />} strong />;
}

/** A drill-down's way on, after its groups: "לדף הפרויקט" or "תנועות החודש". */
export function ReportGoOn({ label, to }: { label: string; to: string }) {
  return (
    <List>
      <ListRow variant="item" title={label} href={to} chevron />
    </List>
  );
}

/** The balance sheet's Suspense warning: an icon and words, never colour alone (rule visual § 7). */
export function BalanceWarningCard({ row, fixHref }: { row: BalanceCurrency; fixHref: string }) {
  const warning = balanceWarning(row);
  if (warning == null) return null;
  return (
    <div className="ui-rep-warning" role="status">
      <span className="ui-rep-warning-icon" aria-hidden="true"><AlertIcon size={20} /></span>
      <span className="ui-rep-warning-text">
        <span className="ui-rep-warning-title">
          {"בחשבון מעבר · "}
          <Amount agorot={warning.amount} currency={row.currency} />
        </span>
        <span className="ui-rep-warning-body">יש תנועות שהקטגוריה שלהן לא קשורה לחשבון במאזן. אחרי שמסדרים, המספרים מתעדכנים.</span>
        <Link className="ui-rep-warning-action m-press" to={fixHref}>סידור הקטגוריות</Link>
      </span>
    </div>
  );
}

/** The list's skeleton while a view's read is in: rows in the list's own shape. */
export function ReportRowsSkeleton() {
  return (
    <List>
      {Array.from({ length: 6 }, (_, index) => <ListRow key={index} variant="skeleton" />)}
    </List>
  );
}

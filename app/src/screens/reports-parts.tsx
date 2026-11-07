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
import { MonthStepper } from "../ui/month-stepper";
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

/** One of the two rows under the band's figure: income and expenses, or assets and liabilities (no sign, as the board). */
export type BandRow = { label: string; amount: bigint };

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

/** The pill's chevrons: the earlier and later month's labels (null: none that way) and the step. */
export type ReportPillStep = { earlier: string | null; later: string | null; onStep: (delta: -1 | 1) => void };

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
  /** FLOW-1092: `step` puts the pill between the earlier and later chevrons (a drilled month, as Home's month pill). */
  pill: { label: string; onOpen: () => void; step?: ReportPillStep | null };
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
  const pillButton = (
    <button type="button" className="ui-rep-pill m-press" aria-haspopup="dialog" onClick={pill.onOpen}>
      <span className="ui-rep-pill-label">{pill.label}</span>
      <ChevronDownIcon size={14} />
    </button>
  );
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
            {pill.step == null ? pillButton : (
              <MonthStepper earlier={pill.step.earlier} later={pill.step.later} onBand onStep={pill.step.onStep}>
                {pillButton}
              </MonthStepper>
            )}
            <div className="ui-rep-band-figure">
              <p className="ui-band-title">{figureLabel}</p>
              {figure == null ? (
                <Skeleton tone="band" hero />
              ) : (
                <p className="ui-band-net">
                  <Amount agorot={figure.amount} currency={figure.currency} loss={figure.loss} size="hero" compact />
                </p>
              )}
              {figure == null ? (
                <p className="ui-rep-band-sub t-line2" aria-hidden="true">&nbsp;</p>
              ) : figureSub == null ? null : (
                <p className="ui-rep-band-sub t-line2">{figureSub}</p>
              )}
            </div>
            {figure == null ? (
              // While the read is in, the two rows keep their place (V3-States: the band's height does not jump).
              <div className="ui-rep-band-rows" aria-hidden="true">
                {[0, 1].map((index) => (
                  <p key={index} className="ui-rep-band-row">
                    <Skeleton tone="band" width="sm" />
                    <Skeleton tone="band" width="sm" />
                  </p>
                ))}
              </div>
            ) : (
              <div className="ui-rep-band-rows">
                {rows.map((row) => (
                  <p key={row.label} className="ui-rep-band-row">
                    <span>{row.label}</span>
                    <span className="ui-rep-band-row-amount">
                      <Amount agorot={row.amount} currency={currency} size="list" />
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

/** The rows' amount: income with its plus in green, a cost as it is (its group says so), a net with its sign: a profit
   in green as income, a loss in the signal colour (V3-Report). */
function rowAmount(tone: ViewRow["tone"], amount: bigint): { agorot: bigint; amountDirection?: "income"; loss?: boolean } {
  if (tone === "income" || (tone === "net" && amount > 0n)) return { agorot: amount, amountDirection: "income" };
  if (tone === "net") return { agorot: amount, loss: amount < 0n };
  return { agorot: amount };
}

/** A row's share of its group, in whole percent from 0 to 100 (the percent under a report row; 0 for an empty total). */
export function barShare(amount: bigint, total: bigint): number {
  const whole = total < 0n ? -total : total;
  if (whole === 0n) return 0;
  const part = amount < 0n ? -amount : amount;
  return Math.min(100, Number((part * 100n) / whole));
}

/** A row's share as the hint writes it: a whole percent, or "under 1%" when a non-zero row floors to 0 (FLOW-1083). */
export type RowShare = number | "under-1";

/** A row's share of its group for its hint: a non-zero row that floors to 0% says "פחות מ־1%", a zero row 0% (FLOW-1083). */
export function rowShare(amount: bigint, total: bigint): RowShare {
  const share = barShare(amount, total);
  return share === 0 && amount !== 0n && total !== 0n ? "under-1" : share;
}

/** A report row's line with figures, in full and with short figures for below 360px (FLOW-1082). */
export type HintFigures = { full: string; short: string };

/**
 * FLOW-1082 (the owner, 2026-11-07: one line, short amounts): a row's labelled figures, "הכנסות $30,000 · הוצאות
 * $17,000" in full and "הכנסות $30K · הוצאות $17K" below 360px. The exact figures are in the drill-down.
 */
export function hintFigures(parts: readonly (readonly [label: string, amount: bigint])[], currency: string): HintFigures {
  const line = (compact: boolean) => parts.map(([label, amount]) => `${label} ${formatAmountText(amount, currency, compact ? { compact, compactFrom: 1_000 } : undefined)}`).join(" · ");
  return { full: line(false), short: line(true) };
}

/**
 * FLOW-1064 (the owner, 2026-11-06: the bar "looks childish", a percent instead): a report row's line under its
 * name, on one line. The row's share of its group leads it as a whole percent, "85% · <the hint>", or alone as
 * "85% מהקבוצה" when the row has no hint. FLOW-1082: a line with figures shows them short below 360px, so no
 * amount is cut at 320; a screen reader reads the full figures once.
 */
export function reportHint(text: string | HintFigures | undefined, share?: RowShare): ReactNode {
  if (text == null && share == null) return undefined;
  const percent = share == null ? null : share === "under-1" ? <>פחות מ־<bdi dir="ltr">1%</bdi></> : <bdi dir="ltr">{`${String(share)}%`}</bdi>;
  const rest = text == null ? " מהקבוצה" : typeof text === "string" ? (
    text
  ) : (
    <>
      <span className="ui-rep-hint-full">{text.full}</span>
      <span className="ui-rep-hint-short" aria-hidden="true">{text.short}</span>
    </>
  );
  return (
    <span className="ui-rep-hint-text" data-clip-ok="">
      {percent}
      {percent == null || text == null ? null : " · "}
      {rest}
    </span>
  );
}

/** A category row's percent: a cost in a group of several, as its share of the group (none on income). */
function viewShare(group: ViewGroup, row: ViewRow): RowShare | undefined {
  if (group.rows.length < 2 || row.tone !== "cost" || row.amount <= 0n) return undefined;
  return rowShare(row.amount, group.total);
}

/** Category groups, each under a one-line sticky head with its total; a row opens its lines when `href` gives one. */
export function ViewGroups({ id, groups, currency, href, bars = () => true }: {
  id: string;
  groups: readonly ViewGroup[];
  currency: string;
  href?: (row: ViewRow) => string | undefined;
  /** Whether a group's rows show their share of it (the balance sheet's equity does not). */
  bars?: (group: ViewGroup) => boolean;
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className="ui-month ui-rep-v3-group" aria-labelledby={`${id}-${group.key}`}>
          <GroupHead id={`${id}-${group.key}`} title={group.title} summary={<bdi dir="ltr">{amountText(group.total, currency, group.tone === "income")}</bdi>} />
          <List>
            {group.rows.map((row) => {
              const to = href?.(row);
              const hint = reportHint(row.hint, bars(group) ? viewShare(group, row) : undefined);
              return (
                <ListRow
                  key={row.key}
                  variant="project"
                  title={slashBreaks(row.name)}
                  wrapTitle
                  {...(hint == null ? {} : { hint })}
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
export function NetGroup({ id, title, rows, currency, open }: {
  id: string;
  title: string;
  rows: readonly NetRow[];
  currency: string;
  /** The drill-down a row opens; none for a row that has nothing to open. */
  open: (row: NetRow) => string | undefined;
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.net, 0n);
  // The percents share the rows' sizes, a loss as much as a profit; one row alone shows none.
  const whole = rows.reduce((sum, row) => sum + (row.net < 0n ? -row.net : row.net), 0n);
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
              wrapTitle
              hint={reportHint(hintFigures([["הכנסות", row.income], ["הוצאות", row.expense]], currency), rows.length < 2 ? undefined : rowShare(row.net, whole))}
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

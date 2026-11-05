import { useCallback, useRef, useState, type ReactNode } from "react";
import type { CashCurrencyRow } from "@flow/shared";
import { formatAmountText } from "@flow/shared";
import { addTriggerRef } from "../add-trigger";
import { markRecurringTipSeen, recurringTipSeen, useTipDismiss } from "../recurring-tip";
import { Link } from "react-router-dom";
import { cashLinesPath } from "../cash";
import { changeTone } from "../home-month";
import type { PeriodChoice } from "../period";
import { anchorOf, monthPeriod } from "../period";
import { useAllowAdd } from "../use-allow-add";
import { Amount } from "../ui/amount";
import { ChangePill } from "../ui/change-pill";
import { CompactBar } from "../ui/compact-bar";
import { cx } from "../ui/cx";
import { HEBREW_MONTHS } from "../ui/date-math";
import { IconButton } from "../ui/icon-button";
import { SEARCH_FOCUS_STATE } from "../ui/search-entry";
import { ChevronDownIcon, CloseIcon, OutwardChevron, PersonIcon, PlusIcon, RepeatIcon, SearchIcon } from "../ui/icons";
import { MonthStepper } from "../ui/month-stepper";
import { PeriodSwipe } from "../ui/period-swipe";
import { Skeleton } from "../ui/skeleton";

/**
 * FLOW-364: Home's band, figures, forecast row and compact bar. The pure month logic is in home-month.ts; these
 * parts only draw it. FLOW-1036: the split card and the attention box left Home (the cards are AttentionCards).
 */

/** "אוקטובר 2026": a month's name with its year. */
export function homeMonthLabel(key: string): string {
  return `${HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;
}

/** A month's name without its year: "אוקטובר". */
export function monthName(key: string): string {
  return HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/** The band's month steps: the earlier and later months (null at the ends) and the drawer. */
export type HomeMonthNav = {
  earlierKey: string | null;
  laterKey: string | null;
  onStep: (key: string) => void;
  onOpenDrawer: () => void;
  /** FLOW-1036: on the current month, the later arrow opens the drawer on next month and its forecast. */
  onOpenNext?: () => void;
};

/** The later arrow's name and what it does: a later month, next month's forecast in the drawer, or nothing. */
function laterStep(nav: HomeMonthNav): { label: string; go: () => void } | null {
  const later = nav.laterKey;
  if (later != null) {
    return {
      label: "חודש הבא",
      go: () => {
        nav.onStep(later);
      },
    };
  }
  return nav.onOpenNext == null ? null : { label: "חודש הבא · תחזית", go: nav.onOpenNext };
}

/**
 * Row 1 of the band: + , search, קבועים and the avatar on the current month; "חזרה ל…" on a past one.
 * FLOW-986 (board concept B): קבועים left the tab bar for this icon. FLOW-1017: a red count on it says how many
 * recurring bills and income are late (a number, not colour alone).
 */
export function HomeBandActions({ isPast, currentName, search, avatarInitial, lateRecurring = 0, recurringTo = "/recurring", recurringTip = false }: {
  isPast: boolean;
  currentName: string;
  search: string;
  avatarInitial?: string;
  /** Recurring bills and income late for this month: their count on the קבועים icon when more than 0. */
  lateRecurring?: number;
  /** Where the icon goes (the dev fixtures' own path). */
  recurringTo?: string;
  /**
   * FLOW-987: may show the one-time "קבועים עברו לכאן" tip under the icon (live Home only). FLOW-1015: only for an
   * owner who had the tab, so Home passes it once the owner's recurring rows are read (useReturningRecurringOwner).
   */
  recurringTip?: boolean;
}) {
  const allowAdd = useAllowAdd();
  const [tipClosed, setTipClosed] = useState(recurringTipSeen);
  const tipOpen = recurringTip && !tipClosed;
  const tip = useRef<HTMLDivElement>(null);
  const closeTip = useCallback(() => {
    markRecurringTipSeen();
    setTipClosed(true);
  }, []);
  // FLOW-1015: a hint never blocks what is under it: a tap outside the bubble, or a scroll, closes it.
  useTipDismiss(tipOpen, tip, closeTip);
  if (isPast) {
    return (
      <Link to={`/${search}`} replace className="ui-band-back m-press">
        <span>{`חזרה ל${currentName}`}</span>
        <OutwardChevron side="end" />
      </Link>
    );
  }
  return (
    <div className="ui-band-actions">
      {allowAdd ? (
        <IconButton
          label="הוספה"
          onBand
          to={`/add${search}`}
          ref={(node) => {
            // The sheet returns focus here when it closes (FLOW-364).
            addTriggerRef.current = node;
          }}
          className="ui-band-action"
        >
          <PlusIcon size={22} />
        </IconButton>
      ) : null}
      {/* The search opens with its field focused, as the entry on the other screens does (FLOW-323). */}
      <IconButton label="חיפוש" onBand to={`/search${search}`} state={SEARCH_FOCUS_STATE} className="ui-band-action">
        <SearchIcon size={22} />
      </IconButton>
      <span className="ui-band-tip-anchor" onClickCapture={tipOpen ? closeTip : undefined}>
        <IconButton
          label={lateRecurring > 0 ? `קבועים, ${lateRecurring === 1 ? "אחד לא הגיע" : `${String(lateRecurring)} לא הגיעו`}` : "קבועים"}
          onBand
          to={`${recurringTo}${search}`}
          className="ui-band-action"
        >
          <RepeatIcon size={22} />
          {/* The name already says the count; the badge shows it, 9+ past nine so it keeps its size. */}
          {lateRecurring > 0 ? <span className="ui-band-count" aria-hidden="true">{lateRecurring > 9 ? "9+" : String(lateRecurring)}</span> : null}
        </IconButton>
      </span>
      {tipOpen ? (
        <div ref={tip} className="ui-band-tip" role="status" aria-label="קבועים עברו לכאן">
          <p className="ui-band-tip-text">
            <strong>קבועים עברו לכאן</strong>
            {/* The count's sentence only while the count is on. */}
            {lateRecurring > 0 ? <span>המספר האדום: קבועים שלא הגיעו.</span> : null}
          </p>
          <IconButton label="סגירה" onClick={closeTip} className="ui-band-tip-close">
            <CloseIcon size={18} />
          </IconButton>
        </div>
      ) : null}
      <IconButton label="הגדרות וחשבון" onBand to={`/settings${search}`} className="ui-band-action">
        <span className="ui-band-avatar" aria-hidden="true">
          {avatarInitial ?? <PersonIcon />}
        </span>
      </IconButton>
    </div>
  );
}

/** The band's month pill: the arrows and the name, which opens the drawer. */
export function HomeMonthPill({ monthKey, nav }: { monthKey: string; nav: HomeMonthNav }) {
  const later = laterStep(nav);
  return (
    <MonthStepper
      earlier={nav.earlierKey == null ? null : "חודש קודם"}
      later={later?.label ?? null}
      onBand
      onStep={(delta) => {
        if (delta > 0) {
          later?.go();
          return;
        }
        if (nav.earlierKey != null) nav.onStep(nav.earlierKey);
      }}
    >
      <button type="button" className="ui-band-month-name m-press" aria-haspopup="dialog" onClick={nav.onOpenDrawer}>
        <span>{homeMonthLabel(monthKey)}</span>
        <ChevronDownIcon size={12} />
      </button>
    </MonthStepper>
  );
}

/** What the figures show: the shown currency rows (base first), the base's comparison and its captions. */
export type HomeFigureRows = {
  currency: string;
  rows: CashCurrencyRow[];
  /** The base currency's figures to compare with (the previous month, to the same day), or null when there is none. */
  compare: { in_minor: bigint; out_minor: bigint } | null;
  previousName: string | null;
  /** The day the comparison runs to on the current month; null on a past month (whole months). */
  day: number | null;
  isPast: boolean;
};

function caption(figures: HomeFigureRows): string {
  if (figures.previousName == null) return "החודש הראשון בנתונים";
  if (figures.isPast || figures.day == null) return `שינוי מול ${figures.previousName}, חודש מלא`;
  return `שינוי מול ${figures.previousName}, עד ה־${String(figures.day)} בחודש`;
}

/** The band's figures: the title, the net, נכנס and יצא with their change pills, and the caption. */
export function HomeFigures({ monthKey, figures, search, animate }: { monthKey: string; figures: HomeFigureRows; search: string; animate: "earlier" | "later" | null }) {
  const base = figures.rows[0];
  const compare = figures.compare;
  const multi = figures.rows.length > 1;
  const enter = animate === "earlier" ? "ui-band-month-in-earlier" : animate === "later" ? "ui-band-month-in-later" : undefined;
  return (
    <div className={cx("ui-home-figures ui-band-fade", enter)}>
      <p className="ui-band-title">{figures.isPast ? "תזרים · חודש סגור" : "תזרים · עד היום"}</p>
      <div className="ui-band-net">
        {figures.rows.map((row, index) => (
          <span key={row.currency} className="ui-band-net-line">
            <Amount agorot={row.net_minor} currency={row.currency} size={multi || index > 0 ? "display" : "hero"} compact />
          </span>
        ))}
      </div>
      <div className="ui-band-rows">
        {(["in", "out"] as const).map((side) => {
          const amount = base == null ? 0n : side === "in" ? base.in_minor : base.out_minor;
          const delta = base == null || compare == null ? 0n : side === "in" ? base.in_minor - compare.in_minor : base.out_minor - compare.out_minor;
          const tone = changeTone(side, delta);
          return (
            <Link key={side} to={cashLinesPath(monthKey, side, figures.currency, search)} className="ui-band-row-link m-press">
              <span className="ui-band-row-label">{side === "in" ? "נכנס" : "יצא"}</span>
              <span className="ui-band-row-amount">
                <Amount agorot={amount} currency={figures.currency} size="list" />
              </span>
              {tone == null ? null : <ChangePill amount={{ minor: delta, currency: figures.currency }} tone={tone} comparison="" />}
            </Link>
          );
        })}
      </div>
      <p className="ui-band-caption">{caption(figures)}</p>
    </div>
  );
}

/** The figures, swipeable as the month page is: a sideways swipe steps the month (PeriodSwipe). */
export function HomeSwipeFigures({ monthKey, figures, search, nav, animate }: { monthKey: string; figures: HomeFigureRows; search: string; nav: HomeMonthNav; animate: "earlier" | "later" | null }) {
  return (
    <PeriodSwipe
      period={monthPeriod(monthKey)}
      allow={(next: PeriodChoice) => {
        const key = anchorOf(next);
        return key === nav.earlierKey || key === nav.laterKey;
      }}
      onChange={(next) => {
        nav.onStep(anchorOf(next));
      }}
    >
      <HomeFigures monthKey={monthKey} figures={figures} search={search} animate={animate} />
    </PeriodSwipe>
  );
}

/**
 * FLOW-364: the forecast row at the band's foot. CashHome wraps it in the link to the forecast (FLOW-141).
 * FLOW-1031: `minor` null is the row while its read is on its way: the same box with a bar for the figure, so
 * the figure arrives without moving what is below it.
 */
export function ForecastRow({ monthKey, minor, currency }: { monthKey: string; minor: bigint | null; currency: string }) {
  return (
    <div className="ui-home-forecast ui-band-fade">
      <div className="ui-home-forecast-text">
        <p className="ui-home-forecast-title">{`תזרים צפוי לסוף ${monthName(monthKey)}`}</p>
        <p className="ui-home-forecast-sub">הערכה · לפי קבועים וחשבוניות פתוחות</p>
      </div>
      <span className="ui-home-forecast-value">
        {minor == null ? <Skeleton tone="band" className="ui-skel-forecast-value" /> : <Amount agorot={minor} currency={currency} size="list" />}
      </span>
      <span className="ui-home-forecast-chevron" aria-hidden="true" data-pending={minor == null ? "" : undefined}>
        <OutwardChevron side="end" />
      </span>
    </div>
  );
}

/**
 * Home's compact bar: the arrows step the month and keep the scroll; the centre opens the drawer. FLOW-1036:
 * `dock` is the activity filter, held on the band while `docked` (the in-page one reached the bar).
 */
export function HomeCompactBar({ monthKey, net, currency, isPast, nav, shown, dock, docked = false }: { monthKey: string; net: bigint; currency: string; isPast: boolean; nav: HomeMonthNav; shown: boolean; dock?: ReactNode; docked?: boolean }) {
  const later = laterStep(nav);
  return (
    <CompactBar
      title=""
      shown={shown}
      tone={isPast ? "band-past" : "band"}
      dock={dock}
      docked={docked}
      start={
        <IconButton
          label="חודש קודם"
          onBand
          disabled={nav.earlierKey == null}
          onClick={() => {
            if (nav.earlierKey != null) nav.onStep(nav.earlierKey);
          }}
        >
          <OutwardChevron side="start" />
        </IconButton>
      }
      centre={
        <button type="button" className="ui-compact-bar-centre m-press" aria-haspopup="dialog" onClick={nav.onOpenDrawer}>
          <span className="ui-compact-bar-centre-title">
            {homeMonthLabel(monthKey)}
            <ChevronDownIcon size={10} />
          </span>
          <span className="ui-compact-bar-centre-net">
            <bdi>{formatAmountText(net, currency)}</bdi>
          </span>
        </button>
      }
      end={
        <IconButton
          label={later?.label ?? "חודש הבא"}
          onBand
          disabled={later == null}
          onClick={() => {
            later?.go();
          }}
        >
          <OutwardChevron side="end" />
        </IconButton>
      }
    />
  );
}

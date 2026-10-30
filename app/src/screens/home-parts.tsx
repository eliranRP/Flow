import type { CashCurrencyRow } from "@flow/shared";
import { formatAmountText } from "@flow/shared";
import { addTriggerRef } from "../add-trigger";
import { Link } from "react-router-dom";
import { cashLinesPath, notInProfitHint } from "../cash";
import { changeTone, splitParts } from "../home-month";
import type { PeriodChoice } from "../period";
import { anchorOf, monthPeriod } from "../period";
import { useAllowAdd } from "../use-allow-add";
import { Amount } from "../ui/amount";
import { BannerRows, type BannerRow } from "../ui/banner";
import { ReviewButton } from "../ui/band-states";
import { ChangePill } from "../ui/change-pill";
import { CompactBar } from "../ui/compact-bar";
import { cx } from "../ui/cx";
import { HEBREW_MONTHS } from "../ui/date-math";
import { IconButton } from "../ui/icon-button";
import { SEARCH_FOCUS_STATE } from "../ui/search-entry";
import { ChevronDownIcon, ChevronIcon, OutwardChevron, PersonIcon, PlusIcon, RepeatIcon, SearchIcon } from "../ui/icons";
import { MonthStepper } from "../ui/month-stepper";
import { PartsBar } from "../ui/parts-bar";
import { PeriodSwipe } from "../ui/period-swipe";

/**
 * FLOW-364: Home's band, figures, split card, forecast, attention box and compact bar. The pure
 * month logic is in home-month.ts; these parts only draw it.
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
};

/**
 * Row 1 of the band: + , search, קבועים and the avatar on the current month; "חזרה ל…" on a past one.
 * FLOW-986 (board concept B): קבועים left the tab bar for this icon; a dot marks late recurring bills.
 */
export function HomeBandActions({ isPast, currentName, search, avatarInitial, lateRecurring = 0, recurringTo = "/recurring" }: {
  isPast: boolean;
  currentName: string;
  search: string;
  avatarInitial?: string;
  /** Recurring bills and income late for this month: a dot on the קבועים icon when more than 0. */
  lateRecurring?: number;
  /** Where the icon goes (the dev fixtures' own path). */
  recurringTo?: string;
}) {
  const allowAdd = useAllowAdd();
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
      <IconButton
        label={lateRecurring > 0 ? `קבועים, ${lateRecurring === 1 ? "אחד לא הגיע" : `${String(lateRecurring)} לא הגיעו`}` : "קבועים"}
        onBand
        to={`${recurringTo}${search}`}
        className="ui-band-action"
      >
        <RepeatIcon size={22} />
        {lateRecurring > 0 ? <span className="ui-band-dot" aria-hidden="true" /> : null}
      </IconButton>
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
  return (
    <MonthStepper
      earlier={nav.earlierKey == null ? null : "חודש קודם"}
      later={nav.laterKey == null ? null : "חודש הבא"}
      onBand
      onStep={(delta) => {
        const next = delta < 0 ? nav.earlierKey : nav.laterKey;
        if (next != null) nav.onStep(next);
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

/** FLOW-364: the forecast row at the band's foot. CashHome wraps it in the link to the forecast (FLOW-141). */
export function ForecastRow({ monthKey, minor, currency }: { monthKey: string; minor: bigint; currency: string }) {
  return (
    <div className="ui-home-forecast ui-band-fade">
      <div className="ui-home-forecast-text">
        <p className="ui-home-forecast-title">{`תזרים צפוי לסוף ${monthName(monthKey)}`}</p>
        <p className="ui-home-forecast-sub">הערכה · לפי קבועים וחשבוניות פתוחות</p>
      </div>
      <span className="ui-home-forecast-value">
        <Amount agorot={minor} currency={currency} size="list" />
      </span>
      <span className="ui-home-forecast-chevron" aria-hidden="true">
        <OutwardChevron side="end" />
      </span>
    </div>
  );
}

/** The split card: the net divided into the cash the P&L leaves out, and the month's profit. */
export function SplitCard({ monthKey, row, search, onOpenProfit }: { monthKey: string; row: CashCurrencyRow; search: string; onOpenProfit: () => void }) {
  const parts = splitParts(row.net_minor, row.profit_minor);
  if (!parts.visible) return null;
  const hint = notInProfitHint(row);
  const keptLabel = parts.notCounted < 0n ? "השקעה, לא נספר ברווח" : "הון שנכנס, לא נספר ברווח";
  const absKept = parts.notCounted < 0n ? -parts.notCounted : parts.notCounted;
  const absProfit = parts.profit < 0n ? -parts.profit : parts.profit;
  const metric = row.net_minor < 0n ? "ממה מורכב המינוס" : "ממה מורכב התזרים";
  return (
    <section className="ui-home-split" aria-labelledby="home-split-title">
      <div className="ui-home-split-head">
        <p className="ui-home-split-metric">{metric}</p>
        <h2 id="home-split-title" className="ui-home-split-title">{splitTakeaway(parts.lead, row.net_minor, row.profit_minor)}</h2>
      </div>
      <PartsBar
        label={metric}
        height={8}
        gap={2}
        radius="block"
        parts={[
          { key: "kept", value: absKept, tone: "accent" },
          { key: "profit", value: absProfit, tone: parts.profit < 0n ? "bad" : "muted" },
        ]}
      />
      <Link to={cashLinesPath(monthKey, "kept", row.currency, search)} className="ui-home-split-row m-press">
        <span className="ui-home-split-swatch" aria-hidden="true" />
        <span className="ui-home-split-text">
          <span className="ui-home-split-label">{keptLabel}</span>
          <span className="ui-home-split-sub">{[hint, `${String(parts.notCountedPct)}%`].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="ui-home-split-value">
          <Amount agorot={parts.notCounted} currency={row.currency} size="list" />
        </span>
        <ChevronIcon size={18} />
      </Link>
      <button type="button" className="ui-home-split-row m-press" onClick={onOpenProfit}>
        <span className={cx("ui-home-split-swatch", parts.profit < 0n ? "ui-home-split-loss" : "ui-home-split-swatch-none")} aria-hidden="true" />
        <span className="ui-home-split-text">
          <span className="ui-home-split-label">רווח החודש</span>
          <span className="ui-home-split-sub">{`הפעילות השוטפת · ${String(parts.profitPct)}%`}</span>
        </span>
        <span className={cx("ui-home-split-value", parts.profit < 0n && "ui-home-split-loss")}>
          <Amount agorot={parts.profit} currency={row.currency} size="list" loss={parts.profit < 0n} />
        </span>
        <ChevronIcon size={18} />
      </button>
    </section>
  );
}

/**
 * FLOW-958: the split card's title says what the bar shows, not the metric's name. The larger part
 * leads: money that went to assets, owner's capital that came in, or the month's own profit or loss.
 */
export function splitTakeaway(lead: "out" | "in" | null, netMinor: bigint, profitMinor: bigint): string {
  if (lead === "out") return netMinor < 0n ? "רוב המינוס הלך לנכסים" : "רוב מה שיצא הלך לנכסים";
  if (lead === "in") return "רוב מה שנכנס הוא הון";
  if (profitMinor < 0n) return netMinor < 0n ? "רוב המינוס הוא הפסד שוטף" : "הפעילות השוטפת הפסידה";
  return "רוב התזרים הוא רווח";
}

/**
 * The דורש טיפול box: review, open invoices, late bills and changed charges. Hidden with no rows.
 * FLOW-958: the review row is Home's one filled button; the other rows follow it as lines.
 */
export function AttentionBox({ rows }: { rows: readonly BannerRow[] }) {
  if (rows.length === 0) return null;
  const [first, ...others] = rows;
  const lines = first?.button == null ? rows : others;
  return (
    <section className="ui-home-attention" aria-labelledby="home-attention-title">
      <h2 id="home-attention-title" className="ui-home-attention-title">דורש טיפול</h2>
      <ReviewButton row={first} />
      <BannerRows rows={lines} />
    </section>
  );
}

/** Home's compact bar: the arrows step the month and keep the scroll; the centre opens the drawer. */
export function HomeCompactBar({ monthKey, net, currency, isPast, nav, shown }: { monthKey: string; net: bigint; currency: string; isPast: boolean; nav: HomeMonthNav; shown: boolean }) {
  return (
    <CompactBar
      title=""
      shown={shown}
      tone={isPast ? "band-past" : "band"}
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
          label="חודש הבא"
          onBand
          disabled={nav.laterKey == null}
          onClick={() => {
            if (nav.laterKey != null) nav.onStep(nav.laterKey);
          }}
        >
          <OutwardChevron side="end" />
        </IconButton>
      }
    />
  );
}

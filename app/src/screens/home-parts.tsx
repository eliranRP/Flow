import type { CashCurrencyRow } from "@flow/shared";
import { formatAmountText } from "@flow/shared";
import { useEffect, useState } from "react";
import { addTriggerRef } from "../add-trigger";
import { Link } from "react-router-dom";
import { cashLinesPath, notInProfitHint } from "../cash";
import { changeTone, splitParts } from "../home-month";
import type { PeriodChoice } from "../period";
import { anchorOf, monthPeriod } from "../period";
import { useAllowAdd } from "../use-allow-add";
import { Amount } from "../ui/amount";
import { BannerRows, type BannerRow } from "../ui/banner";
import { ChangePill } from "../ui/change-pill";
import { CompactBar } from "../ui/compact-bar";
import { cx } from "../ui/cx";
import { HEBREW_MONTHS } from "../ui/date-math";
import { IconButton } from "../ui/icon-button";
import { ChevronDownIcon, ChevronIcon, OutwardChevron, PersonIcon, PlusIcon, SearchIcon } from "../ui/icons";
import { MonthStepper } from "../ui/month-stepper";
import { PeriodSwipe } from "../ui/period-swipe";
import { bandFade } from "../ui/top-band";

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

/** Row 1 of the band: + , search and the avatar on the current month; "חזרה ל…" on a past one. */
export function HomeBandActions({ isPast, currentName, search }: { isPast: boolean; currentName: string; search: string }) {
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
      <IconButton label="חיפוש" onBand to={`/search${search}`} className="ui-band-action">
        <SearchIcon size={22} />
      </IconButton>
      <IconButton label="הגדרות וחשבון" onBand to={`/settings${search}`} className="ui-band-action">
        <span className="ui-band-avatar" aria-hidden="true">
          <PersonIcon />
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
            <Amount agorot={row.net_minor} currency={row.currency} size={multi || index > 0 ? "display" : "hero"} />
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

/** FLOW-364: the forecast row at the band's foot. Static until FLOW-141 adds its route. */
export function ForecastRow({ monthKey, minor, currency }: { monthKey: string; minor: bigint; currency: string }) {
  return (
    <div className="ui-home-forecast ui-band-fade">
      <div className="ui-home-forecast-text">
        <p className="ui-home-forecast-title">{`צפי לסוף ${monthName(monthKey)}`}</p>
        <p className="ui-home-forecast-sub">הערכה · לפי קבועים וחשבוניות פתוחות</p>
      </div>
      <span className="ui-home-forecast-value">
        <Amount agorot={minor} currency={currency} size="list" />
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
  return (
    <section className="ui-home-split" aria-label="ממה מורכב">
      <h2 className="ui-home-split-title">{row.net_minor < 0n ? "ממה מורכב המינוס" : "ממה מורכב התזרים"}</h2>
      <div className="ui-home-split-bar" aria-hidden="true">
        <span className="ui-home-split-kept" style={{ flexGrow: Number(absKept) }} />
        <span className={cx("ui-home-split-profit", parts.profit < 0n && "ui-home-split-loss")} style={{ flexGrow: Number(absProfit) }} />
      </div>
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
        <span className="ui-home-split-swatch ui-home-split-swatch-none" aria-hidden="true" />
        <span className="ui-home-split-text">
          <span className="ui-home-split-label">רווח החודש</span>
          <span className="ui-home-split-sub">{`הפעילות השוטפת · ${String(parts.profitPct)}%`}</span>
        </span>
        <span className={cx("ui-home-split-value", parts.profit < 0n && "ui-home-split-loss")}>
          <Amount agorot={parts.profit} currency={row.currency} size="list" loss={parts.profit < 0n} />
        </span>
        <ChevronIcon size={18} />
      </button>
      <p className="ui-home-split-note">
        {parts.lead === "out" ? "רוב הכסף שיצא הלך לנכסים. " : parts.lead === "in" ? "רוב הכסף שנכנס הוא הון, לא הכנסה. " : ""}
        {row.profit_minor < 0n ? `הפעילות השוטפת הפסידה ${formatAmountText(absProfit, row.currency)}.` : `הפעילות השוטפת הרוויחה ${formatAmountText(absProfit, row.currency)}.`}
      </p>
    </section>
  );
}

/** The דורש טיפול box: review, open invoices, late bills and changed charges. Hidden with no rows. */
export function AttentionBox({ rows }: { rows: readonly BannerRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="ui-home-attention" aria-label="דורש טיפול">
      <h2 className="ui-home-attention-title">דורש טיפול</h2>
      <BannerRows rows={rows} />
    </section>
  );
}

/**
 * Whether the page is scrolled past the band's figures (scrollY 220 and more, the same bandFade the
 * band uses). The compact bar shows then.
 */
export function useCompactShown(): boolean {
  const [shown, setShown] = useState(() => bandFade(window.scrollY) === 0);
  useEffect(() => {
    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        setShown(bandFade(window.scrollY) === 0);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return shown;
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


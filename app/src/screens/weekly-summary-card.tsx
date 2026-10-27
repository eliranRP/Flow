import type { WeeklySummary } from "@flow/shared";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Amount } from "../ui/amount";
import { CalendarIcon, CheckIcon, ChevronIcon, CloseIcon } from "../ui/icons";
import { useWeeklySummaryQuery } from "../use-weekly-summary";
import { hideWeeklyCard } from "../weekly-card";
import { cardStatus, searchWithWeek, weekLabel } from "../weekly-summary";
import "../ui/css/57-weekly-summary.css";

/** The card fades and folds away in the sheet's exit time; under reduced motion it is gone at once. */
const LEAVE_MS = 220;

/**
 * FLOW-956: last week's summary as a card on Home, Sunday to Tuesday (board "Weekly card on Home",
 * page "Ready for dev"). Pure: WeeklySummaryCardSlot supplies the read; stories pass a summary.
 */
export function WeeklySummaryCard({
  summary,
  weekStart,
  onOpen,
  onHide,
  leaving = false,
}: {
  summary: WeeklySummary;
  weekStart: string;
  onOpen: () => void;
  onHide: () => void;
  /** After ✕: the card fades and folds away. */
  leaving?: boolean;
}) {
  const status = cardStatus(summary);
  const profitTone = summary.profit_minor < 0n ? "loss" : summary.profit_minor === 0n ? "zero" : "plain";
  return (
    <div className="ui-weekly-card-fold" data-leaving={leaving ? "" : undefined}>
      <div className="ui-weekly-card-clip">
        <section className="ui-weekly-card" aria-label="סיכום שבועי" dir="rtl">
          <button type="button" className="ui-weekly-card-open m-press" onClick={onOpen}>
            <span className="ui-weekly-card-head">
              <span className="ui-weekly-card-icon" aria-hidden="true"><CalendarIcon size={20} stroke={1.9} /></span>
              <span className="ui-weekly-card-titles">
                <span className="ui-weekly-card-title">הסיכום השבועי מוכן</span>
                <span className="ui-weekly-card-week">{weekLabel(weekStart)}</span>
              </span>
            </span>
            <span className="ui-weekly-card-foot">
              <span className="ui-weekly-card-profit ui-amount-fit">
                <span className="ui-weekly-card-label">רווח השבוע</span>
                <span className="ui-weekly-figure" data-tone={profitTone}>
                  <Amount agorot={summary.profit_minor} currency={summary.currency} size="card" loss={profitTone === "loss"} />
                </span>
              </span>
              <span className="ui-weekly-card-status" data-tone={status.tone}>
                {status.tone === "done" ? <span className="ui-weekly-done-icon" aria-hidden="true"><CheckIcon size={16} stroke={2.4} /></span> : null}
                {status.text}
                <span className="ui-weekly-chevron" aria-hidden="true"><ChevronIcon size={16} /></span>
              </span>
            </span>
          </button>
          <button type="button" className="ui-weekly-card-hide" aria-label="הסתרת הסיכום עד השבוע הבא" onClick={onHide}>
            <CloseIcon size={18} />
          </button>
        </section>
      </div>
    </div>
  );
}

/**
 * The live card for `weekStart`. Nothing shows until the week's figures arrive, and a failed read
 * shows nothing. A tap opens the weekly sheet over Home (`?week=`, the push's link); ✕ hides the
 * week's card on this phone.
 */
export function WeeklySummaryCardSlot({ weekStart }: { weekStart: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useWeeklySummaryQuery(weekStart);
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");
  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => {
      setPhase("gone");
    }, LEAVE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);
  if (query.data == null || phase === "gone") return null;
  return (
    <WeeklySummaryCard
      summary={query.data}
      weekStart={weekStart}
      leaving={phase === "leaving"}
      onOpen={() => {
        void navigate({ pathname: location.pathname, search: searchWithWeek(location.search, weekStart) }, { replace: true });
      }}
      onHide={() => {
        hideWeeklyCard(weekStart);
        setPhase("leaving");
      }}
    />
  );
}

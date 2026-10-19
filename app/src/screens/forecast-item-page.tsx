import { formatAmountText, type ForecastItem } from "@flow/shared";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { monthEndDay, nextMonth, type ForecastPatch, weekEndDay } from "../forecast-month";
import { chargeHref } from "../recurring-charge";
import { BackButton, liveSheetStack } from "../ui/back";
import { Button } from "../ui/button";
import { ChoiceSheet, type ChoiceSheetCopy } from "../ui/choice-sheet";
import { cx } from "../ui/cx";
import { FocusTitle } from "../ui/focus-title";
import { IconRow } from "../ui/icon-row";
import { CalendarIcon, DocumentIcon, PencilIcon, ProjectsIcon, TagIcon } from "../ui/icons";
import { List } from "../ui/list-row";
import { itemCharge } from "./forecast-categories";
import { dayMonth, itemLate, itemWhat } from "./forecast-parts";
import { monthName } from "./home-parts";

const WHEN_LAYER = "forecast-when";

/** The board's three choices: this week, to the month's end (or the item's own date), or not this month. */
export type ForecastWhen = "week" | "monthEnd" | "moved";

function startWhen(item: ForecastItem, today: string): ForecastWhen {
  if (item.moved_out) return "moved";
  if (item.due_on === weekEndDay(today) || itemLate(item, today)) return "week";
  return "monthEnd";
}

/** Digits with a thousands separator: 12500 reads 12,500 (the board's amount field). */
function groupThousands(text: string): string {
  const [whole = "", fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

/** "באיחור 34 ימים" (one day: "באיחור יום"). */
function lateText(days: number): string {
  return `באיחור ${days === 1 ? "יום" : `${String(days)} ימים`}`;
}

/**
 * What the page names the item's source: the row's title, the line under it, and where it links. A
 * recurring charge opens its own page (קבועים › the charge); the list is the fallback for a key with no party.
 */
function sourceOf(item: ForecastItem, search: string): { title: string; hint: string; to: string } {
  if (item.kind !== "invoice") {
    const charge = itemCharge(item);
    const to = charge == null ? `/recurring${search}` : chargeHref(charge.direction, charge.partyId, search, charge.projectId);
    return { title: "חיוב קבוע", hint: "פתיחת החיוב בקבועים", to };
  }
  // The open invoice's own page, as the open-invoices list links it.
  const id = item.key.replace(/^invoice:/, "");
  return { title: itemWhat(item), hint: item.direction === "income" ? "פתיחת החשבונית" : "פתיחת החשבון", to: `/unpaid/${encodeURIComponent(id)}${search}` };
}

/** The "מתי צפוי" sheet's words for this item and month (MonthForecastWhen). */
function whenSheetCopy(item: ForecastItem, today: string, monthEndChoice: string): ChoiceSheetCopy<ForecastWhen> {
  const month = today.slice(0, 7);
  const ownDate = monthEndChoice !== monthEndDay(month);
  return {
    historyKey: WHEN_LAYER,
    title: "מתי צפוי",
    subtitle: `${item.name === "" ? "ללא שם" : item.name} · בצפי של ${monthName(month)}`,
    choices: [
      { value: "week", label: "השבוע", description: item.late_days > 0 ? "עבר המועד. נניח שיגיע עד סוף השבוע" : "בשבוע הקרוב" },
      { value: "monthEnd", label: `עד ${dayMonth(monthEndChoice)}`, description: ownDate ? "לפי מועד התשלום" : "עד סוף החודש" },
      { value: "moved", label: "לא החודש", description: `יוצא מהצפי של ${monthName(month)} ועובר ל${monthName(nextMonth(month))}` },
    ],
  };
}

/**
 * MonthForecastEdit: a forecast row's own page, over the list. The amount, when it is expected (its
 * sheet, MonthForecastWhen), the project and category it files to, and a link to its source. Saving
 * changes the forecast only; the invoice, the bill and the recurring charge stay as they are.
 */
export function ForecastItemPage({
  item,
  today,
  backTo,
  projectName,
  categoryName,
  openWhen = false,
  onSave,
  onClose,
}: {
  item: ForecastItem;
  today: string;
  /** The list's path (with its query): Back's fallback on a deep link. */
  backTo: string;
  projectName: string;
  categoryName: string;
  /** The dev route's When frame opens the sheet with the page. */
  openWhen?: boolean;
  onSave: (item: ForecastItem, patch: ForecastPatch) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(Number(item.minor) / 100));
  const [when, setWhen] = useState<ForecastWhen>(startWhen(item, today));
  const [whenOpen, setWhenOpen] = useState(openWhen);
  const whenRow = useRef<HTMLButtonElement>(null);
  const whenOpenRef = useRef(whenOpen);
  whenOpenRef.current = whenOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const location = useLocation();
  const locationState: unknown = location.state;
  // The When sheet's history entry is popped after the sheet closes. A close (a save, Escape) in that gap
  // waits for the pop: Back now would take the sheet's entry, and the pop after it would reopen the page.
  const sheetEntry = whenOpen || liveSheetStack(locationState).includes(WHEN_LAYER);
  const sheetEntryRef = useRef(sheetEntry);
  sheetEntryRef.current = sheetEntry;
  const closeWaiting = useRef(false);
  const close = useRef(() => {
    if (sheetEntryRef.current || liveSheetStack(window.history.state).includes(WHEN_LAYER)) {
      closeWaiting.current = true;
      return;
    }
    onCloseRef.current();
  }).current;
  useEffect(() => {
    if (sheetEntry || !closeWaiting.current) return;
    closeWaiting.current = false;
    onCloseRef.current();
  }, [sheetEntry, location.key]);
  const month = today.slice(0, 7);
  const monthLabel = monthName(month);
  const income = item.direction === "income";
  const late = item.late_days > 0;
  const monthEnd = monthEndDay(month);
  const monthEndChoice = item.expected_on != null && item.expected_on > weekEndDay(today) ? item.expected_on : monthEnd;
  const source = sourceOf(item, location.search);
  const symbol = formatAmountText(0n, item.currency).replace(/0$/, "");
  const shownAmount = amount === "" ? "" : `${income ? "+" : "−"}${symbol}${groupThousands(amount)}`;
  const whenText = when === "week" ? "השבוע" : when === "moved" ? "לא החודש" : `עד ${dayMonth(monthEndChoice)}`;
  const whenHint = when === "moved" ? `יוצא מהצפי של ${monthLabel}` : late ? "עבר המועד הרגיל" : `בצפי של ${monthLabel}`;
  const kindText = item.kind !== "invoice" ? "קבוע" : income ? "חשבונית פתוחה" : "חשבון ספק פתוח";

  // Escape closes the When sheet first (the sheet's own), then the page.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || whenOpenRef.current) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [close]);

  function save() {
    if (when === "moved") {
      onSave(item, { moved_out: true });
    } else {
      const minor = amount.trim() === "" ? null : Math.round(Number(amount) * 100);
      const amountMinor = minor == null || BigInt(minor) === item.usual ? null : minor;
      const due = when === "week" ? weekEndDay(today) : monthEndChoice;
      onSave(item, { amount_minor: amountMinor, due_on: due, moved_out: false });
    }
    close();
  }

  return (
    <div className="ui-forecast-page m-push-in">
      <div className="ui-forecast-page-back">
        <BackButton fallback={backTo} text="צפי" />
      </div>
      <header className="ui-forecast-page-head">
        <span className={cx("ui-forecast-page-status", late && "ui-forecast-page-status-late")}>
          {`צפי · ${late ? lateText(item.late_days) : monthLabel}`}
        </span>
        <FocusTitle className="ui-forecast-page-title">{item.name === "" ? "ללא שם" : item.name}</FocusTitle>
        <label className="ui-forecast-page-amount">
          <span className="ui-forecast-page-pencil" aria-hidden="true"><PencilIcon size={20} /></span>
          <input
            className={cx("ui-forecast-page-input", income && "ui-forecast-page-input-in")}
            inputMode="decimal"
            dir="ltr"
            value={shownAmount}
            onChange={(event) => { setAmount(event.target.value.replace(/[^\d.]/g, "")); }}
            aria-label="סכום צפוי"
            disabled={when === "moved"}
          />
        </label>
        <p className="ui-forecast-page-meta">{`${monthLabel} · ${income ? "הכנסה" : "הוצאה"} · ${kindText}`}</p>
      </header>
      <List layout="inset" className="ui-forecast-page-card">
        <IconRow className="ui-forecast-page-project" icon={<ProjectsIcon size={22} />} label="פרויקט" value={projectName} />
        <IconRow className="ui-forecast-page-category" icon={<TagIcon size={22} />} label="קטגוריה" value={categoryName} />
      </List>
      <List layout="inset" className="ui-forecast-page-card">
        <IconRow
          className="ui-forecast-page-row"
          titled
          icon={<CalendarIcon size={22} />}
          label="מתי צפוי"
          value={whenHint}
          endTag={<span className="ui-forecast-page-when">{whenText}</span>}
          name={`מתי צפוי: ${whenText}`}
          buttonRef={whenRow}
          onClick={() => { setWhenOpen(true); }}
        />
        <IconRow className="ui-forecast-page-row" titled icon={<DocumentIcon size={22} />} label={source.title} value={source.hint} to={source.to} name={`${source.title}, ${source.hint}`} />
      </List>
      <p className="ui-forecast-page-hint">
        {item.kind !== "invoice" ? `משנה רק את הצפי של ${monthLabel}. החיוב הקבוע לא משתנה.` : "משנה רק את הצפי. החשבונית עצמה לא משתנה."}
      </p>
      <Button variant="primary" full onClick={save}>שמירה</Button>
      <ChoiceSheet
        copy={whenSheetCopy(item, today, monthEndChoice)}
        open={whenOpen}
        onOpenChange={setWhenOpen}
        value={when}
        saving={null}
        returnFocusRef={whenRow}
        // The board draws this sheet as the pace sheet: its panel, 56px rows and radio.
        panelClassName="ui-pace-sheet"
        onPick={(choice, close) => {
          setWhen(choice);
          close();
        }}
      />
    </div>
  );
}

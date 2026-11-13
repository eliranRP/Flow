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
import { CalendarIcon, DocumentIcon, ProjectsIcon, RepeatIcon } from "../ui/icons";
import { PencilIcon, TagIcon } from "../ui/icons-later";
import { PACE_WORDS, paceChoices, removalChoices, type RemovalPace, removedToast } from "../project-next-edit";
import type { ForecastPace } from "../project-next-month";
import { useProjectForecastWrites } from "../project-forecast-writes";
import { List } from "../ui/list-row";
import { Skeleton } from "../ui/skeleton";
import { itemCharge } from "./forecast-categories";
import { ADDED_LINE, dayMonth, FORECAST_TITLE, itemLate, itemWhat } from "./forecast-parts";
import { monthName } from "./home-parts";

const WHEN_LAYER = "forecast-when";
const REMOVE_LAYER = "forecast-remove";
/** The page's sheets whose history entry a close waits for. */
const LAYERS = [WHEN_LAYER, REMOVE_LAYER];

function inLayer(stack: readonly string[]): boolean {
  return stack.some((key) => LAYERS.includes(key));
}

function paceWord(pace: string | null): string {
  return pace != null && pace in PACE_WORDS ? PACE_WORDS[pace as ForecastPace] : "";
}

/**
 * FLOW-1010 (owner, 2026-11-01: "I want to be able to add it as a recurring income"): כל כמה זמן on an item's
 * page. A line the owner added, in the month it starts, picks its pace in the project forecast's own sheet;
 * FLOW-1012: the pick is a draft, like the amount and the date, and שמירת השינוי בצפי writes it (the line
 * itself changes, so it repeats from this month on). A line added in an earlier month, and a recurring
 * charge, show their pace and open where it is set: the project's צפי page, or the charge's page.
 */
function PaceRow({ item, month, search, pace, onPick }: { item: ForecastItem; month: string; search: string; pace: string | null; onPick: (pace: ForecastPace) => void }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  if (item.kind === "invoice" || item.pace == null) return null;
  const word = paceWord(pace);
  if (item.kind === "recurring") {
    const charge = itemCharge(item);
    const to = charge == null ? `/recurring${search}` : chargeHref(charge.direction, charge.partyId, search, charge.projectId);
    return <IconRow className="ui-forecast-page-row" titled icon={<RepeatIcon size={22} />} label="כל כמה זמן" value="נקבע בחיוב הקבוע" endTag={<span className="ui-forecast-page-when">{word}</span>} to={to} name={`כל כמה זמן: ${word}`} />;
  }
  if (item.project_id == null) return null;
  if (!paceEditable(item, month)) {
    return <IconRow className="ui-forecast-page-row" titled icon={<RepeatIcon size={22} />} label="כל כמה זמן" value="נקבע בצפי של הפרויקט" endTag={<span className="ui-forecast-page-when">{word}</span>} to={`/projects/${item.project_id}/profit/next${search}`} name={`כל כמה זמן: ${word}`} />;
  }
  const income = item.direction === "income";
  return (
    <>
      <IconRow
        className="ui-forecast-page-row"
        titled
        icon={<RepeatIcon size={22} />}
        label="כל כמה זמן"
        value={pace === "once" ? `רק ב${monthName(month)}` : income ? "הכנסה קבועה בצפי" : "הוצאה קבועה בצפי"}
        endTag={<span className="ui-forecast-page-when">{word}</span>}
        name={`כל כמה זמן: ${word}`}
        buttonRef={row}
        onClick={() => { setOpen(true); }}
      />
      <ChoiceSheet<ForecastPace>
        copy={{ historyKey: "forecast-pace", title: "כל כמה זמן", subtitle: `${item.name} · בצפי של הפרויקט`, choices: paceChoices(month) }}
        open={open}
        onOpenChange={setOpen}
        value={pace as ForecastPace}
        saving={null}
        returnFocusRef={row}
        panelClassName="ui-pace-sheet"
        onPick={(picked, close) => {
          close();
          onPick(picked);
        }}
      />
    </>
  );
}

/** A line the owner added, in the month it starts: its pace is picked on this page. */
function paceEditable(item: ForecastItem, month: string): boolean {
  return item.kind === "added" && item.pace != null && item.project_id != null && item.line_start === month;
}

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
  // FLOW-1005: a line the owner added to a project's forecast opens that project's צפי page.
  if (item.kind === "added") {
    return { title: "שורה בצפי של הפרויקט", hint: "פתיחת הצפי של הפרויקט", to: item.project_id == null ? `/forecast${search}` : `/projects/${item.project_id}/profit/next${search}` };
  }
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
      // FLOW-1081: an open invoice is still due after the month; a recurring charge is out of this month only.
      { value: "moved", label: "לא החודש", description: item.kind === "invoice" ? `יוצא מהצפי של ${monthName(month)} ועובר ל${monthName(nextMonth(month))}` : `רק ${monthName(month)} יוצא מהצפי. ב${monthName(nextMonth(month))} הוא צפוי כרגיל` },
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
  /** Null while its read is out: a skeleton holds the name's place (FLOW-1139). */
  projectName: string | null;
  categoryName: string | null;
  /** The dev route's When frame opens the sheet with the page. */
  openWhen?: boolean;
  /** `alsoUndo` (FLOW-1018): the pace write's undo, which the save's one ביטול sends after the month's own. */
  onSave: (item: ForecastItem, patch: ForecastPatch, alsoUndo?: () => void) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(Number(item.minor) / 100));
  const [when, setWhen] = useState<ForecastWhen>(startWhen(item, today));
  const [whenOpen, setWhenOpen] = useState(openWhen);
  const [pace, setPace] = useState(item.pace);
  const [removeOpen, setRemoveOpen] = useState(false);
  const whenRow = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const whenOpenRef = useRef(whenOpen);
  whenOpenRef.current = whenOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const location = useLocation();
  const locationState: unknown = location.state;
  // The When sheet's history entry is popped after the sheet closes. A close (a save, Escape) in that gap
  // waits for the pop: Back now would take the sheet's entry, and the pop after it would reopen the page.
  const sheetEntry = whenOpen || removeOpen || inLayer(liveSheetStack(locationState));
  const sheetEntryRef = useRef(sheetEntry);
  sheetEntryRef.current = sheetEntry;
  const closeWaiting = useRef(false);
  const close = useRef(() => {
    if (sheetEntryRef.current || inLayer(liveSheetStack(window.history.state))) {
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
  const paceWrites = useProjectForecastWrites(item.project_id ?? "", month);
  const paceChanged = pace !== item.pace && paceEditable(item, month);
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
  const kindText = item.kind === "added" ? ADDED_LINE : item.kind !== "invoice" ? "קבוע" : income ? "חשבונית פתוחה" : "חשבון ספק פתוח";

  // Escape closes the When sheet first (the sheet's own), then the page.
  const removeOpenRef = useRef(removeOpen);
  removeOpenRef.current = removeOpen;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || whenOpenRef.current || removeOpenRef.current) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [close]);

  /**
   * FLOW-1188: an added line leaves the month's forecast here, for this month only or from it on (decision 0268), as
   * on the project's צפי page. Before, its only way out was the project's page, which opens next month.
   */
  const removable = item.kind === "added" && item.project_id != null;
  function remove(removal: RemovalPace) {
    paceWrites.mutate({ fn: "remove_project_forecast_row", rowKey: `add:${item.key.replace(/^added:/, "")}`, pace: removal, message: removedToast(removal, month, item.name) });
    close();
  }

  function save() {
    let paceUndo: (() => void) | null = null;
    if (paceChanged && pace != null) {
      const picked = pace as ForecastPace;
      const call = { fn: "set_project_forecast_edit" as const, edit: { row_key: `add:${item.key.replace(/^added:/, "")}`, amount_minor: Number(item.usual), pace: picked } };
      // FLOW-1012: a pace pick alone writes the line only, not this month's amount and date.
      const sameAmount = amount.trim() === "" || Math.round(Number(amount) * 100) === Number(item.minor);
      if (sameAmount && when === startWhen(item, today)) {
        paceWrites.mutate({ ...call, message: picked === "once" ? `${item.name}: רק ב${monthLabel}` : `${item.name}: ${PACE_WORDS[picked]}` });
        close();
        return;
      }
      // FLOW-1018: with the amount or the date, the save shows one toast, whose ביטול undoes the month's change and then the pace.
      paceUndo = paceWrites.mutateUnder(call);
    }
    const minor = amount.trim() === "" ? null : Math.round(Number(amount) * 100);
    const patch: ForecastPatch = when === "moved"
      ? { moved_out: true }
      : { amount_minor: minor == null || BigInt(minor) === item.usual ? null : minor, due_on: when === "week" ? weekEndDay(today) : monthEndChoice, moved_out: false };
    if (paceUndo == null) onSave(item, patch);
    else onSave(item, patch, paceUndo);
    close();
  }

  return (
    <div className="ui-forecast-page m-push-in">
      <div className="ui-forecast-page-back">
        <BackButton fallback={backTo} text={FORECAST_TITLE} />
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
        <IconRow className="ui-forecast-page-project" icon={<ProjectsIcon size={22} />} label="פרויקט" value={projectName ?? ""} tag={projectName == null ? <Skeleton width="sm" /> : undefined} />
        <IconRow className="ui-forecast-page-category" icon={<TagIcon size={22} />} label="קטגוריה" value={categoryName ?? ""} tag={categoryName == null ? <Skeleton width="sm" /> : undefined} />
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
        <PaceRow item={item} month={month} search={location.search} pace={pace} onPick={setPace} />
        <IconRow className="ui-forecast-page-row" titled icon={<DocumentIcon size={22} />} label={source.title} value={source.hint} to={source.to} name={`${source.title}, ${source.hint}`} />
      </List>
      <p className="ui-forecast-page-hint">
        {paceChanged
          ? `משנה את הצפי של ${monthLabel}, ואת השורה בצפי של הפרויקט מ${monthLabel} והלאה.`
          : item.kind === "added"
          ? `משנה רק את הצפי של ${monthLabel}. השורה בצפי של הפרויקט לא משתנה.`
          : item.kind !== "invoice" ? `משנה רק את הצפי של ${monthLabel}. החיוב הקבוע לא משתנה.` : "משנה רק את הצפי. החשבונית עצמה לא משתנה."}
      </p>
      <Button variant="primary" full onClick={save}>שמירת השינוי בצפי</Button>
      {removable ? (
        <Button
          variant="danger-link"
          buttonRef={removeButton}
          disabled={paceWrites.pending}
          onClick={() => {
            // A line for this month only has no month after it.
            if (item.pace == null || item.pace === "once") remove("month");
            else setRemoveOpen(true);
          }}
        >
          הסרה מהצפי
        </Button>
      ) : null}
      {removable ? (
        <ChoiceSheet<RemovalPace, string>
          copy={{ historyKey: REMOVE_LAYER, title: "הסרה מהצפי", subtitle: `${item.name} · ${ADDED_LINE}`, choices: removalChoices(month) }}
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          value=""
          saving={null}
          returnFocusRef={removeButton}
          panelClassName="ui-pace-sheet"
          onPick={(choice, closeSheet) => {
            closeSheet();
            remove(choice);
          }}
        />
      ) : null}
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

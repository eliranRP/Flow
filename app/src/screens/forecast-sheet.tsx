import type { ForecastItem } from "@flow/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { monthEndDay, type ForecastPatch, weekEndDay } from "../forecast-month";
import { dayMonth, itemLate, itemWhat } from "./forecast-parts";
import { Button } from "../ui/button";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";

/** The board's three choices: this week, to the month's end, or not this month. */
type When = "week" | "monthEnd" | "moved";

function startWhen(item: ForecastItem, today: string): When {
  if (item.moved_out) return "moved";
  if (item.due_on === weekEndDay(today) || itemLate(item, today)) return "week";
  return "monthEnd";
}

/** Digits with a thousands separator: 12500 reads 12,500 (the board's amount field). */
export function groupThousands(text: string): string {
  const [whole = "", fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

/** The line under the title: what it is, then how late it is or when it is due. */
function subtitle(item: ForecastItem): string {
  const what = itemWhat(item);
  if (item.late_days > 0) return `${what} · באיחור ${item.late_days === 1 ? "יום" : `${String(item.late_days)} ימים`}`;
  if (item.kind === "invoice") return `${what} · ${item.expected_on != null ? `לתשלום עד ${dayMonth(item.expected_on)}` : item.direction === "income" ? "לגבייה" : "לתשלום"}`;
  return item.day != null ? `${what} · ב־${String(item.day)}` : what;
}

function ForecastItemForm({ item, today, onSave, onDone }: {
  item: ForecastItem;
  today: string;
  onSave: (item: ForecastItem, patch: ForecastPatch) => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(Number(item.minor) / 100));
  const [when, setWhen] = useState<When>(startWhen(item, today));
  const name = item.name === "" ? "ללא שם" : item.name;
  const usual = item.usual;
  const monthEnd = monthEndDay(today.slice(0, 7));
  const monthEndChoice = item.expected_on != null && item.expected_on > weekEndDay(today) ? item.expected_on : monthEnd;
  const source = item.kind !== "invoice"
    ? { to: "/recurring", label: "לחיוב הקבוע" }
    : { to: "/unpaid", label: item.direction === "income" ? "לחשבונית" : "לחשבון" };

  function save() {
    if (when === "moved") {
      onSave(item, { moved_out: true });
    } else {
      const minor = amount.trim() === "" ? null : Math.round(Number(amount) * 100);
      const amountMinor = minor == null || BigInt(minor) === usual ? null : minor;
      const due = when === "week" ? weekEndDay(today) : monthEndChoice;
      onSave(item, { amount_minor: amountMinor, due_on: due, moved_out: false });
    }
    onDone();
  }

  return (
    <div className="ui-forecast-form">
      <label className="ui-forecast-field">
        <span className="ui-forecast-field-label">סכום צפוי</span>
        <input
          className="ui-forecast-input"
          inputMode="decimal"
          value={groupThousands(amount)}
          onChange={(event) => { setAmount(event.target.value.replace(/[^\d.]/g, "")); }}
          aria-label={`סכום צפוי של ${name}`}
          disabled={when === "moved"}
        />
      </label>
      <div className="ui-forecast-when">
        <SegmentedControl
          label="מתי"
          value={when}
          onChange={setWhen}
          options={[
            { value: "week", label: "השבוע" },
            { value: "monthEnd", label: `עד ${dayMonth(monthEndChoice)}` },
            { value: "moved", label: "לא החודש" },
          ]}
        />
      </div>
      <p className="ui-forecast-source">
        <Link to={source.to}>{source.label}</Link>
      </p>
      <Button variant="primary" onClick={save}>שמירה</Button>
    </div>
  );
}

/**
 * FLOW-141: a tap on a forecast row. The amount, the day, or "not this month". Saving changes the
 * forecast only; the invoice, the bill and the charge stay as they are.
 */
export function ForecastItemSheet({ item, today, onOpenChange, onSave }: {
  item: ForecastItem | null;
  today: string;
  onOpenChange: (open: boolean) => void;
  onSave: (item: ForecastItem, patch: ForecastPatch) => void;
}) {
  return (
    <Sheet open={item != null} onOpenChange={onOpenChange} title={item?.name ?? ""} subtitle={item == null ? undefined : subtitle(item)} panelClassName="ui-sheet-g14 ui-forecast-sheet">
      {item == null ? null : (
        <ForecastItemForm key={item.key} item={item} today={today} onSave={onSave} onDone={() => { onOpenChange(false); }} />
      )}
    </Sheet>
  );
}

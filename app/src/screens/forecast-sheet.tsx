import type { ForecastItem } from "@flow/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { monthEndDay, type ForecastPatch } from "../forecast-month";
import { Button } from "../ui/button";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";

/** The Saturday that ends the week of `today` (yyyy-mm-dd), in the same format. */
export function weekEndDay(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const daysToSaturday = 6 - date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + daysToSaturday);
  return date.toISOString().slice(0, 10);
}

/** The board's three choices: this week, to the month's end, or not this month. */
type When = "week" | "monthEnd" | "moved";

function startWhen(item: ForecastItem, today: string): When {
  if (item.moved_out) return "moved";
  if (item.due_on === weekEndDay(today)) return "week";
  return "monthEnd";
}

/** Digits with a thousands separator: 12500 reads 12,500 (the board's amount field). */
export function groupThousands(text: string): string {
  const [whole = "", fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction == null ? grouped : `${grouped}.${fraction}`;
}

/** The line under the title: the invoice and its number, or the recurring charge and its day. */
function subtitle(item: ForecastItem): string {
  if (item.kind === "invoice") {
    const number = item.description != null && item.description !== "" ? ` ${item.description.replace(/^Invoice\s*/i, "")}` : "";
    return `חשבונית${number} · ${item.direction === "income" ? "לגבייה" : "לתשלום"}`;
  }
  return item.day != null ? `קבוע · ב־${String(item.day)}` : "קבוע";
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
  const source = item.kind === "invoice" ? { to: "/unpaid", label: "לחשבונית" } : { to: "/missing-bills", label: "לקבוע" };

  function save() {
    if (when === "moved") {
      onSave(item, { moved_out: true });
    } else {
      const minor = amount.trim() === "" ? null : Math.round(Number(amount) * 100);
      const amountMinor = minor == null || BigInt(minor) === usual ? null : minor;
      const due = when === "week" ? weekEndDay(today) : monthEnd;
      onSave(item, { amount_minor: amountMinor, due_on: due, moved_out: false });
    }
    onDone();
  }

  return (
    <div className="ui-forecast-form">
      <p className="ui-forecast-form-sub t-hint">{subtitle(item)}</p>
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
          showLabel={false}
          value={when}
          onChange={setWhen}
          options={[
            { value: "week", label: "השבוע" },
            { value: "monthEnd", label: `עד ${monthEnd.slice(8, 10)}/${monthEnd.slice(5, 7)}` },
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
    <Sheet open={item != null} onOpenChange={onOpenChange} title={item?.name ?? ""}>
      {item == null ? null : (
        <ForecastItemForm key={item.key} item={item} today={today} onSave={onSave} onDone={() => { onOpenChange(false); }} />
      )}
    </Sheet>
  );
}

import { formatAmountText, type ForecastItem } from "@flow/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { ForecastPatch } from "../forecast-month";
import { Button } from "../ui/button";
import { cx } from "../ui/cx";
import { Sheet } from "../ui/sheet";

/** The Saturday that ends the week of `today` (yyyy-mm-dd), in the same format. */
export function weekEndDay(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const daysToSaturday = 6 - date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + daysToSaturday);
  return date.toISOString().slice(0, 10);
}

type When = "week" | "until" | "month" | "moved";

/** The sheet's choices: this week, a day, the month's end (Flow's own day), or not this month. */
function startWhen(item: ForecastItem): When {
  if (item.moved_out) return "moved";
  if (item.due_on != null) return "until";
  return "month";
}

function wholeAmount(minor: bigint): string {
  return String(Number(minor) / 100);
}

function ForecastItemForm({ item, today, onSave, onDone }: {
  item: ForecastItem;
  today: string;
  onSave: (item: ForecastItem, patch: ForecastPatch) => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(wholeAmount(item.minor));
  const [when, setWhen] = useState<When>(startWhen(item));
  const [day, setDay] = useState(item.due_on ?? "");
  const name = item.name === "" ? "ללא שם" : item.name;
  const usual = item.usual;
  const source = item.kind === "invoice" ? { to: "/unpaid", label: "לחשבונית" } : { to: "/missing-bills", label: "לקבוע" };

  function save() {
    if (when === "moved") {
      onSave(item, { moved_out: true });
    } else {
      const minor = amount.trim() === "" ? null : Math.round(Number(amount) * 100);
      const amountMinor = minor == null || BigInt(minor) === usual ? null : minor;
      const due = when === "week" ? weekEndDay(today) : when === "until" ? (day === "" ? null : day) : null;
      onSave(item, { amount_minor: amountMinor, due_on: due, moved_out: false });
    }
    onDone();
  }

  const choices: Array<{ value: When; label: string }> = [
    { value: "week", label: "השבוע" },
    { value: "until", label: "עד תאריך" },
    { value: "month", label: "החודש" },
    { value: "moved", label: "לא החודש" },
  ];

  return (
    <div className="ui-forecast-form">
      <p className="ui-forecast-form-usual t-hint">{`הרגיל: ${formatAmountText(usual, "ILS")}`}</p>
      <label className="ui-forecast-field">
        <span className="ui-forecast-field-label">סכום צפוי</span>
        <input
          className="ui-forecast-input"
          inputMode="decimal"
          value={amount}
          onChange={(event) => { setAmount(event.target.value); }}
          aria-label={`סכום צפוי של ${name}`}
          disabled={when === "moved"}
        />
      </label>
      <fieldset className="ui-forecast-when">
        <legend className="ui-forecast-field-label">מתי</legend>
        <div className="ui-forecast-choices" role="radiogroup">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={when === choice.value}
              className={cx("ui-forecast-choice", when === choice.value && "ui-forecast-choice-on")}
              onClick={() => { setWhen(choice.value); }}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {when === "until" ? (
          <input type="date" className="ui-forecast-input" value={day} onChange={(event) => { setDay(event.target.value); }} aria-label="עד תאריך" />
        ) : null}
      </fieldset>
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

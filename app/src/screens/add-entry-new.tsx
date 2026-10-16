// FLOW-369: the one-line field under the chips for "+ פרויקט חדש" and "+ קטגוריה חדשה". An existing
// name says so and keeps הוספה disabled; הוספה adds the chip already selected.
import { useState } from "react";
import { newNameProblem } from "../add-entry";

export function AddNewEditor({ kind, existing, isIncome = false, onAdd, onCancel }: {
  kind: "project" | "category";
  existing: readonly string[];
  isIncome?: boolean;
  onAdd: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const problem = newNameProblem(value, existing);
  const word = kind === "project" ? "פרויקט" : "קטגוריה";
  const placeholder = kind === "project"
    ? "שם הפרויקט, למשל Willow Dr"
    : (isIncome ? "למשל דמי ניהול" : "למשל ציוד וכלים");
  const note = problem === "duplicate"
    ? `כבר יש ${word} בשם הזה`
    : kind === "project"
      ? "הפרויקט נוצר עם שם בלבד. סוג ותקציב אפשר להוסיף אחר כך בדף הפרויקט."
      : `קטגוריה של ${isIncome ? "הכנסה" : "הוצאה"}, נספרת ברווח. אפשר לשנות בהגדרות.`;
  const canAdd = problem == null && !busy;

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    setFailed(false);
    try {
      await onAdd(value.trim());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-add-new">
      <div className="ui-add-new-row">
        <input
          className="ui-add-new-input"
          autoFocus
          aria-label={`שם ה${word} החדש`}
          placeholder={placeholder}
          value={value}
          aria-invalid={problem === "duplicate"}
          onChange={(e) => { setValue(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
        />
        <button type="button" className="ui-add-new-add" disabled={!canAdd} aria-disabled={!canAdd} onClick={() => { void add(); }}>
          הוספה
        </button>
        <button type="button" className="ui-add-new-cancel" onClick={onCancel}>ביטול</button>
      </div>
      <span className={problem === "duplicate" || failed ? "ui-add-hint ui-add-hint-bad" : "ui-add-hint"}>
        {failed ? `לא הצלחנו לשמור את ה${word}.` : note}
      </span>
    </div>
  );
}

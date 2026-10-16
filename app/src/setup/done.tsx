import { Button } from "../ui/button";
import { DONE_HOME, DONE_LEAD, DONE_NOTE, DONE_TITLE } from "./copy";
import type { SetupFacts } from "./model";
import { OnboardingFrame } from "./shell";
import type { SetupStore } from "./storage";

export type DoneRow = { label: string; value: string; done: boolean; delay: number };

/**
 * The seven rows of the done card (FLOW-514 §3): each has ✓ when it is done, — when it is not, and a
 * short result. "דילגתם" when the owner skipped it. Rows fade in 60ms apart.
 */
export function buildDoneRows(input: {
  store: SetupStore;
  facts: SetupFacts;
  businessName: string;
  /** Lender picks waiting for the Loans tab (setup state only). */
  pendingLenders: number;
}): DoneRow[] {
  const { store, facts, businessName, pendingLenders } = input;
  const skipped = (key: "1" | "2" | "3" | "4" | "5" | "6" | "7") => store.skipped[key] != null;
  const row = (label: string, done: boolean, value: string, index: number): DoneRow => ({ label, value, done, delay: index * 60 });
  // Mercury and SUMIT share step 2: each row says what it found, or that the step was skipped.
  const connection = (isConnected: boolean) => (isConnected ? "מחובר" : skipped("2") ? "דילגתם" : "לא מחובר");
  const projects = facts.projectCount;
  const loans = facts.loanCount + pendingLenders;
  return [
    row("העסק", facts.companyId != null, businessName, 0),
    row("Mercury", facts.mercuryConnected, connection(facts.mercuryConnected), 1),
    row("SUMIT", facts.sumitConnected, connection(facts.sumitConnected), 2),
    row("פרויקטים", store.projects_at != null || projects > 0, projects > 0 ? String(projects) : skipped("3") ? "דילגתם" : "אין", 3),
    row(
      "הלוואות",
      store.loans_at != null || facts.loanCount > 0,
      pendingLenders > 0 ? `${String(pendingLenders)} להשלמה` : loans > 0 ? String(loans) : skipped("4") ? "דילגתם" : "אין",
      4,
    ),
    row("תיוג חכם", facts.jevSaved && store.jev_on === true, store.jev_on === true ? "פעיל" : skipped("5") ? "דילגתם" : "כבוי", 5),
    row("מסך הבית", store.installed_at != null || facts.standalone, store.installed_at != null || facts.standalone ? "מוכן" : skipped("7") ? "דילגתם" : "לא עכשיו", 6),
  ];
}

/** Done (FLOW-514): "הכל מוכן", what to expect, the seven rows, and one button to Home. */
export function SetupDone({ rows, onHome }: { rows: DoneRow[]; onHome: () => void }) {
  return (
    <OnboardingFrame
      step="done"
      title={DONE_TITLE}
      lead={DONE_LEAD}
      primary={<Button type="button" full onClick={onHome}>{DONE_HOME}</Button>}
    >
      <section className="ui-onb-card ui-onb-done" aria-label={DONE_TITLE}>
        {rows.map((item) => (
          <div key={item.label} className="ui-onb-done-row" style={{ animationDelay: `${String(item.delay)}ms` }}>
            <span className={item.done ? "ui-onb-mark ui-onb-mark-good" : "ui-onb-mark"} aria-hidden="true">{item.done ? "✓" : "—"}</span>
            <span className="ui-onb-done-label">{item.label}</span>
            <span className="t-hint">{item.value}</span>
          </div>
        ))}
      </section>
      <p className="t-hint ui-onb-note">{DONE_NOTE}</p>
    </OnboardingFrame>
  );
}

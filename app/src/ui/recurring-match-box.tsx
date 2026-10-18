import { cx } from "./cx";

/**
 * FLOW-447c: a late bill's suggested match (decision 0179), on the charge page. "אולי הגיע בשם אחר",
 * the suggested party, its amount and day, and the two answers. The name and amount are plain text.
 */
export function RecurringMatchBox({
  name,
  amount,
  date,
  income,
  onYes,
  onNo,
  className,
}: {
  /** The suggested party's name. */
  name: string;
  /** The suggested bill's amount, formatted. */
  amount: string;
  /** The bill's day, "dd/mm". */
  date: string;
  income: boolean;
  onYes: () => void;
  onNo: () => void;
  className?: string;
}) {
  return (
    <section className={cx("ui-recurring-match", className)} aria-label="אולי הגיע בשם אחר">
      <p className="ui-recurring-match-title">אולי הגיע בשם אחר</p>
      <p className="ui-recurring-match-detail">
        <bdi>{name}</bdi>
        {" · "}
        <bdi dir="ltr">{amount}</bdi>
        {" · "}
        <bdi>{date}</bdi>
      </p>
      <div className="ui-recurring-match-actions">
        <button type="button" className="ui-recurring-match-yes ui-hit" onClick={onYes}>
          {income ? "כן, אותו לקוח" : "כן, אותו ספק"}
        </button>
        <button type="button" className="ui-recurring-match-no ui-hit" onClick={onNo}>
          לא
        </button>
      </div>
    </section>
  );
}

/**
 * A late bill with no match to offer asks whether it still recurs (the board's "עדיין קבוע?"): the
 * question, what was missed, the two answers and a hint under them.
 */
export function RecurringAskBox({ text, hint, onStill, onEnded }: {
  /** What was missed, and what ending it does. */
  text: string;
  hint: string;
  onStill: () => void;
  onEnded: () => void;
}) {
  return (
    <section className="ui-recurring-match ui-recurring-askbox" aria-label="עדיין קבוע?">
      <p className="ui-recurring-askbox-title">עדיין קבוע?</p>
      <p className="ui-recurring-askbox-text">{text}</p>
      <div className="ui-recurring-match-actions">
        <button type="button" className="ui-recurring-match-yes ui-hit" onClick={onStill}>כן, עדיין קבוע</button>
        <button type="button" className="ui-recurring-match-no ui-hit" onClick={onEnded}>הסתיים</button>
      </div>
      <p className="ui-recurring-askbox-hint">{hint}</p>
    </section>
  );
}

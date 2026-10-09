import { useId, type Ref } from "react";
import { Button } from "./button";

/**
 * A quiet bordered card that asks one yes/no question (FLOW-502, option A): the question,
 * a pill כן and a text לא עכשיו. `note` replaces the buttons with one line and a single
 * dismiss, for an answer this device cannot act on yet (an iPhone tab before Home Screen).
 */
export function PromptCard({
  question,
  yesLabel = "כן",
  noLabel = "לא עכשיו",
  busy = false,
  note,
  noteDismissLabel = "הבנתי",
  yesRef,
  onYes,
  onNo,
  onNoteDismiss,
}: {
  question: string;
  yesLabel?: string;
  noLabel?: string;
  busy?: boolean;
  note?: string;
  noteDismissLabel?: string;
  yesRef?: Ref<HTMLButtonElement>;
  onYes: () => void;
  onNo: () => void;
  onNoteDismiss?: () => void;
}) {
  const questionId = useId();
  return (
    <section className="ui-prompt-card" aria-labelledby={questionId}>
      <p className="ui-prompt-question" id={questionId} dir="rtl">{question}</p>
      {note != null ? (
        <>
          <p className="ui-prompt-note t-hint" dir="rtl" role="status">{note}</p>
          <div className="ui-prompt-actions">
            <Button variant="ghost" onClick={onNoteDismiss ?? onNo}>{noteDismissLabel}</Button>
          </div>
        </>
      ) : (
        <div className="ui-prompt-actions">
          <Button variant="pill" busy={busy} buttonRef={yesRef} onClick={() => { if (!busy) onYes(); }}>{yesLabel}</Button>
          <Button variant="ghost" disabled={busy} onClick={onNo}>{noLabel}</Button>
        </div>
      )}
    </section>
  );
}

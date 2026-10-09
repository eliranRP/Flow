import { useId, type ReactNode, type Ref } from "react";
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
  dismissRef,
  onYes,
  onNo,
  onNoteDismiss,
}: {
  question: string;
  yesLabel?: string;
  noLabel?: string;
  busy?: boolean;
  /** May hold a link (the iPhone note links "למסך הבית" to the install steps). */
  note?: ReactNode;
  noteDismissLabel?: string;
  /** The note's dismiss button: the caller moves focus here when the note replaces כן. */
  dismissRef?: Ref<HTMLButtonElement>;
  onYes: () => void;
  onNo: () => void;
  onNoteDismiss?: () => void;
}) {
  const questionId = useId();
  const noteId = useId();
  return (
    <section className="ui-prompt-card" aria-labelledby={questionId}>
      <p className="ui-prompt-question" id={questionId} dir="rtl">{question}</p>
      {note != null ? (
        <>
          <p className="ui-prompt-note t-hint" id={noteId} dir="rtl">{note}</p>
          <div className="ui-prompt-actions">
            <Button variant="ghost" buttonRef={dismissRef} aria-describedby={noteId} onClick={onNoteDismiss ?? onNo}>{noteDismissLabel}</Button>
          </div>
        </>
      ) : (
        <div className="ui-prompt-actions">
          <Button variant="pill" busy={busy} onClick={() => { if (!busy) onYes(); }}>{yesLabel}</Button>
          <Button variant="ghost" disabled={busy} onClick={onNo}>{noLabel}</Button>
        </div>
      )}
    </section>
  );
}

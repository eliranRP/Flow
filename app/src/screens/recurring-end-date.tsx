import { useEffect, useRef, useState } from "react";
import { endChoiceOf, endPresets, endText, endToast, runEndDate, type EndChoice, type EndDateWrite } from "../end-date";
import { RECURRING_KEYS } from "../pace-write";
import { liveRpcClient } from "../recurring-actions";
import type { ScheduleRow } from "../recurring-schedule";
import { ChoiceSheet, type ChoiceSheetCopy } from "../ui/choice-sheet";
import { formatDisplay } from "../ui/date-math";
import { DateSheet } from "../ui/date-sheet";
import { EndDateRow } from "../ui/recurring-charge-parts";
import { useToast } from "../ui/toast";
import { topToast } from "../ui/top-toast";
import { useWrite } from "../use-write";

/** The sheet's words: the presets with their dates, the owner's own date when it is none of them, and no end. */
export function endSheetCopy(presets: ReturnType<typeof endPresets>, endsOn: string | null, choice: EndChoice): ChoiceSheetCopy<EndChoice> {
  return {
    historyKey: "charge-end",
    title: "תאריך סיום",
    note: "אחרי התאריך החיוב לא ייצפה, וכשיעבור הוא ייצא מהקבועים.",
    choices: [
      { value: "next", label: "אחרי החיוב הבא", description: formatDisplay(presets.next) },
      { value: "3m", label: "בעוד 3 חודשים", description: formatDisplay(presets["3m"]) },
      { value: "6m", label: "בעוד 6 חודשים", description: formatDisplay(presets["6m"]) },
      { value: "year", label: "בסוף השנה", description: formatDisplay(presets.year) },
      ...(choice === "custom" && endsOn != null ? [{ value: "custom" as const, label: "התאריך שבחרת", description: formatDisplay(endsOn) }] : []),
      { value: "none", label: "ללא תאריך סיום" },
    ],
  };
}

/**
 * FLOW-1266: the charge page's end date, its row and its sheets. A preset or "ללא" saves on tap; "תאריך אחר"
 * opens the date sheet, from today on. The toast's ביטול writes back the date before. A dev sample keeps the
 * date local.
 */
export function ChargeEndDate({
  row,
  lineId,
  live,
  today,
  disabled,
  blocked,
  openSheet = false,
}: {
  row: ScheduleRow;
  lineId: string | null;
  live: boolean;
  /** yyyy-mm-dd. */
  today: string;
  /** A viewer, or a live page with no line to write through. */
  disabled: boolean;
  /** A preview: the write is refused with its own toast. */
  blocked: () => boolean;
  openSheet?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(openSheet);
  const [dateOpen, setDateOpen] = useState(false);
  const [saving, setSaving] = useState<EndChoice | null>(null);
  // The date after a write, until the reads catch up (and the only date in a dev sample). undefined: none kept.
  const [local, setLocal] = useState<string | null | undefined>(undefined);
  const opener = useRef<HTMLButtonElement>(null);
  // The server's date before the last write (prior_ends_on): what ביטול writes back.
  const prior = useRef<string | null>(null);
  // "תאריך אחר" opens the date sheet once the choice sheet has closed, so their history entries do not cross.
  const wantDate = useRef(false);
  useEffect(() => {
    if (!open && wantDate.current) {
      wantDate.current = false;
      setDateOpen(true);
    }
  }, [open]);
  // A refetched row is the server's word: it replaces the date kept after a write.
  useEffect(() => {
    if (live) setLocal(undefined);
  }, [row, live]);
  const endsOn = local === undefined ? row.ends_on ?? null : local;
  const presets = endPresets(row, today);
  const choice = endChoiceOf(endsOn, presets);
  const name = row.party_name;

  const write = useWrite<EndDateWrite & { close?: () => void }>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: RECURRING_KEYS,
    place: "top",
    onSuccess: (done) => {
      setSaving(null);
      done.close?.();
      setDateOpen(false);
      if (done.undo) return;
      const back = prior.current;
      toast.show(topToast({
        message: endToast(done.next, name),
        action: "ביטול",
        onAction: () => {
          write.mutate({ ...done, close: undefined, next: back, before: done.next, undo: true });
        },
      }));
    },
    onError: () => {
      setSaving(null);
    },
    run: async (change) => {
      prior.current = live ? await runEndDate(liveRpcClient(), change) : change.before;
      setLocal(change.next);
    },
  });

  function send(next: string | null, pick: EndChoice | null, close?: () => void) {
    if (write.isPending || (live && blocked()) || (live && lineId == null)) return;
    if (pick != null) setSaving(pick);
    write.mutate({ lineId: lineId ?? "", projectId: row.project_id, next, before: endsOn, name, undo: false, close });
  }

  return (
    <>
      <EndDateRow
        text={endText(endsOn)}
        set={endsOn != null}
        disabled={disabled}
        buttonRef={opener}
        onOpen={() => {
          if (write.isPending || (live && blocked())) return;
          setOpen(true);
        }}
      />
      <ChoiceSheet
        copy={endSheetCopy(presets, endsOn, choice)}
        open={open}
        onOpenChange={setOpen}
        value={choice}
        saving={saving}
        returnFocusRef={opener}
        action={{
          label: "תאריך אחר",
          onSelect: (close) => {
            wantDate.current = true;
            close();
          },
        }}
        onPick={(next, close) => {
          if (next === "custom") {
            close();
            return;
          }
          send(next === "none" ? null : presets[next], next, close);
        }}
      />
      <DateSheet
        open={dateOpen}
        onOpenChange={setDateOpen}
        title="תאריך סיום"
        value={endsOn ?? presets.next}
        allowFuture
        shortcuts={false}
        min={today}
        applyLabel="שמירה"
        busy={write.isPending}
        onApply={(iso) => {
          send(iso, null);
        }}
      />
    </>
  );
}

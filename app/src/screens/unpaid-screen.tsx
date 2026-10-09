import { formatAmountText, type UnpaidRow } from "@flow/shared";
import { useState } from "react";
import { absAgorot } from "../agorot";
import { useHoldWrites } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { unpaidDocumentUrl, unpaidIsMarked, unpaidTotals } from "../unpaid";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useSumitStatusQuery, useUnpaidQuery } from "../use-books";
import { REFRESH_DONE, SUMIT_REFRESH_KEYS, useSumitRefresh } from "../use-sumit-refresh";
import { useSyncSettled } from "../use-sync-settled";
import { useHeldOrder } from "../list-hold";
import { assertNoError, isTransientWriteError, useWrite } from "../use-write";
import { Button } from "../ui/button";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { CheckIcon, RefreshIcon, ReviewIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";

function daysBefore(iso: string): number {
  const today = israelToday();
  const start = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const end = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function unpaidHintLine(row: UnpaidRow): string {
  const date = formatDayMonth(row.doc_date);
  const project = row.project_name ?? "";
  const age = `לפני ${String(daysBefore(row.doc_date))} ימים`;
  return [date, project, age].filter((part) => part !== "").join(" · ");
}

/** FLOW-330. The marked row's line, and the toasts of a mark and a clear. */
export const UNPAID_MARKED = "סומן כשולם · ממתין לסנכרון";
const UNPAID_MARK_DONE = "סומן כשולם. החשבונית תצא מהרשימה אחרי הסנכרון עם SUMIT.";
const UNPAID_CLEAR_DONE = "הסימון בוטל.";

export function UnpaidScreen({ sample }: { sample?: UnpaidRow[] } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const unpaid = useUnpaidQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, unpaid);
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const toast = useToast();
  // A sample (Storybook, dev routes) keeps its marks on the screen; a live mark is the server's (0133).
  const [sampleMarks, setSampleMarks] = useState<Record<string, string | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const all = (sample ?? unpaid.data ?? []).map((row) => (row.id in sampleMarks ? { ...row, marked_paid_at: sampleMarks[row.id] ?? null } : row));
  const rows = useHeldOrder(all, (row) => row.id);
  const totals = unpaidTotals(all);
  const mark = useWrite<{ id: string; paid: boolean }>({
    keys: ["unpaid"],
    failure: (error) => (isTransientWriteError(error) ? { message: "לא הצלחנו לעדכן את הסימון.", retry: true } : "לא הצלחנו לעדכן את הסימון."),
    onSuccess: ({ paid }) => {
      setBusyId(null);
      toast.show({ message: paid ? UNPAID_MARK_DONE : UNPAID_CLEAR_DONE });
    },
    run: async ({ id, paid }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_invoice_paid", { p_id: id, p_paid: paid }));
    },
  });
  // FLOW-335: after a mark the page offers the SUMIT sync that takes the marked rows out.
  const anyMarked = all.some(unpaidIsMarked);
  const sync = useSumitRefresh();
  const sumitStatus = useSumitStatusQuery(sample == null && anyMarked);
  const syncing = sync.isPending || sumitStatus.data?.syncing === true;
  useSyncSettled({
    syncing: sumitStatus.data?.syncing === true,
    pending: sync.isPending,
    lastSyncAt: sumitStatus.data?.last_sync_at,
    lastError: sumitStatus.data?.last_error,
    keys: SUMIT_REFRESH_KEYS,
    success: REFRESH_DONE,
  });
  function startSync() {
    if (holdWrites || syncing) return;
    if (sample) {
      toast.show({ message: REFRESH_DONE });
      return;
    }
    if (blocked()) return;
    sync.mutate();
  }
  function setPaid(row: UnpaidRow, paid: boolean) {
    if (holdWrites || mark.isPending) return;
    if (sample) {
      setSampleMarks((current) => ({ ...current, [row.id]: paid ? new Date().toISOString() : null }));
      toast.show({ message: paid ? UNPAID_MARK_DONE : UNPAID_CLEAR_DONE });
      return;
    }
    if (blocked()) return;
    setBusyId(row.id);
    mark.mutate({ id: row.id, paid }, { onError: () => { setBusyId(null); } });
  }
  return (
    <ScreenState
      title="חשבוניות פתוחות"
      backTo={`/${search}`}
      phase={phase.kind === "ready" && all.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void unpaid.refetch(); }}
      empty={<EmptyState icon={<ReviewIcon />} title="הכל שולם" body="אין חשבוניות פתוחות כרגע." />}
    >
      <div className="ui-page-pad">
        <p className="t-display ui-unpaid-totals">
          {totals.map((total) => (
            <bdi key={total.currency} dir="ltr">{formatAmountText(total.minor, total.currency)}</bdi>
          ))}
        </p>
        <p className="t-label text-text-secondary">לגבייה</p>
      </div>
      <List>
        {rows.map((row) => {
          const marked = unpaidIsMarked(row);
          const busy = busyId === row.id && mark.isPending;
          // FLOW-335: a row with SUMIT's document link opens it in a new tab; without one it stays still.
          const documentUrl = unpaidDocumentUrl(row);
          return (
            <ListRow
              key={row.id}
              variant="project"
              href={documentUrl ?? undefined}
              external={documentUrl != null}
              chevron={documentUrl != null}
              title={row.customer_name ?? row.description}
              hint={marked ? `${UNPAID_MARKED} · ${unpaidHintLine(row)}` : unpaidHintLine(row)}
              wrapHint
              agorot={absAgorot(row.open_gross_agorot)}
              currency={row.currency ?? "ILS"}
              loss={false}
              muted={marked}
              actionBelow
              action={holdWrites ? undefined : (
                <Button
                  variant="pill"
                  icon={marked ? undefined : <CheckIcon />}
                  busy={busy}
                  disabled={mark.isPending && !busy}
                  onClick={() => {
                    setPaid(row, !marked);
                  }}
                >
                  {busy ? (marked ? "מבטל…" : "מסמן…") : marked ? "ביטול הסימון" : "סימון כשולם"}
                </Button>
              )}
            />
          );
        })}
      </List>
      {anyMarked && !holdWrites ? (
        <List className="ui-unpaid-sync">
          <ListRow
            variant="button"
            icon={<RefreshIcon />}
            title={syncing ? "מרענן…" : "רענון מ־SUMIT"}
            hint="החשבוניות שסומנו ייצאו מהרשימה אחרי הסנכרון"
            describeHint
            wrapHint
            busy={syncing}
            onClick={startSync}
          />
        </List>
      ) : null}
    </ScreenState>
  );
}

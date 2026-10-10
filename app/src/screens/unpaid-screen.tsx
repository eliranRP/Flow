import { formatAmountText, type UnpaidRow } from "@flow/shared";
import { Fragment, useRef, useState, type ReactNode } from "react";
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
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { CheckIcon, ExternalIcon, RefreshIcon, ReviewIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { Sheet } from "../ui/sheet";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";

function daysBefore(iso: string): number {
  const today = israelToday();
  const start = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const end = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** "היום", "אתמול", "לפני יומיים", else "לפני N ימים" (FLOW-353). */
export function unpaidAge(days: number): string {
  if (days === 0) return "היום";
  if (days === 1) return "אתמול";
  if (days === 2) return "לפני יומיים";
  return `לפני ${String(days)} ימים`;
}

/**
 * FLOW-356: the hint's parts, each but the last carrying its "·" at its end, so at 320 the line
 * breaks after a separator and a wrapped line never starts with one. The date, the age and the mark
 * stay whole; a long project name may still wrap.
 */
function unpaidHint(row: UnpaidRow, marked: boolean): ReactNode {
  const parts: Array<{ text: string; whole: boolean }> = [
    ...(marked ? [{ text: UNPAID_MARKED, whole: true }] : []),
    { text: formatDayMonth(row.doc_date), whole: true },
    ...(row.project_name ? [{ text: row.project_name, whole: false }] : []),
    { text: unpaidAge(daysBefore(row.doc_date)), whole: true },
  ];
  return parts.map((part, index) => {
    const text = index === parts.length - 1 ? part.text : `${part.text}\u00A0·`;
    return (
      <Fragment key={index}>
        {index === 0 ? null : " "}
        {part.whole ? <span className="ui-nowrap">{text}</span> : text}
      </Fragment>
    );
  });
}

/** FLOW-330. The marked row's line, and the toasts of a mark and a clear. */
export const UNPAID_MARKED = "סומן כשולם · ממתין לסנכרון";
const UNPAID_MARK_DONE = "סומן כשולם. החשבונית תצא מהרשימה אחרי הסנכרון עם SUMIT.";
const UNPAID_CLEAR_DONE = "הסימון בוטל.";

/** FLOW-357 (owner's pick A): a row says only how old the invoice is, or that it waits for the sync. */
function unpaidRowHint(row: UnpaidRow, marked: boolean): string {
  return marked ? UNPAID_MARKED : unpaidAge(daysBefore(row.doc_date));
}

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
  // FLOW-357: a tap on a row opens that invoice's sheet; its main action marks it paid.
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const setInvoiceSheet = useSheetHistory("unpaid-invoice", sheetOpen, setSheetOpen);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnRef = useRef<HTMLButtonElement | null>(null);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const all = (sample ?? unpaid.data ?? []).map((row) => (row.id in sampleMarks ? { ...row, marked_paid_at: sampleMarks[row.id] ?? null } : row));
  const rows = useHeldOrder(all, (row) => row.id);
  const totals = unpaidTotals(all);
  const mark = useWrite<{ id: string; paid: boolean }>({
    keys: ["unpaid"],
    failure: (error) => (isTransientWriteError(error) ? { message: "לא הצלחנו לעדכן את הסימון.", retry: true } : "לא הצלחנו לעדכן את הסימון."),
    onSuccess: ({ id, paid }) => {
      setBusyId(null);
      // Close only the invoice that was marked, not one opened while the write saved.
      if (openIdRef.current === id) setInvoiceSheet(false);
      showDone(id, paid);
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
  /** A mark's toast offers ביטול, which clears the mark again with the latest render's setPaid (the toast outlives the render). */
  function showDone(id: string, paid: boolean) {
    toast.show(paid
      ? { message: UNPAID_MARK_DONE, action: "ביטול", onAction: () => { setPaidRef.current(id, false); } }
      : { message: UNPAID_CLEAR_DONE });
  }
  function setPaid(id: string, paid: boolean) {
    if (holdWrites || mark.isPending) return;
    if (sample) {
      setSampleMarks((current) => ({ ...current, [id]: paid ? new Date().toISOString() : null }));
      setInvoiceSheet(false);
      showDone(id, paid);
      return;
    }
    if (blocked()) return;
    setBusyId(id);
    mark.mutate({ id, paid }, { onError: () => { setBusyId(null); } });
  }
  const setPaidRef = useRef(setPaid);
  setPaidRef.current = setPaid;
  function openInvoice(id: string) {
    returnRef.current = rowRefs.current.get(id) ?? null;
    setOpenId(id);
    setInvoiceSheet(true);
  }
  const openRow = all.find((row) => row.id === openId) ?? null;
  const openMarked = openRow != null && unpaidIsMarked(openRow);
  const openBusy = openRow != null && busyId === openRow.id && mark.isPending;
  const openUrl = openRow == null ? null : unpaidDocumentUrl(openRow);
  return (
    <ScreenState
      title="חשבוניות פתוחות"
      backTo={`/${search}`}
      phase={phase.kind === "ready" && all.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void unpaid.refetch(); }}
      empty={<EmptyState icon={<ReviewIcon />} title="הכל שולם" body="אין חשבוניות פתוחות כרגע." />}
    >
      {/* FLOW-357: one invoice shows its amount on its row only, so the head is the title alone. */}
      {all.length > 1 ? (
        <div className="ui-page-pad">
          <p className="t-display ui-unpaid-totals">
            {totals.map((total) => (
              <bdi key={total.currency} dir="ltr">{formatAmountText(total.minor, total.currency)}</bdi>
            ))}
          </p>
          <p className="t-label text-text-secondary">לגבייה</p>
        </div>
      ) : null}
      <List className="ui-list-wrap-title">
        {rows.map((row) => {
          const marked = unpaidIsMarked(row);
          return (
            <ListRow
              key={row.id}
              variant="project"
              onClick={() => { openInvoice(row.id); }}
              buttonRef={(node) => {
                if (node) rowRefs.current.set(row.id, node);
                else rowRefs.current.delete(row.id);
              }}
              chevron
              title={row.customer_name ?? row.description}
              hint={unpaidRowHint(row, marked)}
              agorot={absAgorot(row.open_gross_agorot)}
              currency={row.currency ?? "ILS"}
              loss={false}
              muted={marked}
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
      <Sheet
        open={sheetOpen}
        onOpenChange={setInvoiceSheet}
        title={openRow == null ? "חשבונית" : openRow.customer_name ?? openRow.description}
        returnFocusRef={returnRef}
        onClosed={() => { setOpenId(null); }}
        action={openRow == null || holdWrites ? undefined : (
          <Button
            full
            variant={openMarked ? "secondary" : undefined}
            icon={openMarked ? undefined : <CheckIcon />}
            busy={openBusy}
            onClick={() => { setPaid(openRow.id, !openMarked); }}
          >
            {openBusy ? (openMarked ? "מבטל…" : "מסמן…") : openMarked ? "ביטול הסימון" : "סימון כשולם"}
          </Button>
        )}
      >
        {openRow == null ? null : (
          <div className="ui-unpaid-sheet">
            <p className="t-display">
              <bdi dir="ltr">{formatAmountText(absAgorot(openRow.open_gross_agorot), openRow.currency ?? "ILS")}</bdi>
            </p>
            <p className="t-label text-text-secondary">{unpaidHint(openRow, openMarked)}</p>
            {openUrl != null ? (
              <TextLink href={openUrl} external chevron={false} trailing={<ExternalIcon />}>
                פתיחת החשבונית
              </TextLink>
            ) : null}
          </div>
        )}
      </Sheet>
    </ScreenState>
  );
}

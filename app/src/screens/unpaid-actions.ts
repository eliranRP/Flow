import { useRef, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useSumitStatusQuery, useUnpaidQuery } from "../use-books";
import { REFRESH_DONE, useSumitRefresh } from "../use-sumit-refresh";
import { useSyncSettled } from "../use-sync-settled";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, isTransientWriteError, useWrite } from "../use-write";
import { unpaidIsMarked, unpaidOpenRows, type UnpaidInvoice, type UnpaidSummary } from "../unpaid";
import { useToast } from "../ui/toast";
import type { ToastInput } from "../ui/toast-layout";
import { useBlockedPreview } from "./screen-shared";
import { useHeldOrder } from "../list-hold";

/** FLOW-330, FLOW-367. The row's line while a mark waits for the next SUMIT sync. */
export const UNPAID_MARKED = "סומן כשולם · ממתין לסנכרון";
const UNPAID_MARK_DONE = "סומן כשולם";
const UNPAID_CLEAR_DONE = "הסימון בוטל.";
const UNPAID_LINKED = "החשבונית חוברה לתשלום ויצאה מהרשימה";
const UNPAID_DISMISSED = "נסמן ידנית, או נחכה לתשלום אחר";
const UNPAID_LINK_FAILED = "לא הצלחנו לחבר את התשלום.";
const UNPAID_DISMISS_FAILED = "לא הצלחנו לשמור את ההחלטה.";
const UNPAID_UNDISMISSED = "התשלום מוצע שוב";
const UNPAID_UNDISMISS_FAILED = "לא הצלחנו לבטל. ייתכן שהחשבונית השתנתה בינתיים.";

/** Decision 0218: on the invoice pages an undo stays 5s and a plain note 4s. */
export const UNPAID_UNDO_MS = 5000;
const UNPAID_NOTE_MS = 4000;

/** An invoice toast: under the header (decision 0218), the undo 5s and a note 4s. */
export function unpaidToast(input: ToastInput): ToastInput {
  return { durationMs: input.action == null ? UNPAID_NOTE_MS : UNPAID_UNDO_MS, ...input, place: "top" };
}

type LocalState = { marked: string | null; gone: boolean; match: boolean };

export function useUnpaidActions(sample?: UnpaidInvoice[], summary?: UnpaidSummary) {
  const preview = useHomePreview();
  const unpaid = useUnpaidQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, unpaid);
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const toast = useToast();
  const [local, setLocal] = useState<Record<string, LocalState>>({});
  const live: UnpaidInvoice[] = sample ?? (unpaid.data ?? []);
  const all = live
    .filter((row) => !(local[row.id]?.gone ?? false))
    .map((row) => {
      const state = local[row.id];
      if (state == null) return row;
      return { ...row, marked_paid_at: state.marked ?? row.marked_paid_at ?? null, match: state.match ? null : row.match };
    });
  const rows = useHeldOrder(all, (row) => row.id);

  const mark = useWrite<{ id: string; paid: boolean; undoable: boolean }>({
    place: "top",
    keys: ["unpaid"],
    failure: (error) => (isTransientWriteError(error) ? { message: "לא הצלחנו לעדכן את הסימון.", retry: true } : "לא הצלחנו לעדכן את הסימון."),
    // The row takes its mark at once; the server's time replaces this one on the refresh (decision 0180).
    optimistic: ({ id, paid }) => [{
      key: ["unpaid", preview],
      update: (old: unknown) => (Array.isArray(old)
        ? (old as UnpaidInvoice[]).map((row) => (row.id === id ? { ...row, marked_paid_at: paid ? new Date().toISOString() : null } : row))
        : old),
    }],
    onSuccess: ({ id, paid, undoable }) => { showDone(id, paid, undoable); },
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
    success: REFRESH_DONE,
  });

  /**
   * A mark's toast offers ביטול, and so does clearing one (FLOW-968): each puts the other state back with the
   * latest render's setPaid (the toast outlives the render). The ביטול's own toast offers no further undo.
   */
  function showDone(id: string, paid: boolean, undoable = true) {
    const message = paid ? UNPAID_MARK_DONE : UNPAID_CLEAR_DONE;
    toast.show(unpaidToast(undoable
      ? { message, action: "ביטול", onAction: () => { setPaidRef.current(id, !paid, false); } }
      : { message }));
  }

  function setPaid(id: string, paid: boolean, undoable = true) {
    if (holdWrites) return;
    if (sample) {
      setLocal((current) => ({ ...current, [id]: { gone: false, match: current[id]?.match ?? false, marked: paid ? new Date().toISOString() : null } }));
      showDone(id, paid, undoable);
      return;
    }
    if (blocked()) return;
    mark.mutate({ id, paid, undoable });
  }
  const setPaidRef = useRef(setPaid);
  setPaidRef.current = setPaid;

  // FLOW-367: "זה התשלום" links the invoice to the deposit (the row leaves the list); "לא זה" dismisses that one pairing.
  const link = useWrite<{ id: string; transaction: string }>({
    place: "top",
    keys: ["unpaid"],
    failure: (error) => (isTransientWriteError(error) ? { message: UNPAID_LINK_FAILED, retry: true } : UNPAID_LINK_FAILED),
    optimistic: ({ id }) => [{
      key: ["unpaid", preview],
      update: (old: unknown) => (Array.isArray(old) ? (old as UnpaidInvoice[]).filter((row) => row.id !== id) : old),
    }],
    onSuccess: () => { toast.show(unpaidToast({ message: UNPAID_LINKED })); },
    run: async ({ id, transaction }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("link_invoice_payment", { p_invoice: id, p_transaction: transaction }));
    },
  });

  // The time each dismissal was written, for its ביטול (the write returns it; useWrite's run returns nothing).
  const dismissedAt = useRef(new Map<string, string>());
  const dismiss = useWrite<{ id: string; transaction: string }>({
    place: "top",
    keys: ["unpaid"],
    failure: (error) => (isTransientWriteError(error) ? { message: UNPAID_DISMISS_FAILED, retry: true } : UNPAID_DISMISS_FAILED),
    optimistic: ({ id }) => [{
      key: ["unpaid", preview],
      update: (old: unknown) => (Array.isArray(old)
        ? (old as UnpaidInvoice[]).map((row) => (row.id === id ? { ...row, match: null } : row))
        : old),
    }],
    // FLOW-968: "לא זה" can be taken back for 5s; the ביטול takes back only the dismissal this tap wrote.
    onSuccess: ({ id, transaction }) => {
      const at = dismissedAt.current.get(`${id}:${transaction}`);
      toast.show(unpaidToast(at == null
        ? { message: UNPAID_DISMISSED }
        : { message: UNPAID_DISMISSED, action: "ביטול", onAction: () => { undismissRef.current({ id, transaction, at }); } }));
    },
    run: async ({ id, transaction }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.rpc("dismiss_invoice_match", { p_invoice: id, p_transaction: transaction });
      assertNoError(result);
      const at = (result.data as { dismissed_at?: unknown } | null)?.dismissed_at;
      if (typeof at === "string") dismissedAt.current.set(`${id}:${transaction}`, at);
    },
  });

  const undismiss = useWrite<{ id: string; transaction: string; at: string }>({
    place: "top",
    keys: ["unpaid"],
    failure: UNPAID_UNDISMISS_FAILED,
    onSuccess: () => { toast.show(unpaidToast({ message: UNPAID_UNDISMISSED })); },
    run: async ({ id, transaction, at }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("undismiss_invoice_match", { p_invoice: id, p_transaction: transaction, p_dismissed_at: at }));
    },
  });
  const undismissRef = useRef(undismiss.mutate);
  undismissRef.current = undismiss.mutate;

  function linkMatch(id: string) {
    const transaction = all.find((row) => row.id === id)?.match?.transaction_id;
    if (holdWrites || transaction == null) return;
    if (sample) {
      setLocal((current) => ({ ...current, [id]: { marked: null, gone: true, match: false } }));
      toast.show(unpaidToast({ message: UNPAID_LINKED }));
      return;
    }
    if (blocked()) return;
    link.mutate({ id, transaction });
  }

  function dismissMatch(id: string) {
    const transaction = all.find((row) => row.id === id)?.match?.transaction_id;
    if (holdWrites || transaction == null) return;
    if (sample) {
      setLocal((current) => ({ ...current, [id]: { marked: current[id]?.marked ?? null, gone: false, match: true } }));
      toast.show(unpaidToast({
        message: UNPAID_DISMISSED,
        action: "ביטול",
        onAction: () => {
          setLocal((current) => ({ ...current, [id]: { marked: current[id]?.marked ?? null, gone: false, match: false } }));
          toast.show(unpaidToast({ message: UNPAID_UNDISMISSED }));
        },
      }));
      return;
    }
    if (blocked()) return;
    dismiss.mutate({ id, transaction });
  }

  function startSync() {
    if (holdWrites || syncing) return;
    if (sample) {
      toast.show(unpaidToast({ message: REFRESH_DONE }));
      return;
    }
    if (blocked()) return;
    sync.mutate();
  }

  return {
    phase,
    rows,
    all,
    open: unpaidOpenRows(all),
    summary,
    holdWrites,
    anyMarked,
    syncing,
    lastSyncAt: summary?.last_sync_at ?? sumitStatus.data?.last_sync_at ?? null,
    /** When the list on screen was read (the offline line), unless it is a fixture. */
    readAt: sample == null ? unpaid.dataUpdatedAt || undefined : undefined,
    retry: () => { void unpaid.refetch(); },
    setPaid,
    linkMatch,
    dismissMatch,
    startSync,
  };
}

import { useRef, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { useSumitStatusQuery, useUnpaidQuery } from "../use-books";
import { REFRESH_DONE, SUMIT_REFRESH_KEYS, useSumitRefresh } from "../use-sumit-refresh";
import { useSyncSettled } from "../use-sync-settled";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, isTransientWriteError, useWrite } from "../use-write";
import { unpaidIsMarked, unpaidOpenRows, type UnpaidInvoice, type UnpaidSummary } from "../unpaid";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";
import { useHeldOrder } from "../list-hold";

/** FLOW-330, FLOW-367. The row's line while a mark waits for the next SUMIT sync. */
export const UNPAID_MARKED = "סומן כשולם · ממתין לסנכרון";
export const UNPAID_MARK_DONE = "סומן כשולם";
export const UNPAID_CLEAR_DONE = "הסימון בוטל.";
export const UNPAID_LINKED = "החשבונית חוברה לתשלום ויצאה מהרשימה";
export const UNPAID_DISMISSED = "נסמן ידנית, או נחכה לתשלום אחר";

type LocalState = { marked: string | null; gone: boolean; match: boolean };

type RpcResult = { error: { message: string; code?: string } | null };

/**
 * link_invoice_payment and dismiss_invoice_match come with 367-server, so the generated types do not
 * have them yet. No row carries a match until that server part ships, so no tap reaches these calls.
 */
function untypedRpc(name: "link_invoice_payment" | "dismiss_invoice_match", args: Record<string, string>): Promise<RpcResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const client = supabase as unknown as { rpc: (fn: string, params: Record<string, string>) => Promise<RpcResult> };
  return client.rpc(name, args);
}

/**
 * The open invoices and every write on them: a mark (cash, cheque), the link to a bank deposit, and
 * "לא זה". A sample (Storybook, dev routes) keeps its state here; a live row takes its change in the
 * query cache at once and the server's answer replaces it on the refresh (decision 0180).
 */
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

  const mark = useWrite<{ id: string; paid: boolean }>({
    keys: ["unpaid"],
    failure: (error) => (isTransientWriteError(error) ? { message: "לא הצלחנו לעדכן את הסימון.", retry: true } : "לא הצלחנו לעדכן את הסימון."),
    // The row takes its mark at once; the server's time replaces this one on the refresh (decision 0180).
    optimistic: ({ id, paid }) => [{
      key: ["unpaid", preview],
      update: (old: unknown) => (Array.isArray(old)
        ? (old as UnpaidInvoice[]).map((row) => (row.id === id ? { ...row, marked_paid_at: paid ? new Date().toISOString() : null } : row))
        : old),
    }],
    onSuccess: ({ id, paid }) => { showDone(id, paid); },
    run: async ({ id, paid }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_invoice_paid", { p_id: id, p_paid: paid }));
    },
  });

  const link = useWrite<{ id: string; transaction: string }>({
    keys: ["unpaid"],
    failure: "לא הצלחנו לחבר את התשלום.",
    optimistic: ({ id }) => [{
      key: ["unpaid", preview],
      update: (old: unknown) => (Array.isArray(old) ? (old as UnpaidInvoice[]).filter((row) => row.id !== id) : old),
    }],
    onSuccess: () => { toast.show({ message: UNPAID_LINKED }); },
    run: async ({ id, transaction }) => {
      assertNoError(await untypedRpc("link_invoice_payment", { p_invoice: id, p_transaction: transaction }));
    },
  });

  const dismiss = useWrite<{ id: string; transaction: string }>({
    keys: ["unpaid"],
    failure: "לא הצלחנו לשמור את התשובה.",
    optimistic: ({ id }) => [{
      key: ["unpaid", preview],
      update: (old: unknown) => (Array.isArray(old)
        ? (old as UnpaidInvoice[]).map((row) => (row.id === id ? { ...row, match: null } : row))
        : old),
    }],
    onSuccess: () => { toast.show({ message: UNPAID_DISMISSED }); },
    run: async ({ id, transaction }) => {
      assertNoError(await untypedRpc("dismiss_invoice_match", { p_invoice: id, p_transaction: transaction }));
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

  /** A mark's toast offers ביטול, which clears the mark again with the latest render's setPaid (the toast outlives the render). */
  function showDone(id: string, paid: boolean) {
    toast.show(paid
      ? { message: UNPAID_MARK_DONE, action: "ביטול", onAction: () => { setPaidRef.current(id, false); } }
      : { message: UNPAID_CLEAR_DONE });
  }

  function setPaid(id: string, paid: boolean) {
    if (holdWrites) return;
    if (sample) {
      setLocal((current) => ({ ...current, [id]: { gone: false, match: current[id]?.match ?? false, marked: paid ? new Date().toISOString() : null } }));
      showDone(id, paid);
      return;
    }
    if (blocked()) return;
    mark.mutate({ id, paid });
  }
  const setPaidRef = useRef(setPaid);
  setPaidRef.current = setPaid;

  function linkMatch(id: string, transaction: string) {
    if (holdWrites) return;
    if (sample) {
      setLocal((current) => ({ ...current, [id]: { marked: null, gone: true, match: false } }));
      toast.show({ message: UNPAID_LINKED });
      return;
    }
    if (blocked()) return;
    link.mutate({ id, transaction });
  }

  function dismissMatch(id: string, transaction: string) {
    if (holdWrites) return;
    if (sample) {
      setLocal((current) => ({ ...current, [id]: { marked: current[id]?.marked ?? null, gone: false, match: true } }));
      toast.show({ message: UNPAID_DISMISSED });
      return;
    }
    if (blocked()) return;
    dismiss.mutate({ id, transaction });
  }

  function startSync() {
    if (holdWrites || syncing) return;
    if (sample) {
      toast.show({ message: REFRESH_DONE });
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
    retry: () => { void unpaid.refetch(); },
    setPaid,
    linkMatch,
    dismissMatch,
    startSync,
  };
}

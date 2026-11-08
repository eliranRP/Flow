import type { TransactionDetail } from "@flow/shared";
import { createContext, useState, type ReactNode } from "react";

/**
 * The list a card was opened from: its rows in the order shown, and its address. `total` is the
 * list's full row count when the screen knows it and has not loaded every row (FLOW-314).
 */
export type TxnList = { ids: readonly string[]; from: string; total?: number };

/** Ids on each side of the opened row. A longer list sends a window around it. */
const SIDE = 250;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Location state for a row link. The ids are a snapshot, so a refetch never reshuffles the walk. */
export function txnListState(ids: readonly string[], id: string, from: string, total?: number): { txnList: TxnList } {
  const known = total == null ? {} : { total };
  // Every row of a list up to the window's size shares the one array: no copy per row.
  if (ids.length <= SIDE * 2 + 1) return { txnList: { ids, from, ...known } };
  const at = ids.indexOf(id);
  const start = at > SIDE ? at - SIDE : 0;
  return { txnList: { ids: ids.slice(start, start + SIDE * 2 + 1), from, ...known } };
}

export function readTxnList(state: unknown): TxnList | null {
  if (!isRecord(state) || !isRecord(state.txnList)) return null;
  const { ids, from, total } = state.txnList;
  if (!Array.isArray(ids) || typeof from !== "string") return null;
  if (!ids.every((id): id is string => typeof id === "string" && id !== "")) return null;
  return typeof total === "number" && Number.isInteger(total) && total > 0 ? { ids, from, total } : { ids, from };
}

/**
 * FLOW-314: a swiped-to card slides in once. The browser entry drops `txnEnter` after
 * that, so Back from a pushed screen or a reload shows the card in place. The router's
 * in-memory location keeps it, which is fine: a re-render does not restart the animation
 * (a remount of the card on the same entry would, and none does today).
 */
export function dropTxnEnter(): void {
  const state: unknown = window.history.state;
  if (!isRecord(state) || !isRecord(state.usr) || !("txnEnter" in state.usr)) return;
  const { txnEnter: _played, ...usr } = state.usr;
  window.history.replaceState({ ...state, usr }, "");
}

/** The name a row goes by: its supplier, else its customer, else its bank description. */
export function txnParty(row: Pick<NonNullable<TransactionDetail>, "supplier_name" | "customer_name" | "description">): string {
  return row.supplier_name ?? row.customer_name ?? row.description;
}

export const AnnounceContext = createContext<(text: string) => void>(() => undefined);

/** One polite status outside the card, so it survives the card's remount on each move. */
export function TxnAnnouncer({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  return (
    <AnnounceContext.Provider value={setText}>
      {children}
      <p className="sr-only" role="status">{text}</p>
    </AnnounceContext.Provider>
  );
}

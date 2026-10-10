import { useQueryClient } from "@tanstack/react-query";
import type { TransactionDetail } from "@flow/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useHomePreview } from "./preview";
import { transactionQueryOptions } from "./use-books";
import { scrollPageToTop, sheetStack } from "./ui/back";
import { TxnStepRow } from "./ui/txn-step-row";
import { grownIds, useTxnListMoreFor } from "./txn-list-more";

/** The list a card was opened from: its rows in the order shown, and its address. */
export type TxnList = { ids: readonly string[]; from: string };

type Via = "next" | "prev" | "key" | "swipe";

/** Ids on each side of the opened row. A longer list sends a window around it. */
const SIDE = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Location state for a row link. The ids are a snapshot, so a refetch never reshuffles the walk. */
export function txnListState(ids: readonly string[], id: string, from: string): { txnList: TxnList } {
  // Every row of a list up to the window's size shares the one array: no copy per row.
  if (ids.length <= SIDE * 2 + 1) return { txnList: { ids, from } };
  const at = ids.indexOf(id);
  const start = at > SIDE ? at - SIDE : 0;
  return { txnList: { ids: ids.slice(start, start + SIDE * 2 + 1), from } };
}

export function readTxnList(state: unknown): TxnList | null {
  if (!isRecord(state) || !isRecord(state.txnList)) return null;
  const { ids, from } = state.txnList;
  if (!Array.isArray(ids) || typeof from !== "string") return null;
  if (!ids.every((id): id is string => typeof id === "string" && id !== "")) return null;
  return { ids, from };
}

function readVia(state: unknown): Via | null {
  if (!isRecord(state)) return null;
  const via = state.txnVia;
  return via === "next" || via === "prev" || via === "key" || via === "swipe" ? via : null;
}

/** FLOW-314: the side a swiped-to card enters from. */
function readEnter(state: unknown): "next" | "prev" | null {
  if (!isRecord(state)) return null;
  return state.txnEnter === "next" || state.txnEnter === "prev" ? state.txnEnter : null;
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

export type TxnNav = {
  list: TxnList;
  index: number;
  total: number;
  prev: string | null;
  next: string | null;
  /** How this card was reached: a button keeps focus on it, any move is announced. */
  via: Via | null;
  /** Set when a swipe opened this card: the direction it moved. */
  enter: "next" | "prev" | null;
  move: (direction: "next" | "prev", via: Via) => void;
  /** FLOW-314: the last loaded row of a paged list with another page: ˅ loads it. */
  canLoadNext: boolean;
  /** FLOW-314: that page is loading; the card stays put. */
  loadingNext: boolean;
};

/** Prev and next for a card opened from a list. Null for a deep link or a one-row list. */
export function useTxnNav(transactionId: string): TxnNav | null {
  const location = useLocation();
  const navigate = useNavigate();
  const sent = readTxnList(location.state);
  // FLOW-314: a paged list's next page, loaded from the card, joins the walk after its last row.
  const more = useTxnListMoreFor(sent?.from ?? null, sent?.ids ?? []);
  const extra = more?.extra;
  const list = useMemo(() => {
    if (sent == null) return null;
    const ids = grownIds(sent.ids, extra ?? []);
    return ids === sent.ids ? sent : { ids, from: sent.from };
  }, [sent, extra]);
  const index = list == null ? -1 : list.ids.indexOf(transactionId);
  const prev = list != null && index > 0 ? list.ids[index - 1] ?? null : null;
  const next = list != null && index >= 0 ? list.ids[index + 1] ?? null : null;
  const canLoad = list != null && index >= 0 && next == null && more?.more === true;
  // ˅ pressed while the next page loads: the card moves once it is in.
  const [waiting, setWaiting] = useState(false);
  // The URL changes before the next card renders. A second press in between still
  // sees this card's neighbours, so it would only replace the same target again
  // under a fresh history key; one move per card keeps that from happening.
  // No test can tell the two apart, which is why this guard has none.
  const movedFrom = useRef<string | null>(null);
  const loadMore = more?.loadMore;
  const move = useCallback((direction: "next" | "prev", via: Via) => {
    const target = direction === "next" ? next : prev;
    if (target == null && direction === "next" && canLoad && via !== "swipe") {
      setWaiting(true);
      void loadMore?.().then(() => {
        setWaiting(false);
      });
      return;
    }
    if (list == null || target == null || movedFrom.current === transactionId) return;
    movedFrom.current = transactionId;
    // The list goes on as the card holds it, a loaded page included, sent as a window around the target.
    const walk = list === sent ? list : txnListState(list.ids, target, list.from).txnList;
    // Replace, so Back pops straight to the list at its saved scroll spot.
    void navigate(`/transactions/${target}${location.search}`, {
      replace: true,
      state: via === "swipe" ? { txnList: walk, txnVia: via, txnEnter: direction } : { txnList: walk, txnVia: via },
    });
    scrollPageToTop();
  }, [list, sent, next, prev, canLoad, loadMore, navigate, location.search, transactionId]);
  // The page landed while ˅ waited: go on to the first new row.
  useEffect(() => {
    if (waiting && next != null) {
      setWaiting(false);
      move("next", "next");
    }
  }, [waiting, next, move]);
  const enter = readEnter(location.state);
  useEffect(() => {
    if (enter != null) dropTxnEnter();
  }, [enter, location.key]);
  if (list == null || index < 0 || (list.ids.length < 2 && !canLoad)) return null;
  return {
    list,
    index,
    total: list.ids.length,
    prev,
    next,
    via: readVia(location.state),
    enter,
    move,
    canLoadNext: canLoad,
    loadingNext: more != null && canLoad && more.loading,
  };
}

/**
 * FLOW-314: at the last loaded row of a paged list, read the next page once the card is ready, so
 * ˅ and a swipe usually find the next row already there.
 */
export function usePrefetchNextPage(transactionId: string, ready: boolean): void {
  const location = useLocation();
  const sent = readTxnList(location.state);
  const from = sent?.from ?? null;
  const more = useTxnListMoreFor(from, sent?.ids ?? []);
  const ids = sent == null ? [] : grownIds(sent.ids, more?.extra ?? []);
  const want = more?.more === true && ids.at(-1) === transactionId;
  const load = useRef(more?.loadMore);
  load.current = more?.loadMore;
  // Once per card and list: a failed read is not retried here, ˅ tries again.
  useEffect(() => {
    if (ready && want) void load.current?.();
  }, [ready, want, from, transactionId]);
}

/** Warm the neighbours' reads once the card is ready. */
export function usePrefetchNeighbours(nav: TxnNav | null, ready: boolean): void {
  const client = useQueryClient();
  const preview = useHomePreview();
  const prev = nav?.prev ?? null;
  const next = nav?.next ?? null;
  useEffect(() => {
    if (!ready || preview !== "off") return;
    for (const id of [prev, next]) {
      if (id == null) continue;
      // A fresh neighbour is not read again. A failed read shows on that card, not here.
      client.query({ ...transactionQueryOptions(preview, id), staleTime: 30_000 }).catch(() => undefined);
    }
  }, [client, preview, ready, prev, next]);
}

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, [contenteditable='true']") != null;
}

/**
 * ArrowLeft goes to the next card and ArrowRight to the previous one, the way a
 * right-to-left page moves forward. Not inside a field or while a sheet is open.
 */
export function useTxnNavKeys(nav: TxnNav | null): void {
  const location = useLocation();
  const open = sheetStack(location.state).length > 0;
  const move = nav?.move;
  useEffect(() => {
    if (move == null || open) return;
    function onKey(event: KeyboardEvent) {
      // A held key would open a card per repeat, each with its own read and announcement.
      if (event.repeat) return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (editableTarget(event.target)) return;
      if (document.querySelector("[role='dialog']") != null) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move?.("next", "key");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        move?.("prev", "key");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [move, open]);
}

/** The name a row goes by: its supplier, else its customer, else its bank description. */
export function txnParty(row: Pick<NonNullable<TransactionDetail>, "supplier_name" | "customer_name" | "description">): string {
  return row.supplier_name ?? row.customer_name ?? row.description;
}

/** Focus may move to the row only from where a card move leaves it: nowhere, the screen title, or the row. */
function focusIsFree(row: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (active == null || active === document.body) return true;
  if (active.classList.contains("ui-focus-title")) return true;
  return row?.contains(active) ?? false;
}

/**
 * FLOW-345 option D: the step row (ui/txn-step-row) wired to the walk. A button move keeps focus on the
 * pressed word on the next card; at an end, where that word is hidden, focus waits on the counter
 * instead. Focus that has gone elsewhere (a field, a sheet) is left alone. `ready` turns true when a
 * card that was loading shows: its title takes focus then, and the pressed word takes it back.
 */
export function TxnStepNav({ nav, ready = true }: { nav: TxnNav; ready?: boolean }) {
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const via = nav.via;
  const atStart = nav.prev == null;
  // A list with a next page to load has no end yet: ˅ stays, and shows busy while the page loads.
  const atEnd = nav.next == null && !nav.canLoadNext;
  useEffect(() => {
    // Runs after the title takes focus, so a button move keeps the finger's place.
    if (via !== "next" && via !== "prev") return;
    const count = countRef.current;
    if (!focusIsFree(count?.closest<HTMLElement>(".ui-txn-step") ?? null)) return;
    const hidden = via === "next" ? atEnd : atStart;
    const target = hidden ? count : via === "next" ? nextRef.current : prevRef.current;
    target?.focus({ preventScroll: true });
  }, [via, atStart, atEnd, ready]);
  const move = nav.move;
  return (
    <TxnStepRow
      index={nav.index + 1}
      total={nav.total}
      atStart={atStart}
      atEnd={atEnd}
      prevRef={prevRef}
      nextRef={nextRef}
      countRef={countRef}
      onPrev={() => { move("prev", "prev"); }}
      onNext={() => { move("next", "next"); }}
      nextBusy={nav.loadingNext}
    />
  );
}

/**
 * FLOW-345: the neighbour's name for the edge that peeks in mid-swipe, read from the cache the
 * neighbour prefetch warms. It only watches the cache: it never fetches and never adds an entry
 * (not even for a list end), so it stays null until that read lands (the edge is then plain).
 */
export function useNeighbourParty(id: string | null): string | null {
  const client = useQueryClient();
  const preview = useHomePreview();
  const cache = client.getQueryCache();
  const subscribe = useCallback((onChange: () => void) => cache.subscribe(onChange), [cache]);
  const txn = useSyncExternalStore(subscribe, () =>
    id == null ? undefined : client.getQueryData<TransactionDetail>(transactionQueryOptions(preview, id).queryKey));
  return txn == null ? null : txnParty(txn);
}

const AnnounceContext = createContext<(text: string) => void>(() => undefined);

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

/** Says where the card sits in the list once it is ready, only after a move. */
export function useAnnounceTxn(nav: TxnNav | null, text: string | null): void {
  const announce = useContext(AnnounceContext);
  const moved = nav?.via != null;
  const position = nav == null ? "" : `תנועה ${String(nav.index + 1)} מתוך ${String(nav.total)}`;
  useEffect(() => {
    if (!moved || text == null) return;
    announce(`${position}. ${text}`);
  }, [announce, moved, position, text]);
}

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useHomePreview } from "./preview";
import { transactionQueryOptions } from "./use-books";
import { scrollPageToTop, sheetStack } from "./ui/back";
import { IconButton } from "./ui/icon-button";
import { ChevronDownIcon, ChevronUpIcon } from "./ui/icons";

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
};

/** Prev and next for a card opened from a list. Null for a deep link or a one-row list. */
export function useTxnNav(transactionId: string): TxnNav | null {
  const location = useLocation();
  const navigate = useNavigate();
  const list = readTxnList(location.state);
  const index = list == null ? -1 : list.ids.indexOf(transactionId);
  const prev = list != null && index > 0 ? list.ids[index - 1] ?? null : null;
  const next = list != null && index >= 0 ? list.ids[index + 1] ?? null : null;
  // The URL changes before the next card renders. A second press in between still
  // sees this card's neighbours, so it would only replace the same target again
  // under a fresh history key; one move per card keeps that from happening.
  // No test can tell the two apart, which is why this guard has none.
  const movedFrom = useRef<string | null>(null);
  const move = useCallback((direction: "next" | "prev", via: Via) => {
    const target = direction === "next" ? next : prev;
    if (list == null || target == null || movedFrom.current === transactionId) return;
    movedFrom.current = transactionId;
    // Replace, so Back pops straight to the list at its saved scroll spot.
    void navigate(`/transactions/${target}${location.search}`, {
      replace: true,
      state: via === "swipe" ? { txnList: list, txnVia: via, txnEnter: direction } : { txnList: list, txnVia: via },
    });
    scrollPageToTop();
  }, [list, next, prev, navigate, location.search, transactionId]);
  if (list == null || index < 0 || list.ids.length < 2) return null;
  return { list, index, total: list.ids.length, prev, next, via: readVia(location.state), enter: readEnter(location.state), move };
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

/** ˄ ˅ in the card's top bar. At a list end the button stays, marked unavailable. */
export function TxnNavButtons({ nav }: { nav: TxnNav }) {
  const hintId = useId();
  const prevRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const via = nav.via;
  useEffect(() => {
    // Runs after the title takes focus, so a button move keeps the finger's place.
    if (via === "next") nextRef.current?.focus({ preventScroll: true });
    else if (via === "prev") prevRef.current?.focus({ preventScroll: true });
  }, [via]);
  const atStart = nav.prev == null;
  const atEnd = nav.next == null;
  return (
    <div className="ui-txn-nav" role="group" aria-label="מעבר בין תנועות">
      <IconButton
        ref={prevRef}
        label="התנועה הקודמת"
        aria-disabled={atStart ? true : undefined}
        aria-describedby={atStart ? `${hintId}-start` : undefined}
        onClick={() => { nav.move("prev", "prev"); }}
      >
        <ChevronUpIcon size={20} />
      </IconButton>
      <IconButton
        ref={nextRef}
        label="התנועה הבאה"
        aria-disabled={atEnd ? true : undefined}
        aria-describedby={atEnd ? `${hintId}-end` : undefined}
        onClick={() => { nav.move("next", "next"); }}
      >
        <ChevronDownIcon size={20} />
      </IconButton>
      {atStart ? <span id={`${hintId}-start`} className="sr-only">זו התנועה הראשונה ברשימה</span> : null}
      {atEnd ? <span id={`${hintId}-end`} className="sr-only">זו התנועה האחרונה ברשימה</span> : null}
    </div>
  );
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

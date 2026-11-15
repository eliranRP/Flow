import { useCallback, useEffect, useRef, useState } from "react";
import type { ForecastOverrideRow } from "@flow/shared";
import { defineMachine } from "@flow/shared";
import { priorPatch, type ForecastPatch, type ForecastWrite } from "./forecast-month";

/** The moved row folds away this long before its write, then the list is refreshed. */
export const FORECAST_FOLD_MS = 280;

/**
 * FLOW-1164: one forecast line moved to another month (decision 0266). The toast comes first; the write
 * waits for the fold, so the list shows the row leaving. A move is never lost and never sent twice:
 *
 * - `folding`: the toast is up and the row folds (or waits for the list to come back on screen). `folded`
 *   (the fold ended) and `leave` (the screen is going, so the fold is cut short) both send the write.
 * - `writing`: the write was sent; `sent` is the server's yes, `fail` its no (the row is back, the toast
 *   says so).
 * - `undo` (ביטול): in `folding` nothing was sent, so nothing is (`cancelled`); once the write was sent it
 *   sends the line's previous state back (`undone`), once.
 */
export const forecastMove = defineMachine({
  name: "forecastMove",
  initial: "idle",
  final: ["cancelled", "undone"],
  states: {
    idle: { move: "folding" },
    folding: { folded: "writing", leave: "writing", undo: "cancelled" },
    writing: { sent: "done", fail: "failed", undo: "undone" },
    done: { undo: "undone" },
    failed: { undo: "undone" },
    cancelled: {},
    undone: {},
  },
});

type MoveState = Parameters<typeof forecastMove.next>[0];
type MoveEvent = Parameters<typeof forecastMove.next>[1];

type Move = {
  id: number;
  key: string;
  patch: ForecastPatch;
  prior: ForecastOverrideRow | null;
  state: MoveState;
  /** The page of the row is still open: the fold starts when the list is back. */
  waiting: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
};

export type MoveSend = (write: ForecastWrite, settled?: { onSuccess: () => void; onError: () => void }) => void;

/**
 * The screen's moves. `send` is the write (a ref keeps the latest, so an unmount sends with it). `move`
 * starts one and returns its ביטול; `listShown` tells a move that waited for the page to close that the
 * list is back. Unmounting stops every timer and sends each move still folding, once.
 */
export function useForecastMoves(send: MoveSend): {
  leaving: ReadonlySet<string>;
  move: (key: string, patch: ForecastPatch, prior: ForecastOverrideRow | null, waitForList: boolean) => { undo: () => void };
  listShown: () => void;
} {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const moves = useRef(new Map<number, Move>());
  const counter = useRef(0);
  const sender = useRef(send);
  useEffect(() => { sender.current = send; });

  const mark = useCallback((key: string, on: boolean) => {
    setLeaving((current) => {
      if (current.has(key) === on) return current;
      const next = new Set(current);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  const fire = useCallback((move: Move, event: MoveEvent): boolean => {
    if (!forecastMove.can(move.state, event)) return false;
    move.state = forecastMove.next(move.state, event);
    if (move.state !== "folding") moves.current.delete(move.id);
    return true;
  }, []);
  const stop = useCallback((move: Move) => {
    if (move.timer != null) clearTimeout(move.timer);
    if (move.frame != null) cancelAnimationFrame(move.frame);
    move.timer = null;
    move.frame = null;
  }, []);
  const write = useCallback((move: Move) => {
    sender.current(
      { key: move.key, patch: move.patch, undo: false, prior: move.prior },
      { onSuccess: () => { fire(move, "sent"); }, onError: () => { fire(move, "fail"); } },
    );
  }, [fire]);
  const beginFold = useCallback((move: Move) => {
    move.waiting = false;
    mark(move.key, true);
    move.timer = setTimeout(() => {
      move.timer = null;
      if (!fire(move, "folded")) return;
      mark(move.key, false);
      write(move);
    }, FORECAST_FOLD_MS);
  }, [fire, mark, write]);

  useEffect(() => {
    const pending = moves.current;
    return () => {
      // The screen is going: a move the person made is sent now, not dropped with the fold.
      for (const move of [...pending.values()]) {
        stop(move);
        if (fire(move, "leave")) write(move);
      }
      pending.clear();
    };
  }, [fire, stop, write]);

  const move = useCallback((key: string, patch: ForecastPatch, prior: ForecastOverrideRow | null, waitForList: boolean) => {
    counter.current += 1;
    const entry: Move = { id: counter.current, key, patch, prior, state: forecastMove.initial, waiting: waitForList, timer: null, frame: null };
    fire(entry, "move");
    moves.current.set(entry.id, entry);
    if (!waitForList) beginFold(entry);
    const undo = () => {
      const was = entry.state;
      if (!fire(entry, "undo")) return;
      if (was === "folding") {
        stop(entry);
        mark(key, false);
        return;
      }
      sender.current({ key, patch: priorPatch(prior), undo: true, prior });
    };
    return { undo };
  }, [beginFold, fire, mark, stop]);

  const listShown = useCallback(() => {
    for (const entry of moves.current.values()) {
      if (!entry.waiting || entry.frame != null) continue;
      // Two frames: the list is drawn again before its row starts to fold.
      entry.frame = requestAnimationFrame(() => {
        entry.frame = requestAnimationFrame(() => {
          entry.frame = null;
          if (entry.state === "folding" && entry.waiting) beginFold(entry);
        });
      });
    }
  }, [beginFold]);

  return { leaving, move, listShown };
}

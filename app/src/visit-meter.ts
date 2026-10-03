/** This visit's לאישור counter. Decision 0080. h only grows. */

export type VisitMeter = {
  handled: ReadonlySet<string>;
  left: ReadonlySet<string>;
};

export function emptyVisit(): VisitMeter {
  return { handled: new Set(), left: new Set() };
}

/** A local skip or approve. A repeat is the same meter. */
export function noteHandled(meter: VisitMeter, id: string): VisitMeter {
  if (meter.handled.has(id)) return meter;
  const handled = new Set(meter.handled);
  handled.add(id);
  return { handled, left: meter.left };
}

/** Remember a handled card once it leaves, so a later undo counts it again. */
export function notePresence(meter: VisitMeter, openIds: readonly string[]): VisitMeter {
  const open = new Set(openIds);
  const left = new Set(meter.left);
  let changed = false;
  for (const id of meter.handled) {
    if (open.has(id) || left.has(id)) continue;
    left.add(id);
    changed = true;
  }
  if (!changed) return meter;
  return { handled: meter.handled, left };
}

/**
 * i is h + 1 and never exceeds n. n is h plus the open cards, except a card
 * handled in this render that has not left yet is not counted twice.
 * An empty queue has no counter.
 */
export function visitPlace(meter: VisitMeter, openIds: readonly string[]): { index: number; total: number } {
  if (openIds.length === 0) return { index: 0, total: 0 };
  const open = new Set(openIds);
  let inFlight = 0;
  for (const id of meter.handled) {
    if (open.has(id) && !meter.left.has(id)) inFlight += 1;
  }
  const openEffective = openIds.length - inFlight;
  const handled = meter.handled.size;
  if (openEffective <= 0) {
    const total = Math.max(handled, 1);
    return { index: total, total };
  }
  const total = handled + openEffective;
  return { index: Math.min(handled + 1, total), total };
}

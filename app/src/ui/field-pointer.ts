import type { MouseEvent, PointerEvent } from "react";

function fieldIn(host: EventTarget) {
  if (!(host instanceof HTMLElement)) return null;
  if (host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement || host instanceof HTMLSelectElement) return host;
  const field = host.querySelector("input, textarea, select");
  return field instanceof HTMLElement ? field : null;
}

/**
 * The sheet captures the pointer on pointerdown. Chromium then skips the
 * field's own focus, so a tap on the box does nothing unless this stops
 * the event before the drawer sees it.
 */
export function holdFieldPointer(event: PointerEvent<HTMLElement>) {
  event.stopPropagation();
  const field = fieldIn(event.currentTarget);
  if (!field || field.hasAttribute("disabled")) return;
  if (event.target instanceof Node && field.contains(event.target)) return;
  field.focus();
}

/** A tap on the box chrome must not blur the field the pointer handler just focused. */
export function holdFieldMouse(event: MouseEvent<HTMLElement>) {
  const field = fieldIn(event.currentTarget);
  if (!field) return;
  if (event.target instanceof Node && field.contains(event.target)) return;
  event.preventDefault();
}

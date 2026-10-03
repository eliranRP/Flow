import { useEffect, useRef, type KeyboardEvent, type RefObject, type WheelEvent } from "react";
import { holdFieldPointer } from "./field-pointer";
import { CopyIcon } from "./icons";
import { IconButton } from "./icon-button";

/** Which value the copy control belongs to. The component used to share this name. */
export type CopyTarget = "url" | "secret" | "command";

function scrollMax(input: HTMLInputElement): number {
  return Math.max(0, input.scrollWidth - input.clientWidth);
}

/** Keep the caret in the visible part of the line. One step, not a jump to the far end. */
function revealCaret(input: HTMLInputElement, pos: number) {
  const max = scrollMax(input);
  const length = input.value.length;
  if (pos <= 0 || length === 0) {
    input.scrollLeft = 0;
    return;
  }
  if (pos >= length) {
    input.scrollLeft = max;
    return;
  }
  const style = getComputedStyle(input);
  const padStart = Number.parseFloat(style.paddingLeft);
  const padEnd = Number.parseFloat(style.paddingRight);
  const start = Number.isFinite(padStart) ? padStart : 0;
  const end = Number.isFinite(padEnd) ? padEnd : 0;
  const textWidth = Math.max(0, input.scrollWidth - start - end);
  const caret = start + (textWidth * pos) / length;
  const viewStart = input.scrollLeft + start;
  const viewEnd = input.scrollLeft + input.clientWidth - end;
  if (caret > viewEnd) input.scrollLeft = Math.min(max, input.scrollLeft + (caret - viewEnd));
  else if (caret < viewStart) input.scrollLeft = Math.max(0, input.scrollLeft - (viewStart - caret));
}

function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const input = event.currentTarget;
  if (event.key === "Home") {
    event.preventDefault();
    input.setSelectionRange(0, 0);
    input.scrollLeft = 0;
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    input.scrollLeft = scrollMax(input);
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const length = input.value.length;
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  const next = start !== end
    ? (event.key === "ArrowRight" ? end : start)
    : (event.key === "ArrowRight" ? Math.min(length, start + 1) : Math.max(0, start - 1));
  input.setSelectionRange(next, next);
  revealCaret(input, next);
}

/**
 * touch-action: pan-x does not pan an input by itself, and Chrome drops the
 * moves unless this listener can cancel them. Pointerdown stops at the field,
 * so the sheet does not capture the gesture.
 */
function bindFieldPan(input: HTMLInputElement) {
  let startX = 0;
  let startScroll = 0;
  let tracking = false;
  let panning = false;
  const start = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (touch == null) return;
    tracking = true;
    panning = false;
    startX = touch.clientX;
    startScroll = input.scrollLeft;
  };
  const move = (event: TouchEvent) => {
    if (!tracking) return;
    const touch = event.touches[0];
    if (touch == null) return;
    const dx = touch.clientX - startX;
    if (!panning && Math.abs(dx) < 8) return;
    panning = true;
    event.preventDefault();
    input.scrollLeft = startScroll - dx;
  };
  const end = () => {
    tracking = false;
    panning = false;
  };
  input.addEventListener("touchstart", start, { passive: true });
  input.addEventListener("touchmove", move, { passive: false });
  input.addEventListener("touchend", end);
  input.addEventListener("touchcancel", end);
  return () => {
    input.removeEventListener("touchstart", start);
    input.removeEventListener("touchmove", move);
    input.removeEventListener("touchend", end);
    input.removeEventListener("touchcancel", end);
  };
}

function onFieldWheel(event: WheelEvent<HTMLInputElement>) {
  const across = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : 0;
  if (across === 0) return;
  const input = event.currentTarget;
  const max = scrollMax(input);
  if (max <= 0) return;
  const next = Math.min(max, Math.max(0, input.scrollLeft + across));
  if (next === input.scrollLeft) return;
  input.scrollLeft = next;
  event.preventDefault();
}

export function CodeField({
  label,
  labelId,
  fieldLabel,
  value,
  valueRef,
  failed,
  copyLabel,
  onCopy,
}: {
  label?: string;
  labelId?: string;
  fieldLabel?: string;
  value: string;
  valueRef?: RefObject<HTMLInputElement | null>;
  failed: boolean;
  /** Accessible name. The icon stays the visible control. */
  copyLabel: string;
  onCopy: () => void;
}) {
  const named = label != null && labelId != null;
  const localRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const input = localRef.current;
    if (input == null) return;
    return bindFieldPan(input);
  }, []);
  const control = (
    <>
      {named ? <p className="ui-field-label" id={labelId}>{label}</p> : null}
      <div className="ui-code-field-box" data-copy={value === "" ? "off" : "on"}>
        <input
          ref={(node) => {
            localRef.current = node;
            if (valueRef) valueRef.current = node;
          }}
          className="ui-field-control ui-code-field-input"
          readOnly
          dir="ltr"
          value={value}
          aria-label={named ? undefined : fieldLabel}
          aria-labelledby={named ? labelId : undefined}
          autoComplete="off"
          spellCheck={false}
          data-vaul-no-drag=""
          onPointerDown={(event) => {
            holdFieldPointer(event);
          }}
          onKeyDown={onFieldKeyDown}
          onWheel={onFieldWheel}
        />
        {value === "" ? null : (
          <IconButton label={copyLabel} className="ui-code-field-copy" onClick={onCopy}>
            <CopyIcon />
          </IconButton>
        )}
      </div>
      {failed ? <p className="t-hint" role="status">העתיקו ידנית</p> : null}
    </>
  );
  if (!named) return <div className="ui-code-field">{control}</div>;
  return (
    <div className="ui-code-field" role="group" aria-labelledby={labelId}>
      {control}
    </div>
  );
}

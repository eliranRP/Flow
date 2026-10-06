import { useRef, type CSSProperties, type ReactNode } from "react";
import { useDemoPlayback } from "./demo-player";

/** The UI changes this long after a press starts. */
export const POINTER_REACT_MS = 150;
const PRESS_MS = 260;
const RIPPLE_MS = 300;
const DOT_PX = 28;
const ARROW_HOTSPOT = 2;
const RIPPLE_PX = 44;

export type DemoPointerVariant = "dot" | "arrow";

export type PointerSpan = { start: number; duration: number };

export type PointerMove = { start: number; duration: number; target: string };

/** Absolute times from play. Moves use ease-in-out; taps press for 260ms and ripple for 300ms. */
export type PointerTimeline = {
  fadeIn: PointerSpan;
  fadeOut: PointerSpan;
  moves: readonly PointerMove[];
  taps: readonly number[];
};

export type PointerPose = {
  opacity: number;
  scale: number;
  rippleOpacity: number;
  rippleScale: number;
  /** 1 when the ripple appears, 0 when it is gone. The approval probe reads this. */
  ring: number;
  from: string | null;
  to: string | null;
  moveT: number;
};

type Point = { x: number; y: number };

function unit(elapsed: number, start: number, duration: number): number {
  if (elapsed <= start) return 0;
  if (duration <= 0 || elapsed >= start + duration) return 1;
  return (elapsed - start) / duration;
}

/** Solve y for cubic-bezier(x1, y1, x2, y2) at time `t`. */
function cubicBezier(t: number, x1: number, y1: number, x2: number, y2: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  let u = t;
  for (let i = 0; i < 8; i += 1) {
    const x = ((ax * u + bx) * u + cx) * u;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - (x - t) / dx));
  }
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return ((ay * u + by) * u + cy) * u;
}

/** CSS ease-out: cubic-bezier(0, 0, 0.58, 1). */
function easeOut(t: number): number {
  return cubicBezier(t, 0, 0, 0.58, 1);
}

/** Shared move: cubic-bezier(0.45, 0, 0.55, 1). */
function easeMove(t: number): number {
  return cubicBezier(t, 0.45, 0, 0.55, 1);
}

/** `--ease-standard`: cubic-bezier(0.2, 0, 0, 1). */
export function easeStandard(t: number): number {
  return cubicBezier(t, 0.2, 0, 0, 1);
}

function anchor(elapsed: number, moves: readonly PointerMove[]): Pick<PointerPose, "from" | "to" | "moveT"> {
  let from: string | null = null;
  let to: string | null = null;
  let moveT = 1;
  for (const move of moves) {
    if (elapsed < move.start) break;
    const raw = unit(elapsed, move.start, move.duration);
    from = to;
    to = move.target;
    moveT = raw >= 1 ? 1 : easeMove(raw);
    if (raw < 1) break;
  }
  if (moveT >= 1) from = to;
  return { from, to, moveT };
}

/** Opacity, press scale, and ripple at `elapsedMs`. Position is a separate measurement. */
export function pointerPose(elapsedMs: number, timeline: PointerTimeline): PointerPose {
  const opacity = unit(elapsedMs, timeline.fadeIn.start, timeline.fadeIn.duration) * (1 - unit(elapsedMs, timeline.fadeOut.start, timeline.fadeOut.duration));
  let scale = 1;
  let rippleOpacity = 0;
  let rippleScale = 0.5;
  let ring = 0;
  for (const tap of timeline.taps) {
    const pressT = (elapsedMs - tap) / PRESS_MS;
    if (pressT >= 0 && pressT <= 1) {
      const eased = easeOut(pressT);
      scale = eased <= 0.4 ? 1 - (eased / 0.4) * 0.1 : 0.9 + ((eased - 0.4) / 0.6) * 0.1;
    }
    const rippleT = (elapsedMs - tap) / RIPPLE_MS;
    if (rippleT >= 0 && rippleT <= 1) {
      const eased = easeOut(rippleT);
      rippleOpacity = 0.35 * (1 - eased);
      rippleScale = 0.5 + 1.1 * eased;
      ring = 1 - eased;
    }
  }
  return { opacity, scale, rippleOpacity, rippleScale, ring, ...anchor(elapsedMs, timeline.moves) };
}

function measure(stage: HTMLElement, id: string | null, memory: Map<string, Point>): Point {
  if (id === null) return { x: stage.offsetWidth * 0.3, y: stage.offsetHeight * 0.84 };
  const el = stage.querySelector(`[data-tap="${id}"]`);
  if (el instanceof HTMLElement) {
    const stageRect = stage.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const z = stageRect.width > 0 && stage.offsetWidth > 0 ? stageRect.width / stage.offsetWidth : 1;
    const point = {
      x: (rect.left - stageRect.left + rect.width / 2) / z,
      y: (rect.top - stageRect.top + rect.height / 2) / z,
    };
    // Keep the first laid-out point. A card that then leaves must not drag the pointer with it.
    if (rect.width <= 0 && rect.height <= 0) return memory.get(id) ?? point;
    const cached = memory.get(id);
    if (cached) return cached;
    memory.set(id, point);
    return point;
  }
  return memory.get(id) ?? { x: stage.offsetWidth * 0.3, y: stage.offsetHeight * 0.84 };
}

function PointerArrow() {
  return (
    <svg className="ui-demo-pointer-arrow" viewBox="0 0 22 30" aria-hidden="true">
      <path
        d="M2 2 L2 24 L7.5 18.8 L11.2 27.4 L15 25.8 L11.4 17.4 L18.6 17.4 Z"
        fill="var(--demo-pointer-arrow)"
        stroke="var(--demo-pointer-arrow-outline)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type DemoPointerProps = {
  elapsedMs: number;
  timeline: PointerTimeline;
  /** Fingertip dot, unless Eliran picks the arrow. */
  variant?: DemoPointerVariant;
};

/**
 * Pointer inside the phone. The dot's centre, or the arrow's tip, is the tap point.
 * Reduced motion removes it. Colours live in the demo CSS, not in the token set.
 */
export function DemoPointer({ elapsedMs, timeline, variant = "dot" }: DemoPointerProps): ReactNode {
  const { reducedMotion } = useDemoPlayback();
  const ref = useRef<HTMLSpanElement>(null);
  const memory = useRef(new Map<string, Point>());
  const frozen = useRef<Point | null>(null);
  const pose = pointerPose(elapsedMs, timeline);
  if (reducedMotion) return null;

  const stage = ref.current?.closest(".ui-setup-demo");
  const hotspot = variant === "arrow" ? ARROW_HOTSPOT : DOT_PX / 2;
  let point: Point = { x: 0, y: 0 };
  if (stage instanceof HTMLElement) {
    if (elapsedMs >= timeline.fadeOut.start) {
      frozen.current ??= place(stage, pose, memory.current);
      point = frozen.current;
    } else {
      frozen.current = null;
      point = place(stage, pose, memory.current);
    }
  }
  const rippleStyle = {
    opacity: pose.rippleOpacity,
    transform: `translate(${String(hotspot - RIPPLE_PX / 2)}px, ${String(hotspot - RIPPLE_PX / 2)}px) scale(${String(pose.rippleScale)})`,
    "--setup-ring": String(pose.ring),
  } as CSSProperties;
  return (
    <span
      ref={ref}
      className="ui-demo-pointer"
      data-variant={variant}
      aria-hidden="true"
      style={{ opacity: pose.opacity, transform: `translate(${String(point.x - hotspot)}px, ${String(point.y - hotspot)}px)` }}
    >
      <span className="ui-demo-pointer-glyph" style={{ transform: `scale(${String(pose.scale)})` }}>
        {variant === "arrow" ? <PointerArrow /> : <span className="ui-demo-pointer-dot" />}
      </span>
      <span className="ui-setup-ring ui-demo-pointer-ripple" style={rippleStyle} />
    </span>
  );
}

function place(stage: HTMLElement, pose: PointerPose, memory: Map<string, Point>): Point {
  const from = measure(stage, pose.from, memory);
  const to = measure(stage, pose.to, memory);
  return { x: from.x + (to.x - from.x) * pose.moveT, y: from.y + (to.y - from.y) * pose.moveT };
}

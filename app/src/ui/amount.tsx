import { formatAmountText } from "@flow/shared";
import { useLayoutEffect, useRef, useState } from "react";

export type AmountPresentation = "summary" | "detail";
/**
 * Roles from the Design guide: band 52/500, detail 40/400, total 34/400, card 28/400, list 17/400. "column"
 * is a card figure that shares a row with another (the next-month card): 28/400, stepping down until it fits
 * its `.ui-amount-fit` column.
 */
export type AmountSize = "hero" | "display" | "total" | "card" | "column" | "list";

/**
 * Summaries are whole shekels. Detail shows agorot only when they are not zero.
 * Callers pass net agorot. The figure is before VAT. Decisions 0041 and 0043.
 */
export function formatAmount(
  agorot: bigint,
  presentation: AmountPresentation = "summary",
  currency = "ILS",
  direction?: "income" | "expense",
  keepZeroCents = false,
): string {
  return formatAmountText(agorot, currency, {
    detail: presentation === "detail",
    direction,
    plus: direction === "income",
    keepZeroCents,
  });
}

type AmountProps = {
  agorot: bigint;
  presentation?: AmountPresentation;
  currency?: string;
  size?: AmountSize;
  /** Loss colour is only used together with the minus that formatAmount already draws. */
  loss?: boolean;
  direction?: "income" | "expense";
  /**
   * Money in: draws the figure in the income colour with a "+" (decisions 0120, 0181). Only a figure that
   * shows no minus turns green; a negative income keeps its minus in the main text colour. Never on the band.
   */
  income?: boolean;
  /** With `income`, keeps the income colour but draws no "+" (the invoice page's board figure). */
  signless?: boolean;
  /**
   * "always": transaction rows show agorot like Mercury, drawn small and raised (decision 0120,
   * option C). A whole amount shows no ".00" (owner, 2026-10-10). Other lists, totals and
   * summaries stay whole units.
   */
  cents?: "always";
  /** FLOW-366b: with cents="always", a whole amount keeps its ".00" (the month lines rows, as the board draws them). */
  zeroCents?: boolean;
  /**
   * A fitted size only: figures that sit side by side share one size. `onFit` hears the step this figure
   * needs to fit, and `minStep` (the largest step of the row) draws it at least that small.
   */
  onFit?: (step: number) => void;
  minStep?: number;
};

/** True when the formatted figure starts with a minus sign. */
export function showsMinus(text: string): boolean {
  return text.startsWith("−") || text.startsWith("-");
}

/** Detail figures with agorot split into the whole part and the ".50" tail, which is drawn smaller. */
export function splitCents(text: string, presentation: AmountPresentation): { whole: string; cents: string | null } {
  if (presentation !== "detail") return { whole: text, cents: null };
  // Detail figures and transaction rows (cents="always") both end in ".dd" when they carry cents.
  const match = /\.\d{2}$/.exec(text);
  if (match == null) return { whole: text, cents: null };
  return { whole: text.slice(0, match.index), cents: match[0] };
}

const sizeClass = {
  hero: "t-band",
  display: "t-detail",
  total: "t-total",
  card: "t-card",
  column: "t-card",
  list: "t-body",
} as const;

const heroSteps = ["t-band", "t-detail", "t-total", "t-name", "t-btn"] as const;
const columnSteps = ["t-card", "t-name", "t-sheet", "t-btn"] as const;

/**
 * The step list of a fitted size and where it starts. Hero and display step down until the figure fits, a
 * column figure from card size; the other sizes never do.
 */
function fitSteps(size: AmountSize | undefined): { steps: readonly string[]; first: number } | null {
  if (size === "hero") return { steps: heroSteps, first: 0 };
  if (size === "display") return { steps: heroSteps, first: 1 };
  if (size === "column") return { steps: columnSteps, first: 0 };
  return null;
}

export function heroStepClass(size: AmountSize | undefined, step: number): string {
  const fit = fitSteps(size);
  if (fit == null) return size ? sizeClass[size] : "";
  return fit.steps[Math.min(fit.first + Math.max(step, 0), fit.steps.length - 1)] ?? "t-btn";
}

export function Amount({
  agorot,
  presentation = "summary",
  currency = "ILS",
  size,
  loss = false,
  direction,
  income = false,
  signless = false,
  cents,
  zeroCents = false,
  onFit,
  minStep = 0,
}: AmountProps) {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const shown = cents === "always" ? "detail" : presentation;
  // Money in gets a plus (decision 0181). Only a non-zero figure with no loss: zero has no sign.
  const text = formatAmount(agorot, shown, currency, direction ?? (income && !signless && !loss && agorot > 0n ? "income" : undefined), zeroCents);
  useLayoutEffect(() => {
    const fit = fitSteps(size);
    if (fit == null) return;
    const { steps, first } = fit;
    const node = ref.current;
    if (!node) return;
    // A flex item shrinks to the figure, so measure against the padded block (or the column) that holds it.
    const column = node.closest(".ui-amount-fit, .ui-band-hero, .ui-page-pad") ?? node.parentElement;
    if (!(column instanceof HTMLElement)) return;
    const probe = document.createElement("bdi");
    probe.className = `ui-num ${steps[first] ?? "t-band"}`;
    probe.textContent = text;
    probe.setAttribute("aria-hidden", "true");
    probe.style.whiteSpace = "nowrap";
    probe.style.inlineSize = "max-content";
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.insetInlineStart = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.overflow = "hidden";
    host.style.visibility = "hidden";
    host.appendChild(probe);
    const pads = new Map<HTMLElement, number>();
    const readPad = (el: HTMLElement) => {
      const style = getComputedStyle(el);
      const pad = (Number.parseFloat(style.paddingInlineStart) || 0) + (Number.parseFloat(style.paddingInlineEnd) || 0);
      pads.set(el, pad);
    };
    const chain: HTMLElement[] = [column];
    readPad(column);
    let walker: HTMLElement | null = column.parentElement;
    while (walker && walker !== document.documentElement) {
      readPad(walker);
      chain.push(walker);
      walker = walker.parentElement;
    }
    const measure = () => {
      let content = column.clientWidth - (pads.get(column) ?? 0);
      for (const ancestor of chain) {
        if (ancestor === column) continue;
        const pad = pads.get(ancestor) ?? 0;
        if (ancestor.clientWidth > 0) content = Math.min(content, ancestor.clientWidth - pad);
      }
      const widthOf = (typeClass: string) => {
        probe.className = `ui-num ${typeClass}`;
        return probe.getBoundingClientRect().width;
      };
      // The probe is in the page only while it is measured, so a text search never finds a second figure.
      document.body.appendChild(host);
      let next = steps.length - 1;
      try {
        for (let index = first; index < steps.length; index += 1) {
          const typeClass = steps[index];
          if (typeClass != null && widthOf(typeClass) <= content) {
            next = index;
            break;
          }
        }
      } finally {
        host.remove();
      }
      setStep(next - first);
      onFit?.(next - first);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const ancestor of chain) observer.observe(ancestor);
    let cancelled = false;
    // jsdom has no FontFaceSet. The assertion is the runtime check.
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts != null) {
      void fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [size, text, onFit]);
  // Zero is not money in, and a figure with a minus is never green.
  // A figure that rounds to "₪0" (40 agorot in a summary) is zero too.
  const green = income && !loss && agorot !== 0n && !/^\D*0$/.test(text) && !showsMinus(text);
  const { whole, cents: tail } = splitCents(text, shown);
  return (
    <bdi
      ref={ref}
      dir="ltr"
      className={["ui-num", heroStepClass(size, Math.max(step, minStep)), loss ? "ui-loss" : "", green ? "ui-income" : ""].filter(Boolean).join(" ")}
    >
      {tail == null ? text : (
        <>
          {whole}
          <span className="ui-num-cents">{tail}</span>
        </>
      )}
    </bdi>
  );
}

import { formatAmountText } from "@flow/shared";
import { useLayoutEffect, useRef, useState } from "react";

export type AmountPresentation = "summary" | "detail";

/**
 * Summaries are whole shekels. Detail shows agorot only when they are not zero.
 * Callers pass net agorot. The figure is before VAT. Decisions 0041 and 0043.
 */
export function formatAmount(
  agorot: bigint,
  presentation: AmountPresentation = "summary",
  currency = "ILS",
  direction?: "income" | "expense",
): string {
  return formatAmountText(agorot, currency, {
    detail: presentation === "detail",
    direction,
  });
}

type BigNumberProps = {
  agorot: bigint;
  presentation?: AmountPresentation;
  currency?: string;
  size?: "hero" | "display" | "list";
  /** Loss colour is only used together with the minus that formatAmount already draws. */
  loss?: boolean;
  direction?: "income" | "expense";
  /**
   * Money in: draws the figure in the income colour (decision 0120). Only a figure that shows no
   * minus turns green; a negative income keeps its minus in the main text colour. Never on the band.
   */
  income?: boolean;
  /**
   * "always": transaction rows show cents like Mercury, ".00" included, drawn small and raised
   * (decision 0120, option C). Other lists, totals and summaries stay whole units.
   */
  cents?: "always";
};

/** The figure with its cents always shown: the detail text, plus ".00" when the cents are zero. */
export function withCents(text: string): string {
  return /\.\d{2}$/.test(text) ? text : `${text}.00`;
}

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
  hero: "t-hero",
  display: "t-display",
  list: "t-amount",
} as const;

const heroSteps = ["t-hero", "t-display", "t-title-1", "t-title-2", "t-title-3"] as const;

/** Where a fitted size starts on the step list. Hero and display step down until the figure fits; list never does. */
function firstStep(size: "hero" | "display" | "list" | undefined): number | null {
  if (size === "hero") return 0;
  if (size === "display") return 1;
  return null;
}

export function heroStepClass(size: "hero" | "display" | "list" | undefined, step: number): string {
  const first = firstStep(size);
  if (first == null) return size ? sizeClass[size] : "";
  return heroSteps[Math.min(first + Math.max(step, 0), heroSteps.length - 1)] ?? "t-title-3";
}

export function heroTypeClass(size: "hero" | "display" | "list" | undefined, stepDown: boolean): string {
  return heroStepClass(size, stepDown ? 1 : 0);
}

export function BigNumber({
  agorot,
  presentation = "summary",
  currency = "ILS",
  size,
  loss = false,
  direction,
  income = false,
  cents,
}: BigNumberProps) {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const shown = cents === "always" ? "detail" : presentation;
  const formatted = formatAmount(agorot, shown, currency, direction);
  const text = cents === "always" ? withCents(formatted) : formatted;
  useLayoutEffect(() => {
    const first = firstStep(size);
    if (first == null) return;
    const node = ref.current;
    if (!node) return;
    // A flex item shrinks to the figure, so measure against the padded block that holds it.
    const column = node.closest(".ui-band-hero, .ui-page-pad") ?? node.parentElement;
    if (!(column instanceof HTMLElement)) return;
    const probe = document.createElement("bdi");
    probe.className = `ui-num ${heroSteps[first] ?? "t-hero"}`;
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
      let next = heroSteps.length - 1;
      try {
        for (let index = first; index < heroSteps.length; index += 1) {
          const typeClass = heroSteps[index];
          if (typeClass != null && widthOf(typeClass) <= content) {
            next = index;
            break;
          }
        }
      } finally {
        host.remove();
      }
      setStep(next - first);
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
  }, [size, text]);
  // Zero is not money in, and a figure with a minus is never green.
  const green = income && !loss && agorot !== 0n && !showsMinus(text);
  const { whole, cents: tail } = splitCents(text, shown);
  return (
    <bdi
      ref={ref}
      dir="ltr"
      className={["ui-num", heroStepClass(size, step), loss ? "ui-loss" : "", green ? "ui-income" : ""].filter(Boolean).join(" ")}
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

/** List and inline amounts. Same rules as BigNumber at the summary size. */
export function Money({ agorot, currency = "ILS" }: { agorot: bigint; currency?: string }) {
  return <BigNumber agorot={agorot} currency={currency} />;
}

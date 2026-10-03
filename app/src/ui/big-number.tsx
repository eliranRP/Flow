import { formatIls } from "@flow/shared";
import { useLayoutEffect, useRef, useState } from "react";

export type AmountPresentation = "summary" | "detail";

/**
 * Summaries are whole shekels. Detail shows agorot only when they are not zero.
 * Callers pass net agorot. The figure is before VAT. Decisions 0041 and 0043.
 */
export function formatAmount(agorot: bigint, presentation: AmountPresentation = "summary"): string {
  return formatIls(agorot, { agorot: presentation === "detail" });
}

type BigNumberProps = {
  agorot: bigint;
  presentation?: AmountPresentation;
  size?: "hero" | "display" | "list";
  /** Loss colour is only used together with the minus that formatAmount already draws. */
  loss?: boolean;
};

const sizeClass = {
  hero: "t-hero",
  display: "t-display",
  list: "t-title-3",
} as const;

const heroSteps = ["t-hero", "t-display", "t-title-1", "t-title-2", "t-title-3"] as const;

export function heroStepClass(size: "hero" | "display" | "list" | undefined, step: number): string {
  if (size !== "hero") return size ? sizeClass[size] : "";
  return heroSteps[Math.min(Math.max(step, 0), heroSteps.length - 1)] ?? "t-title-3";
}

export function heroTypeClass(size: "hero" | "display" | "list" | undefined, stepDown: boolean): string {
  return heroStepClass(size, stepDown ? 1 : 0);
}

export function BigNumber({ agorot, presentation = "summary", size, loss = false }: BigNumberProps) {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const text = formatAmount(agorot, presentation);
  useLayoutEffect(() => {
    if (size !== "hero") return;
    const node = ref.current;
    if (!node) return;
    const column = node.closest(".ui-band-hero") ?? node.parentElement;
    if (!(column instanceof HTMLElement)) return;
    const probe = document.createElement("bdi");
    probe.className = "ui-num t-hero";
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
    document.body.appendChild(host);
    const measure = () => {
      const style = getComputedStyle(column);
      const pad = (Number.parseFloat(style.paddingInlineStart) || 0) + (Number.parseFloat(style.paddingInlineEnd) || 0);
      let content = column.clientWidth - pad;
      let walker: HTMLElement | null = column.parentElement;
      while (walker && walker !== document.documentElement) {
        const parentStyle = getComputedStyle(walker);
        const parentPad = (Number.parseFloat(parentStyle.paddingInlineStart) || 0) + (Number.parseFloat(parentStyle.paddingInlineEnd) || 0);
        if (walker.clientWidth > 0) content = Math.min(content, walker.clientWidth - parentPad);
        walker = walker.parentElement;
      }
      const widthOf = (typeClass: string) => {
        probe.className = `ui-num ${typeClass}`;
        return probe.getBoundingClientRect().width;
      };
      let next = heroSteps.length - 1;
      for (let index = 0; index < heroSteps.length; index += 1) {
        const typeClass = heroSteps[index];
        if (typeClass != null && widthOf(typeClass) <= content) {
          next = index;
          break;
        }
      }
      setStep(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    let cancelled = false;
    // jsdom has no FontFaceSet. The assertion is the runtime check.
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts != null) {
      void fonts.ready.then(() => {
        if (!cancelled && host.isConnected) measure();
      });
    }
    return () => {
      cancelled = true;
      observer.disconnect();
      host.remove();
    };
  }, [size, text]);
  return (
    <bdi ref={ref} dir="ltr" className={["ui-num", heroStepClass(size, step), loss ? "ui-loss" : ""].filter(Boolean).join(" ")}>
      {text}
    </bdi>
  );
}

/** List and inline amounts. Same rules as BigNumber at the summary size. */
export function Money({ agorot }: { agorot: bigint }) {
  return <BigNumber agorot={agorot} />;
}

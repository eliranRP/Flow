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

export function heroStepClass(size: "hero" | "display" | "list" | undefined, step: number): string {
  if (size !== "hero") return size ? sizeClass[size] : "";
  if (step >= 2) return "t-title-1";
  if (step === 1) return "t-display";
  return "t-hero";
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
      const content = column.clientWidth - pad;
      const widthOf = (typeClass: string) => {
        probe.className = `ui-num ${typeClass}`;
        return probe.getBoundingClientRect().width;
      };
      if (widthOf("t-hero") <= content) setStep(0);
      else if (widthOf("t-display") <= content) setStep(1);
      else setStep(2);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => {
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

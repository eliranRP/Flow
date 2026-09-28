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

export function heroTypeClass(size: "hero" | "display" | "list" | undefined, stepDown: boolean): string {
  if (size === "hero") return stepDown ? "t-display" : "t-hero";
  return size ? sizeClass[size] : "";
}

export function BigNumber({ agorot, presentation = "summary", size, loss = false }: BigNumberProps) {
  const ref = useRef<HTMLElement>(null);
  const [stepDown, setStepDown] = useState(false);
  const text = formatAmount(agorot, presentation);
  useLayoutEffect(() => {
    if (size !== "hero") return;
    const node = ref.current;
    const column = node?.closest(".ui-band-hero");
    if (!node || !(column instanceof HTMLElement)) return;
    const probe = document.createElement("bdi");
    probe.className = "ui-num t-hero";
    probe.textContent = text;
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.whiteSpace = "nowrap";
    probe.style.inlineSize = "max-content";
    column.appendChild(probe);
    const measure = () => {
      const style = getComputedStyle(column);
      const pad = (Number.parseFloat(style.paddingInlineStart) || 0) + (Number.parseFloat(style.paddingInlineEnd) || 0);
      const content = column.clientWidth - pad;
      setStepDown(probe.getBoundingClientRect().width > content);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => {
      observer.disconnect();
      probe.remove();
    };
  }, [size, text]);
  return (
    <bdi ref={ref} dir="ltr" className={["ui-num", heroTypeClass(size, stepDown), loss ? "ui-loss" : ""].filter(Boolean).join(" ")}>
      {text}
    </bdi>
  );
}

/** List and inline amounts. Same rules as BigNumber at the summary size. */
export function Money({ agorot }: { agorot: bigint }) {
  return <BigNumber agorot={agorot} />;
}

import { formatIls } from "@flow/shared";
import { useLayoutEffect, useRef, useState } from "react";

export type AmountPresentation = "summary" | "detail";

/**
 * Summaries are whole shekels. Detail shows agorot only when they are not zero.
 * Callers pass net agorot. The figure is before VAT. Decisions 0041 and 0043.
 */
export function formatAmount(agorot: bigint, presentation: AmountPresentation = "summary"): string {
  const negative = agorot < 0n;
  const abs = negative ? -agorot : agorot;
  if (presentation === "summary" || abs % 100n === 0n) return formatIls(agorot);
  const shekels = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const agora = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}₪${shekels}.${agora}`;
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

export function BigNumber({ agorot, presentation = "summary", size, loss = false }: BigNumberProps) {
  const ref = useRef<HTMLElement>(null);
  const [stepDown, setStepDown] = useState(false);
  useLayoutEffect(() => {
    if (size !== "hero") return;
    const node = ref.current;
    const column = node?.parentElement;
    if (!node || !column) return;
    const measure = () => {
      node.classList.add("t-hero");
      node.classList.remove("t-display");
      setStepDown(node.scrollWidth > column.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => {
      observer.disconnect();
    };
  }, [agorot, presentation, size]);
  const heroClass = size === "hero" && stepDown ? "t-display" : size ? sizeClass[size] : "";
  return (
    <bdi ref={ref} dir="ltr" className={["num", heroClass, loss ? "ui-loss" : ""].filter(Boolean).join(" ")}>
      {formatAmount(agorot, presentation)}
    </bdi>
  );
}

/** List and inline amounts. Same whole-shekel, pre-VAT rules as BigNumber. */
export function Money({ agorot }: { agorot: bigint }) {
  return <BigNumber agorot={agorot} />;
}

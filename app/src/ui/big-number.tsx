import { formatIls } from "@flow/shared";

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
  return (
    <bdi dir="ltr" className={["num", size ? sizeClass[size] : "", loss ? "ui-loss" : ""].filter(Boolean).join(" ")}>
      {formatAmount(agorot, presentation)}
    </bdi>
  );
}

/** List and inline amounts. Same whole-shekel, pre-VAT rules as BigNumber. */
export function Money({ agorot }: { agorot: bigint }) {
  return <BigNumber agorot={agorot} />;
}

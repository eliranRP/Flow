import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApproxAmount } from "./approx-amount";

describe("ApproxAmount", () => {
  it("puts כ־ before a whole amount and drops it on a zero", () => {
    const { container, rerender } = render(<ApproxAmount minor={-185_060n} />);
    expect(container.textContent).toBe("בערך כ־₪1,851");
    rerender(<ApproxAmount minor={0n} currency="USD" />);
    expect(container.textContent).toBe("$0");
  });

  it("paints income green", () => {
    const { container } = render(<ApproxAmount minor={1_200_000n} income />);
    expect(container.querySelector(".ui-approx-income")).not.toBeNull();
  });

  it("puts + inside the LTR bdi for expected income, with כ־ outside it", () => {
    const { container } = render(<ApproxAmount minor={1_200_000n} income />);
    const bdi = container.querySelector('bdi[dir="ltr"]');
    expect(bdi?.textContent).toBe("+₪12,000");
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("כ־");
    expect(bdi?.closest('[aria-hidden="true"]')).toBeNull();
    expect(container.textContent).toBe("בערך כ־הכנסה +₪12,000");
  });

  it("signs expected USD income too", () => {
    const { container } = render(<ApproxAmount minor={200_000n} currency="USD" income />);
    expect(container.querySelector('bdi[dir="ltr"]')?.textContent).toBe("+$2,000");
  });

  it("leaves expected expenses unsigned", () => {
    const { container } = render(<ApproxAmount minor={-185_060n} />);
    expect(container.querySelector('bdi[dir="ltr"]')?.textContent).toBe("₪1,851");
    expect(container.textContent).not.toContain("+");
  });

  it("keeps a zero income unsigned and drops כ־", () => {
    const { container } = render(<ApproxAmount minor={0n} income />);
    expect(container.querySelector('bdi[dir="ltr"]')?.textContent).toBe("₪0");
    expect(container.textContent).not.toContain("+");
    expect(container.textContent).not.toContain("כ־");
  });
});

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MethodIcon } from "./bank-details";

describe("MethodIcon", () => {
  it.each(["card", "transfer", "check"] as const)("draws the %s icon as decoration, hidden from the accessibility tree", (kind) => {
    const { container } = render(<MethodIcon kind={kind} />);
    const wrap = container.querySelector(".ui-method-icon");
    expect(wrap).toHaveAttribute("aria-hidden", "true");
    expect(wrap?.querySelector("svg")).not.toBeNull();
  });
});

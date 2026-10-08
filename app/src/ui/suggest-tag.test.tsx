import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JevTag, ReversalTag, SuggestTag } from "./suggest-tag";

describe("suggest tags", () => {
  it("keeps הצעה and החזר as one plain pill", () => {
    render(<><SuggestTag /><ReversalTag /></>);
    expect(screen.getByText("הצעה")).toHaveClass("ui-suggest-tag");
    expect(screen.getByText("החזר")).toHaveClass("ui-suggest-tag");
    expect(document.querySelector(".ui-suggest-tag-jev")).toBeNull();
  });

  it("draws הצעת Jev on the strong tint with the ✦ hidden from readers", () => {
    const { container } = render(<JevTag />);
    const tag = container.firstElementChild as HTMLElement;
    expect(tag).toHaveClass("ui-suggest-tag", "ui-suggest-tag-jev");
    expect(tag).toHaveTextContent("✦הצעת Jev");
    expect(screen.getByText("✦")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("הצעת Jev")).not.toHaveAttribute("aria-hidden");
  });
});

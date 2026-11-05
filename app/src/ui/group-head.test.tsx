import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupHead } from "./group-head";
import { expectRtl } from "./test-support";

describe("GroupHead", () => {
  it("names the group as a heading and reads its count before its sums", () => {
    expectRtl();
    const { container } = render(
      <GroupHead id="head-1" title="שויכו היום" count="3 תנועות">
        <span>₪1,250.00</span>
      </GroupHead>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "שויכו היום" });
    expect(heading.id).toBe("head-1");
    const totals = container.querySelector(".ui-month-totals");
    expect(totals?.textContent).toBe("3 תנועות₪1,250.00");
    expect(totals?.querySelector("span.ui-group-count")?.textContent).toBe("3 תנועות");
    expect(container.querySelector(".ui-group-head")).not.toBeNull();
  });

  it("draws one line with a summary: the title at the start, the summary at the end (FLOW-1043)", () => {
    const { container } = render(<GroupHead id="head-2" title="קבועים ששולמו" summary="6 · $512 יצא" />);
    const head = container.querySelector(".ui-group-head");
    expect(head).toHaveClass("ui-group-head-line", "ui-month-head");
    const heading = screen.getByRole("heading", { level: 2, name: "קבועים ששולמו" });
    expect(heading).toHaveClass("t-section");
    expect(heading.id).toBe("head-2");
    const summary = head?.querySelector(".ui-group-summary");
    expect(summary).toHaveClass("t-meta");
    expect(summary).toHaveTextContent("6 · $512 יצא");
    expect(head?.querySelector(".ui-month-totals")).toBeNull();
    expect(head?.lastElementChild).toBe(summary);
  });

  it("keeps the two-line head without a summary", () => {
    const { container } = render(
      <GroupHead id="head-3" title="שויכו היום" count="3 תנועות">
        <span>₪1,250.00</span>
      </GroupHead>,
    );
    expect(container.querySelector(".ui-group-head")).not.toHaveClass("ui-group-head-line");
    expect(screen.getByRole("heading", { name: "שויכו היום" })).toHaveClass("t-sheet");
  });
});

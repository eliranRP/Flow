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
    expect(container.querySelector(".ui-group-head")).not.toBeNull();
  });
});

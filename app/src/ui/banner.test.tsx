import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Banner, Notice } from "./banner";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Banner", () => {
  it("is a tinted notice with a 44px target in both themes", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <Banner to="/review" title="7 פריטים ממתינים" count={7} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /7 פריטים/ });
    expectTarget(link);
    expectThemePaint(link, "backgroundColor");
    render(<Notice tone="bad" title="לא הצלחנו להתחבר" body="בדקו את החיבור." />);
    expect(screen.getByRole("status")).toHaveTextContent("לא הצלחנו להתחבר");
  });
});

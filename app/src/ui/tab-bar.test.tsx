import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TabBar } from "./tab-bar";
import { expectRtl, expectTarget } from "./test-support";

describe("TabBar", () => {
  it("keeps the five slots and leaves the component gallery out", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <TabBar reviewCount={7} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const names = [...nav.querySelectorAll("a")].map((link) => link.getAttribute("aria-label") ?? link.textContent.trim());
    expect(names).toEqual(["בית", "פרויקטים", "הוספה", "לאישור, 7 ממתינים", "הגדרות"]);
    expect(nav.textContent).not.toContain("/dev/components");
    expectTarget(screen.getByRole("link", { name: "הוספה" }));
  });
});

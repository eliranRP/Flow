import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TabBar } from "./tab-bar";
import { expectRtl, expectTarget } from "./test-support";

describe("TabBar", () => {
  it("keeps the five slots", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <TabBar reviewCount={7} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const names = [...nav.querySelectorAll("a")].map((link) => link.getAttribute("aria-label") ?? link.textContent.trim());
    expect(names).toEqual(["בית", "פרויקטים", "הוספה", "לאישור, 7 ממתינים", "הגדרות"]);
    expectTarget(screen.getByRole("link", { name: "הוספה" }));
  });

  it("keeps 99+ in an ltr isolate", () => {
    render(
      <MemoryRouter>
        <TabBar reviewCount={100} />
      </MemoryRouter>,
    );
    const badge = document.querySelector(".count-badge bdi");
    expect(badge).toHaveAttribute("dir", "ltr");
    expect(badge).toHaveTextContent("99+");
  });
});

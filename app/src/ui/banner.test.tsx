import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Banner, BannerRows, Notice } from "./banner";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Banner", () => {
  it("is a tinted notice with a 44px target in both themes", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <Banner to="/review" title="7 פריטים ממתינים" hint="3 חשבוניות פתוחות" />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /7 פריטים/ });
    expectTarget(link);
    expectThemePaint(link, "backgroundColor");
    render(<Notice tone="bad" title="לא הצלחנו להתחבר" body="בדקו את החיבור." />);
    expect(screen.getByRole("status")).toHaveTextContent("לא הצלחנו להתחבר");
  });

  it("draws one tinted card with a separate link per row (FLOW-321)", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <BannerRows
          rows={[
            { id: "review", to: "/review", title: "7 פריטים ממתינים לאישור" },
            { id: "unpaid", to: "/unpaid", title: "3 חשבוניות פתוחות", hint: "₪23,400 · לגבייה" },
          ]}
        />
      </MemoryRouter>,
    );
    const card = document.querySelector(".ui-banner-rows");
    expect(card).not.toBeNull();
    expect(card?.tagName).toBe("UL");
    if (card instanceof HTMLElement) expectThemePaint(card, "backgroundColor");
    const review = screen.getByRole("link", { name: "7 פריטים ממתינים לאישור" });
    const unpaid = screen.getByRole("link", { name: "3 חשבוניות פתוחות ₪23,400 · לגבייה" });
    expect(review).toHaveAttribute("href", "/review");
    expect(unpaid).toHaveAttribute("href", "/unpaid");
    expectTarget(review);
    expectTarget(unpaid);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("draws the plain banner for one row and nothing for none", () => {
    const { container, unmount } = render(
      <MemoryRouter>
        <BannerRows rows={[{ id: "unpaid", to: "/unpaid", title: "חשבונית פתוחה אחת" }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "חשבונית פתוחה אחת" })).toHaveClass("ui-banner");
    expect(container.querySelector(".ui-banner-rows")).toBeNull();
    unmount();
    const empty = render(
      <MemoryRouter>
        <BannerRows rows={[]} />
      </MemoryRouter>,
    );
    expect(empty.container).toBeEmptyDOMElement();
  });
});

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ScreenHeader } from "./screen-header";
import { expectRtl, expectTarget } from "./test-support";

describe("ScreenHeader", () => {
  it("titles a screen, and the back control is 44px", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <>
          <ScreenHeader title="עזרה" subtitle="לעזרה בכניסה כותבים לנו." />
          <ScreenHeader title="פרויקטים" backTo="/" />
        </>
      </MemoryRouter>,
    );
    const title = screen.getByRole("heading", { name: "עזרה" });
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(title).toHaveClass("ui-focus-title");
    expectTarget(screen.getByRole("button", { name: "חזרה" }));
  });

  it("stacks the title under the bar", () => {
    render(
      <MemoryRouter>
        <ScreenHeader
          layout="stacked"
          title="פיצול בין פרויקטים"
          subtitle="מלט"
          subtitleClassName="ui-split-context"
        />
      </MemoryRouter>,
    );
    const title = screen.getByRole("heading", { name: "פיצול בין פרויקטים" });
    expect(title).toHaveClass("t-title-1");
    expect(title.closest("header")).toHaveClass("ui-page-stacked");
    expect(screen.getByText("מלט")).toHaveClass("ui-split-context");
    expect(screen.getByText("מלט")).toHaveClass("text-text-secondary");
  });

  it("puts a title with Back on its own line, on the start side, under the bar (FLOW-326)", () => {
    const { container } = render(
      <MemoryRouter>
        <ScreenHeader title="קטגוריות" kicker="הגדרות" subtitle="שורה" backTo="/settings" />
      </MemoryRouter>,
    );
    const header = container.querySelector("header");
    expect(header).toHaveClass("ui-page-stacked");
    const bar = header?.querySelector(".ui-page-title-row");
    const back = screen.getByRole("button", { name: "חזרה" });
    const title = screen.getByRole("heading", { name: "קטגוריות" });
    expect(bar).toContainElement(back);
    expect(bar).not.toContainElement(title);
    // Mockup 07: Back, then the kicker, then the title.
    const order = Array.from(header?.children ?? []).map((node) => node.textContent);
    expect(order).toEqual(["", "הגדרות", "קטגוריות", "שורה"]);
  });

  it("keeps a tab root, a compact bar, and an explicit inline title on the bar", () => {
    const { container } = render(
      <MemoryRouter>
        <>
          <ScreenHeader title="הגדרות" />
          <ScreenHeader title="הוצאה" size="compact" leading={<button type="button">חזרה</button>} />
          <ScreenHeader title="לאישור" layout="inline" backTo="/" />
        </>
      </MemoryRouter>,
    );
    const headers = Array.from(container.querySelectorAll("header"));
    expect(headers).toHaveLength(3);
    for (const header of headers) {
      expect(header).not.toHaveClass("ui-page-stacked");
      expect(header.querySelector(".ui-page-title-row h1")).not.toBeNull();
    }
  });
});

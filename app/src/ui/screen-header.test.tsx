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
    expectTarget(screen.getByRole("link", { name: "חזרה" }));
  });
});

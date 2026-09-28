import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PageTitle, ScreenHeader } from "./screen-header";
import { expectRtl, expectTarget } from "./test-support";

describe("ScreenHeader", () => {
  it("titles a screen, and the back control is 44px", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <>
          <ScreenHeader title="עזרה" subtitle="לעזרה בכניסה כותבים לנו." />
          <PageTitle title="פרויקטים" backTo="/" />
        </>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "עזרה" })).toBeInTheDocument();
    expectTarget(screen.getByRole("link", { name: "חזרה" }));
  });
});

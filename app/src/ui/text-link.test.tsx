import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it } from "vitest";
import { TextLink } from "./text-link";
import { expectRtl, expectTarget } from "./test-support";

describe("TextLink", () => {
  it("keeps a 44px hit area in RTL", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <TextLink to="/sign-in">חזרה</TextLink>
      </MemoryRouter>,
    );
    expectTarget(screen.getByRole("link", { name: "חזרה" }));
  });
});
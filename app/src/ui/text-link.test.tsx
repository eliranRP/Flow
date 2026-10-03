import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
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

  it("uses the label as the accessible name and marks a busy retry", () => {
    render(
      <TextLink label="ניסיון חוזר: SUMIT" busy onClick={() => undefined}>ניסיון חוזר</TextLink>,
    );
    const retry = screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" });
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveTextContent("ניסיון חוזר");
  });
});
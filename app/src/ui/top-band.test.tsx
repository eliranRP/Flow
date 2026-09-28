import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TopBand } from "./top-band";
import { expectRtl } from "./test-support";

describe("TopBand", () => {
  it("keeps the same violet band in light and dark", () => {
    expectRtl();
    render(
      <TopBand>
        <h1>רווח</h1>
      </TopBand>,
    );
    const band = screen.getByRole("banner");
    expect(band).toHaveClass("band");
    expect(screen.getByText("Flow")).toHaveAttribute("dir", "ltr");
    document.documentElement.dataset.theme = "light";
    const light = getComputedStyle(document.documentElement).getPropertyValue("--color-band").trim();
    document.documentElement.dataset.theme = "dark";
    const dark = getComputedStyle(document.documentElement).getPropertyValue("--color-band").trim();
    expect(light).toBe("#7B3FE4");
    expect(dark).toBe(light);
  });
});

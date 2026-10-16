import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartsBar } from "./parts-bar";
import { expectRtl } from "./test-support";

function partWidths(): number[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".ui-parts-part, .ui-parts-rest")).map((el) =>
    Number(el.style.flexGrow),
  );
}

describe("PartsBar", () => {
  it("names the bar for screen readers and sizes each part by its value", () => {
    expectRtl();
    render(
      <PartsBar
        label="החזר"
        total={100}
        parts={[
          { key: "principal", value: 60, tone: "accent" },
          { key: "interest", value: 25, tone: "accent-dim" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "החזר" })).toBeInTheDocument();
    expect(partWidths()).toEqual([60, 25, 15]);
  });

  it("widths add up to the total, and the rest is the track", () => {
    render(<PartsBar label="x" total={100n} parts={[{ key: "a", value: 40n, tone: "accent" }]} />);
    const widths = partWidths();
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(document.querySelector(".ui-parts-rest")).not.toBeNull();
  });

  it("draws nothing for a zero part", () => {
    render(
      <PartsBar
        label="x"
        parts={[
          { key: "zero", value: 0, tone: "accent" },
          { key: "a", value: 5, tone: "accent" },
        ]}
      />,
    );
    expect(document.querySelectorAll(".ui-parts-part")).toHaveLength(1);
  });

  it("marks parts over the total and takes the signal colour", () => {
    render(<PartsBar label="x" total={100} parts={[{ key: "a", value: 130, tone: "accent" }]} />);
    expect(document.querySelector(".ui-parts-part")).toHaveAttribute("data-over", "true");
    expect(document.querySelector(".ui-parts-rest")).toBeNull();
  });

  it("shows a legend line per part with a dot in its tone", () => {
    render(
      <PartsBar
        label="x"
        parts={[{ key: "interest", value: 1, tone: "accent-dim" }]}
        legend={[{ key: "interest", label: "ריבית", value: "25%" }]}
      />,
    );
    expect(screen.getByText("ריבית")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(document.querySelector(".ui-parts-dot")).toHaveAttribute("data-tone", "accent-dim");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, Section } from "./card";
import { expectRtl, expectThemePaint } from "./test-support";

describe("Card", () => {
  it("uses the surface token in both themes", () => {
    expectRtl();
    render(
      <Card>
        <p>כרטיס</p>
      </Card>,
    );
    expectThemePaint(screen.getByText("כרטיס").parentElement ?? document.body, "backgroundColor");
    render(
      <Section title="מקטע">
        <p>תוכן</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { name: "מקטע" })).toBeInTheDocument();
  });
});

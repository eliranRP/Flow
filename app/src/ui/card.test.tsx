import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./card";

describe("Card", () => {
  it("renders the element named by as, and passes its labels through", () => {
    const { container } = render(
      <Card as="section" aria-labelledby="card-title">
        <h2 id="card-title">כותרת</h2>
      </Card>,
    );
    const section = container.querySelector("section");
    expect(section).toHaveClass("ui-card");
    expect(section).toHaveAttribute("aria-labelledby", "card-title");
    expect(container.querySelector("div")).toBeNull();
  });

  it("is a div by default and has no tint", () => {
    const { container } = render(<Card>תוכן</Card>);
    const div = container.querySelector("div");
    expect(div).toHaveClass("ui-card");
    expect(div).not.toHaveClass("ui-card-tint");
  });

  it("takes the tint class for tone tint", () => {
    const { container } = render(<Card tone="tint">דורש טיפול</Card>);
    expect(container.querySelector("div")).toHaveClass("ui-card", "ui-card-tint");
  });
});

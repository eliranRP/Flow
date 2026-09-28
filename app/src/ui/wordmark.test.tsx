import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "./wordmark";
import { expectRtl } from "./test-support";

describe("Wordmark", () => {
  it("is the LTR word Flow", () => {
    expectRtl();
    render(<Wordmark />);
    expect(screen.getByText("Flow")).toHaveAttribute("dir", "ltr");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SyncStrip } from "./sync-strip";
import { expectRtl } from "./test-support";

const label = "מסנכרן עם Mercury…";

describe("SyncStrip (FLOW-371)", () => {
  it("renders nothing when no sync runs", () => {
    expectRtl();
    const { container } = render(<SyncStrip label={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the line and the pill with its label at once", () => {
    const { container } = render(<SyncStrip label={label} />);
    expect(container.querySelector(".ui-sync-line")).not.toBeNull();
    expect(container.querySelector(".ui-sync-spin")).not.toBeNull();
    // The label stays in the text under reduced motion, where the line and spinner stop.
    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(container.querySelector(".ui-sync-pill")).toHaveTextContent(label);
  });
});

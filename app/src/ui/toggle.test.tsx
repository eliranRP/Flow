import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Toggle } from "./toggle";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

function Harness() {
  const [on, setOn] = useState(false);
  return <Toggle label="אחרי חלק בכלליות" hint="כבוי" checked={on} onChange={setOn} />;
}

describe("Toggle", () => {
  it("starts off and meets the 44px target in both themes", () => {
    expectRtl();
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: /אחרי חלק בכלליות/ });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expectTarget(toggle);
    expectThemePaint(toggle, "color");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

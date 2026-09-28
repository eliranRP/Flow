import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PeriodPicker } from "./period-picker";
import { expectRtl, expectTarget } from "./test-support";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <PeriodPicker
      pill="כל התקופה"
      open={open}
      onOpenChange={setOpen}
      options={[{ label: "החודש", onSelect: () => undefined }]}
    />
  );
}

describe("PeriodPicker", () => {
  it("opens the period dialog from a 44px pill", () => {
    expectRtl();
    render(<Harness />);
    const pill = screen.getByRole("button", { name: "כל התקופה" });
    expectTarget(pill);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.getByRole("dialog", { name: "תקופה" })).toBeInTheDocument();
    expectTarget(screen.getByRole("radio", { name: "החודש" }));
  });
});

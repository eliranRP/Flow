import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PercentField } from "./money-field";

function Field({ start = "" }: { start?: string }) {
  const [share, setShare] = useState(start);
  return <PercentField label="אחוז, חולון" value={share} onValueChange={setShare} />;
}

describe("PercentField", () => {
  it("keeps digits, at most two decimal places, and an empty value", () => {
    const { unmount } = render(<Field start="9" />);
    const input = screen.getByRole("textbox", { name: "אחוז, חולון" });
    fireEvent.change(input, { target: { value: "12.349x" } });
    expect(input).toHaveValue("12.34");
    fireEvent.change(input, { target: { value: "8" } });
    expect(input).toHaveValue("8");
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue("");
    unmount();

    render(<Field />);
    expect(screen.getByRole("textbox", { name: "אחוז, חולון" })).toHaveValue("");
  });
});

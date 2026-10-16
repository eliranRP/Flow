import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchField } from "./search-field";

function Field({ start = "", busy = false, onChange = () => undefined }: { start?: string; busy?: boolean; onChange?: (value: string) => void }) {
  const [text, setText] = useState(start);
  return (
    <SearchField
      label="חיפוש תנועות"
      value={text}
      busy={busy}
      onChange={(next) => {
        setText(next);
        onChange(next);
      }}
    />
  );
}

describe("SearchField", () => {
  it("the clear button clears the query", () => {
    const onChange = vi.fn();
    render(<Field start="הרצל" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "ניקוי" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByRole("searchbox", { name: "חיפוש תנועות" })).toHaveValue("");
  });

  it("busy hides the clear button, shows a spinner, and sets aria-busy on the box", () => {
    const { container } = render(<Field start="הרצל" busy />);
    expect(screen.queryByRole("button", { name: "ניקוי" })).not.toBeInTheDocument();
    expect(container.querySelector(".ui-search")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".ui-search-spinner")).not.toBeNull();
  });

  it("an idle box has no busy marker and keeps its clear button", () => {
    const { container } = render(<Field start="הרצל" />);
    expect(container.querySelector(".ui-search")).not.toHaveAttribute("aria-busy");
    expect(container.querySelector(".ui-search-spinner")).toBeNull();
    expect(screen.getByRole("button", { name: "ניקוי" })).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconRow } from "./icon-row";
import { ProjectsIcon } from "./icons";

const base = { icon: <ProjectsIcon />, label: "פרויקט", value: "שיפוץ דירה" };

describe("IconRow", () => {
  it("is a button named by its label and value, and a click opens it", () => {
    const onClick = vi.fn();
    render(<IconRow {...base} onClick={onClick} />);
    const row = screen.getByRole("button", { name: "פרויקט שיפוץ דירה" });
    expect(row).toHaveClass("ui-icon-row", "ui-row");
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("titled puts the label first as the bold title and the value under it as the muted line, the name unchanged", () => {
    render(<IconRow {...base} titled label="פיצול" value="בין פרויקטים" onClick={() => undefined} />);
    const row = screen.getByRole("button", { name: "פיצול בין פרויקטים" });
    expect(row.querySelector(".ui-icon-row-label")).toBeNull();
    expect(row.querySelector(".ui-icon-row-value")).toHaveTextContent("פיצול");
    expect(row.querySelector(".ui-icon-row-hint")).toHaveTextContent("בין פרויקטים");
  });

  it("endTag sits in the row, outside the text block", () => {
    render(<IconRow {...base} endTag={<span>כל חודש</span>} onClick={() => undefined} />);
    const tag = screen.getByText("כל חודש");
    expect(tag.closest(".ui-icon-row-text")).toBeNull();
    expect(tag.closest(".ui-icon-row")).not.toBeNull();
  });

  it("shows the hint as its description", () => {
    render(<IconRow {...base} hint="כסף שזז בבנק" onClick={() => undefined} />);
    expect(screen.getByRole("button", { name: "פרויקט שיפוץ דירה" })).toHaveAccessibleDescription("כסף שזז בבנק");
  });

  it("with an action, the row is static and the action is a separate button named by its label", () => {
    const onAction = vi.fn();
    render(<IconRow {...base} action={{ label: "שינוי", onClick: onAction }} />);
    expect(screen.queryByRole("button", { name: "פרויקט שיפוץ דירה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שינוי" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("a static row has no button", () => {
    render(<IconRow {...base} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("שיפוץ דירה")).toBeInTheDocument();
  });

  it("busy shows a spinner in the chevron slot, sets aria-busy, and ignores taps", () => {
    const onClick = vi.fn();
    const { container } = render(<IconRow {...base} onClick={onClick} busy />);
    const row = screen.getByRole("button", { name: "פרויקט שיפוץ דירה" });
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".ui-icon-row-end .ui-spinner")).not.toBeNull();
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled is a disabled button and does not fire", () => {
    const onClick = vi.fn();
    render(<IconRow {...base} onClick={onClick} disabled />);
    const row = screen.getByRole("button", { name: "פרויקט שיפוץ דירה" });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("an accent value takes the accent class, and an ordinary value does not", () => {
    const { container, rerender } = render(<IconRow {...base} value="בחרו פרויקט" valueTone="accent" onClick={() => undefined} />);
    expect(container.querySelector(".ui-icon-row-value")).toHaveClass("ui-icon-row-value-accent");
    rerender(<IconRow {...base} onClick={() => undefined} />);
    expect(container.querySelector(".ui-icon-row-value")).not.toHaveClass("ui-icon-row-value-accent");
  });
});

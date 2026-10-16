import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Button } from "./button";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Button", () => {
  it("draws primary, secondary, pill, and danger at a 44px target in both themes", () => {
    expectRtl();
    render(
      <>
        <Button variant="primary">אישור</Button>
        <Button variant="secondary">שינוי</Button>
        <Button variant="pill">סימון</Button>
        <Button variant="danger">מחיקה</Button>
      </>,
    );
    for (const name of ["אישור", "שינוי", "מחיקה"]) {
      expectTarget(screen.getByRole("button", { name }));
    }
    expectTarget(screen.getByRole("button", { name: "סימון" }));
    expect(screen.getByRole("button", { name: "אישור" })).toHaveClass("ui-btn-primary");
    expect(screen.getByRole("button", { name: "מחיקה" })).toHaveClass("ui-btn-danger");
    expectThemePaint(screen.getByRole("button", { name: "אישור" }), "backgroundColor");
    expectThemePaint(screen.getByRole("button", { name: "מחיקה" }), "color");
  });

  it.each([
    ["primary", "אישור"],
    ["secondary", "שינוי"],
    ["link", "לכל החיובים"],
    ["danger-link", "מחיקה"],
  ] as const)("%s renders its variant class and the press utility", (variant, name) => {
    render(<Button variant={variant}>{name}</Button>);
    const button = screen.getByRole("button", { name });
    expect(button).toHaveClass(`ui-btn-${variant}`);
    expect(button).toHaveClass("m-press");
  });

  it("scales on press for primary and secondary only", () => {
    render(
      <>
        <Button variant="primary">אישור</Button>
        <Button variant="secondary">שינוי</Button>
        <Button variant="link">לכל החיובים</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "אישור" })).toHaveClass("m-press-scale");
    expect(screen.getByRole("button", { name: "שינוי" })).toHaveClass("m-press-scale");
    expect(screen.getByRole("button", { name: "לכל החיובים" })).not.toHaveClass("m-press-scale");
  });

  it("renders the chevron after the label only when asked", () => {
    const { container, rerender } = render(
      <Button variant="link" chevron>
        לכל החיובים
      </Button>,
    );
    const label = container.querySelector(".ui-btn-label");
    expect(label?.nextElementSibling?.tagName.toLowerCase()).toBe("svg");

    rerender(<Button variant="link">לכל החיובים</Button>);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("disabled: the native attribute blocks the click", () => {
    const onClick = vi.fn();
    render(
      <Button variant="secondary" disabled onClick={onClick}>
        שינוי
      </Button>,
    );
    const button = screen.getByRole("button", { name: "שינוי" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled link: sets aria-disabled and does not navigate", () => {
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Routes>
          <Route
            path="/start"
            element={
              <Button variant="link" to="/target" disabled>
                לכל החיובים
              </Button>
            }
          />
          <Route path="/target" element={<p>יעד</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "לכל החיובים" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(link);
    expect(screen.queryByText("יעד")).toBeNull();
  });

  it("busy: sets aria-busy, blocks the click, and keeps the label", () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        שומר…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "שומר…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByText("שומר…")).toBeInTheDocument();
  });

  it("busy: keeps its label and puts the spinner inside the same button (FLOW-371)", () => {
    const { container } = render(
      <Button variant="primary" busy>
        שומר…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "שומר…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector(".ui-spinner")).not.toBeNull();
    expect(container.querySelectorAll(".ui-spinner")).toHaveLength(1);
  });

  it("variant link with `to` renders a router anchor", () => {
    render(
      <MemoryRouter>
        <Button variant="link" to="/settings">
          הגדרות
        </Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "הגדרות" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/settings");
  });
});

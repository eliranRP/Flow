import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Button } from "./button";
import { expectRtl, expectTarget, expectThemePaint } from "./test-support";

describe("Button", () => {
  it("draws primary, secondary, link, and danger-link at a 44px target in both themes", () => {
    expectRtl();
    render(
      <>
        <Button variant="primary">אישור</Button>
        <Button variant="secondary">שינוי</Button>
        <Button variant="link">סימון</Button>
        <Button variant="danger-link">מחיקה</Button>
      </>,
    );
    for (const name of ["אישור", "שינוי", "סימון", "מחיקה"]) {
      expectTarget(screen.getByRole("button", { name }));
    }
    expect(screen.getByRole("button", { name: "אישור" })).toHaveClass("ui-btn-primary");
    expect(screen.getByRole("button", { name: "מחיקה" })).toHaveClass("ui-btn-danger-link");
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

  // The text-link cases (T-10 folded TextLink into the link variant).
  it("a link keeps a 44px hit area in RTL, as a route link and as a button", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <Button variant="link" to="/sign-in">חזרה</Button>
        <Button variant="link" onClick={() => undefined}>עוד פריטים</Button>
      </MemoryRouter>,
    );
    expectTarget(screen.getByRole("link", { name: "חזרה" }));
    expectTarget(screen.getByRole("button", { name: "עוד פריטים" }));
  });

  it("uses aria-label as the accessible name and marks a busy retry", () => {
    render(<Button variant="link" aria-label="ניסיון חוזר: SUMIT" busy onClick={() => undefined}>ניסיון חוזר</Button>);
    const retry = screen.getByRole("button", { name: "ניסיון חוזר: SUMIT" });
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).toHaveTextContent("ניסיון חוזר");
  });

  it("href renders a plain anchor, and external opens a new tab and says so", () => {
    render(
      <>
        <Button variant="link" href="mailto:ops@example.com">ops@example.com</Button>
        <Button variant="link" href="https://example.com/help" external>עזרה</Button>
      </>,
    );
    const mail = screen.getByRole("link", { name: "ops@example.com" });
    expect(mail).toHaveAttribute("href", "mailto:ops@example.com");
    expect(mail).not.toHaveAttribute("target");
    const outside = screen.getByRole("link", { name: /עזרה/ });
    expect(outside).toHaveAttribute("target", "_blank");
    expect(outside).toHaveAttribute("rel", "noopener noreferrer");
    expect(outside).toHaveTextContent("(נפתח בלשונית חדשה)");
  });

  it("route links can replace the history entry and a disabled href anchor does not follow", () => {
    render(
      <MemoryRouter>
        <Button variant="link" to="/settings" replace>הגדרות</Button>
        <Button variant="link" href="https://example.com/x" disabled>סגור</Button>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "הגדרות" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "סגור" })).toHaveAttribute("aria-disabled", "true");
  });

  it("expanded draws a chevron that turns when open, and names aria-expanded and aria-controls", () => {
    const { container, rerender } = render(<Button variant="link" expanded={false} controls="more" onClick={() => undefined}>עוד</Button>);
    const button = screen.getByRole("button", { name: "עוד" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "more");
    expect(container.querySelector(".ui-chevron-turn")).toHaveAttribute("data-open", "false");
    rerender(<Button variant="link" expanded controls="more" onClick={() => undefined}>עוד</Button>);
    expect(screen.getByRole("button", { name: "עוד" })).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".ui-chevron-turn")).toHaveAttribute("data-open", "true");
  });

  it("quiet is a class on the link and the label keeps the clip-check mark", () => {
    const { container } = render(<Button variant="link" quiet onClick={() => undefined}>ביטול השינוי</Button>);
    expect(screen.getByRole("button", { name: "ביטול השינוי" })).toHaveClass("ui-btn-quiet");
    expect(container.querySelector(".ui-btn-label")).toHaveAttribute("data-clip-ok", "");
  });
});

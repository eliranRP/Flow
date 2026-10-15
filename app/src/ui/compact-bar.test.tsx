import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CompactBar } from "./compact-bar";
import { ReducedMotionFrame } from "./reduced-motion";
import { expectRtl } from "./test-support";

function bar(props: Partial<Parameters<typeof CompactBar>[0]> & { shown: boolean }) {
  return (
    <MemoryRouter>
      <CompactBar title="שויכו היום" backTo="/review" {...props} />
    </MemoryRouter>
  );
}

describe("CompactBar", () => {
  it("slides in with m-bar-in when shown, and is in the reader's tree", () => {
    expectRtl();
    const { container } = render(bar({ shown: true }));
    const root = container.querySelector(".ui-compact-bar");
    expect(root).toHaveClass("m-bar-in");
    expect(root).not.toHaveClass("m-bar-out");
    expect(root).not.toHaveAttribute("inert");
    expect(root).toHaveAttribute("aria-hidden", "false");
  });

  it("slides out with m-bar-out, then leaves the focus order once the animation ends", () => {
    const { container, rerender } = render(bar({ shown: true }));
    rerender(bar({ shown: false }));
    const root = container.querySelector(".ui-compact-bar") as HTMLElement;
    expect(root).toHaveClass("m-bar-out");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("inert");
    expect(root).not.toHaveClass("ui-compact-bar-gone");
    fireEvent.animationEnd(root);
    expect(root).toHaveClass("ui-compact-bar-gone");
    expect(root).not.toHaveClass("m-bar-out");
    expect(screen.queryByRole("button", { name: "חזרה" })).toBeNull();
  });

  it("starts hidden without a slide, so a page that has not scrolled shows no bar", () => {
    const { container } = render(bar({ shown: false }));
    const root = container.querySelector(".ui-compact-bar");
    expect(root).toHaveClass("ui-compact-bar-gone");
    expect(root).not.toHaveClass("m-bar-out");
    expect(root).not.toHaveClass("m-bar-in");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("inert");
  });

  it("comes back in on a second show, with the same state as the first", () => {
    const { container, rerender } = render(bar({ shown: false }));
    rerender(bar({ shown: true }));
    const root = container.querySelector(".ui-compact-bar");
    expect(root).toHaveClass("m-bar-in");
    expect(root).not.toHaveClass("ui-compact-bar-gone");
    expect(root).not.toHaveAttribute("inert");
  });

  it("puts the figure after the title inside an LTR bdi", () => {
    const { container } = render(bar({ shown: true, figure: <span>1,250</span> }));
    const figure = container.querySelector(".ui-compact-title bdi");
    expect(figure).toHaveAttribute("dir", "ltr");
    expect(figure).toHaveTextContent("1,250");
    expect(container.querySelector(".ui-compact-title")).toHaveTextContent("שויכו היום · 1,250");
  });

  it("names the labelled Back after its label, and keeps the icon Back without one", () => {
    const { rerender } = render(bar({ shown: true, label: "הגדרות" }));
    expect(screen.getByRole("button", { name: "חזרה להגדרות" })).toHaveTextContent("הגדרות");
    rerender(bar({ shown: true }));
    expect(screen.getByRole("button", { name: "חזרה" })).toBeInTheDocument();
  });

  it("has no Back when there is no place to go back to", () => {
    const { container } = render(bar({ shown: true, backTo: undefined }));
    expect(container.querySelector(".ui-compact-bar button")).toBeNull();
  });

  it("is 44px on a list page and 56px on a detail page", () => {
    const { container, rerender } = render(bar({ shown: true }));
    expect(container.querySelector(".ui-compact-bar")).toHaveClass("ui-compact-bar-list");
    rerender(bar({ shown: true, size: "detail" }));
    expect(container.querySelector(".ui-compact-bar")).toHaveClass("ui-compact-bar-detail");
  });

  it("keeps the shown and hidden states under reduced motion, with no slide to wait for", () => {
    const frame = (props: Parameters<typeof bar>[0]) => <ReducedMotionFrame>{bar(props)}</ReducedMotionFrame>;
    const { container, rerender } = render(frame({ shown: false }));
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    expect(container.querySelector(".ui-compact-bar")).toHaveClass("ui-compact-bar-gone");
    rerender(frame({ shown: true }));
    expect(container.querySelector(".ui-compact-bar")).toHaveClass("m-bar-in");
    expect(container.querySelector(".ui-compact-bar")).not.toHaveAttribute("inert");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "./status-dot";
import { expectRtl, expectThemePaint } from "./test-support";

describe("StatusDot", () => {
  it("is coloured text in the neutral tone by default, with no dot", () => {
    expectRtl();
    render(<StatusDot>שולם</StatusDot>);
    const label = screen.getByText("שולם");
    const wrapper = label.closest(".ui-status");
    expect(wrapper).toHaveClass("ui-status-neutral");
    expect(wrapper?.querySelector(".ui-status-dot")).toBeNull();
    expect(label).toHaveClass("t-meta");
    expect(label).toHaveAttribute("data-clip-ok");
    expectThemePaint(label, "color");
  });

  it("takes the accent and signal tones", () => {
    render(
      <>
        <StatusDot tone="accent">פתוח</StatusDot>
        <StatusDot tone="signal">מעל</StatusDot>
      </>,
    );
    expect(screen.getByText("פתוח").closest(".ui-status")).toHaveClass("ui-status-accent");
    expect(screen.getByText("מעל").closest(".ui-status")).toHaveClass("ui-status-signal");
  });

  it("draws a dot, hidden from readers, when dot is set", () => {
    const { container } = render(
      <StatusDot tone="signal" dot>
        בהמתנה
      </StatusDot>,
    );
    const dot = container.querySelector(".ui-status-dot");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveClass("ui-status-dot-signal");
    expect(dot?.closest(".ui-status")).toHaveClass("ui-status-neutral");
    expect(screen.getByText("בהמתנה")).toBeInTheDocument();
  });

  it("keeps an icon before the label and leaves it out of the words", () => {
    const { container } = render(<StatusDot icon={<svg aria-hidden="true" />}>שולם</StatusDot>);
    expect(container.querySelector(".ui-status-icon svg")).not.toBeNull();
    expect(screen.getByText("שולם").closest(".ui-status")?.textContent).toBe("שולם");
  });
});

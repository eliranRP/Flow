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

  it("renders the panel under the row and reports the taller panel bar", () => {
    const { container, rerender } = render(bar({ shown: true, panel: <span>לפי תאריך</span> }));
    const root = container.querySelector(".ui-compact-bar");
    expect(root?.querySelector(".ui-compact-bar-row + .ui-compact-panel")).toHaveTextContent("לפי תאריך");
    expect(document.documentElement).toHaveAttribute("data-compact-bar", "panel");
    rerender(bar({ shown: true }));
    expect(document.documentElement).toHaveAttribute("data-compact-bar", "list");
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

describe("CompactBar on Home (FLOW-364)", () => {
  it("is the colour band with its arrows and centre, in one row", () => {
    const { container } = render(
      <MemoryRouter>
        <CompactBar
          title=""
          shown
          tone="band"
          start={<button type="button">חודש קודם</button>}
          centre={<button type="button">בחירת חודש</button>}
          end={<button type="button">חודש הבא</button>}
        />
      </MemoryRouter>,
    );
    const root = container.querySelector(".ui-compact-bar");
    expect(root).toHaveClass("ui-compact-bar-band", "m-bar-in");
    expect(root?.querySelector(".ui-compact-bar-band-row")?.textContent).toBe("חודש קודםבחירת חודשחודש הבא");
  });

  it("uses the past month's colour for a past month", () => {
    const { container } = render(
      <MemoryRouter>
        <CompactBar title="" shown tone="band-past" centre={<button type="button">בחירת חודש</button>} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".ui-compact-bar")).toHaveClass("ui-compact-bar-band-past");
  });
});

describe("CompactBar docks a control (FLOW-1043)", () => {
  function band(props: { shown?: boolean; docked?: boolean; dock?: boolean }) {
    return (
      <MemoryRouter>
        <CompactBar
          title=""
          shown={props.shown ?? true}
          tone="band"
          centre={<button type="button">בחירת חודש</button>}
          dock={props.dock === false ? undefined : <button type="button">הכול</button>}
          docked={props.docked}
        />
      </MemoryRouter>
    );
  }

  it("reports a bar with a centre as the 64px band bar", () => {
    const { unmount } = render(band({ dock: false }));
    expect(document.documentElement).toHaveAttribute("data-compact-bar", "band");
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-compact-bar");
  });

  it("keeps the dock row rendered but closed, inert and hidden until docked", () => {
    const { container, rerender } = render(band({ docked: false }));
    const dock = container.querySelector(".ui-compact-bar > .ui-compact-dock");
    expect(dock).not.toBeNull();
    expect(dock).not.toHaveAttribute("data-open");
    expect(dock).toHaveAttribute("aria-hidden", "true");
    expect(dock).toHaveAttribute("inert");
    expect(document.documentElement).not.toHaveAttribute("data-compact-dock");
    rerender(band({ docked: true }));
    expect(dock).toHaveAttribute("data-open");
    expect(dock).toHaveAttribute("aria-hidden", "false");
    expect(dock).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "הכול" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-compact-dock", "on");
    rerender(band({ docked: false }));
    expect(document.documentElement).not.toHaveAttribute("data-compact-dock");
  });

  it("closes the dock with the bar, and counts open docks like the bars", () => {
    const { rerender } = render(
      <>
        {band({ docked: true })}
        {bar({ shown: true, dock: <span>הכול</span>, docked: true })}
      </>,
    );
    expect(document.documentElement).toHaveAttribute("data-compact-dock", "on");
    rerender(
      <>
        {band({ docked: true, shown: false })}
        {bar({ shown: true, dock: <span>הכול</span>, docked: true })}
      </>,
    );
    expect(document.documentElement).toHaveAttribute("data-compact-dock", "on");
    expect(document.documentElement).toHaveAttribute("data-compact-bar", "list");
    rerender(
      <>
        {band({ docked: true, shown: false })}
        {bar({ shown: true, dock: <span>הכול</span>, docked: false })}
      </>,
    );
    expect(document.documentElement).not.toHaveAttribute("data-compact-dock");
  });

  it("puts the dock row under a list bar's row too", () => {
    const { container } = render(bar({ shown: true, dock: <span>הכול</span>, docked: true }));
    expect(container.querySelector(".ui-compact-bar-row + .ui-compact-dock")).toHaveAttribute("data-open");
  });
});


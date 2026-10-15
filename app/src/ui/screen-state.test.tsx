import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenState } from "./screen-state";
import { SKELETON_DELAY_MS } from "./skeleton";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const SYNC_LABEL = "מסנכרן עם Mercury…";

function loadingState(): ReactElement {
  return <ScreenState title="פרויקטים" phase={{ kind: "loading" }} onRetry={() => undefined} />;
}

describe("ScreenState loading (FLOW-371)", () => {
  it("shows no skeleton before 300ms, then the skeleton", () => {
    const { container } = render(<MemoryRouter>{loadingState()}</MemoryRouter>);
    expect(container.querySelector(".ui-skel-row")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(container.querySelectorAll(".ui-skel-row").length).toBeGreaterThan(0);
  });

  it("fades the ready content in over 200ms", () => {
    const { container } = render(
      <MemoryRouter>
        <ScreenState title="פרויקטים" phase={{ kind: "ready" }} onRetry={() => undefined}>
          <p>תוכן</p>
        </ScreenState>
      </MemoryRouter>,
    );
    expect(screen.getByText("תוכן").parentElement).toHaveClass("ui-phase-in");
    expect(container.querySelector(".ui-skel-row")).toBeNull();
  });

  it("shows the sync strip with its label while a sync runs", () => {
    render(
      <MemoryRouter>
        <ScreenState title="פרויקטים" phase={{ kind: "ready" }} onRetry={() => undefined} syncing={SYNC_LABEL}>
          <p>תוכן</p>
        </ScreenState>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(SYNC_LABEL);
  });
});

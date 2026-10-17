import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CashHomeSkeleton } from "./home-skeleton";
import { renderWithProviders } from "../test-render";
import { SKELETON_DELAY_MS } from "../ui/skeleton";
import { expectRtl } from "../ui/test-support";

describe("CashHomeSkeleton (FLOW-364)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the band with its real month and icons, then the split card and the box", () => {
    expectRtl();
    renderWithProviders(<CashHomeSkeleton />);
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    const band = document.querySelector(".ui-band");
    expect(band).not.toBeNull();
    expect(band?.querySelector(".ui-band-month-static")).not.toBeNull();
    expect(band?.querySelector(".ui-band-body .ui-skel-band-hero")).not.toBeNull();
    expect(band?.querySelectorAll(".ui-skel-band-row")).toHaveLength(2);
    expect(band?.querySelector('[aria-label="חיפוש"]')).not.toBeNull();
    expect(document.querySelector(".ui-home-split")).not.toBeNull();
    expect(document.querySelectorAll(".ui-home-attention .ui-skel-row")).toHaveLength(2);
    expect(document.querySelectorAll(".ui-skel-list .ui-skel-row")).toHaveLength(3);
    expect(screen.getByText("טוען…")).toBeInTheDocument();
    // No past-month list is loaded on Home any more (FLOW-364).
    expect(screen.queryByText("חודשים קודמים")).toBeNull();
  });

  it("shows nothing before the delay", () => {
    renderWithProviders(<CashHomeSkeleton />);
    expect(screen.queryByText("טוען…")).toBeNull();
    expect(document.querySelector(".ui-home-split")).toBeNull();
  });
});


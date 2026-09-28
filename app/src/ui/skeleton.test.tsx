import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSkeleton, Loader } from "./skeleton";
import { expectRtl } from "./test-support";

describe("Skeleton", () => {
  it("keeps the home skeleton chrome and a loader status", () => {
    expectRtl();
    render(
      <>
        <HomeSkeleton />
        <Loader />
      </>,
    );
    expect(screen.getAllByText("טוען…").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "פרויקטים מובילים" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});

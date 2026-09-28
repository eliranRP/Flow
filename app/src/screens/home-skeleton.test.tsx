import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSkeleton } from "./home-skeleton";
import { expectRtl } from "../ui/test-support";

describe("HomeSkeleton", () => {
  it("matches the home loading chrome and hides the preview label", () => {
    expectRtl();
    render(<HomeSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("טוען…");
    expect(screen.getByRole("heading", { name: "פרויקטים מובילים" })).toBeInTheDocument();
    expect(screen.queryByText("מצב תצוגה")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-spinner")).toBeNull();
    expect(document.querySelector(".ui-skel-pill")).not.toBeNull();
    expect(document.querySelector(".ui-skeleton-hero")).not.toBeNull();
    expect(document.querySelector(".ui-skel-card")).not.toBeNull();
  });
});

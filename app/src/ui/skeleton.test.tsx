import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSkeleton } from "./skeleton";
import { expectRtl } from "./test-support";

describe("Skeleton", () => {
  it("keeps the home skeleton chrome without a standalone spinner", () => {
    expectRtl();
    render(<HomeSkeleton />);
    expect(screen.getByText("טוען…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "פרויקטים מובילים" })).toBeInTheDocument();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(document.querySelector(".ui-spinner")).toBeNull();
  });
});

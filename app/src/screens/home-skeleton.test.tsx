import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomeSkeleton } from "./home-skeleton";
import { expectRtl } from "../ui/test-support";

describe("HomeSkeleton", () => {
  it("matches the home loading chrome and hides the preview label", () => {
    expectRtl();
    render(<MemoryRouter><HomeSkeleton /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("טוען…");
    expect(screen.getByRole("heading", { name: "פרויקטים מובילים" })).toBeInTheDocument();
    expect(screen.queryByText("מצב תצוגה")).not.toBeInTheDocument();
    expect(screen.queryByText("Flow")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-spinner")).toBeNull();
    expect(screen.getByRole("button", { name: "החודש" })).toBeInTheDocument();
    expect(document.querySelector(".ui-skel-pill")).toBeNull();
    expect(document.querySelector(".ui-skeleton-hero")).not.toBeNull();
    expect(document.querySelector(".ui-skel-explain")).not.toBeNull();
    expect(document.querySelector(".ui-skel-card")).not.toBeNull();
    expect(document.querySelector(".ui-band .ui-hero")).not.toBeNull();
    expect(document.querySelector(".ui-flow")).not.toBeNull();
    expect(document.querySelectorAll(".ui-skel-figure")).toHaveLength(2);
    expect(document.querySelector(".ui-skel-greet-a")).toBeNull();
    expect(document.querySelector(".ui-skel-delta-a")).toBeNull();
  });

  it("keeps the preview label on a preview load", () => {
    render(<MemoryRouter><HomeSkeleton preview /></MemoryRouter>);
    expect(screen.getByText("מצב תצוגה")).toBeInTheDocument();
  });
});

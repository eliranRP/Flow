import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TransactionTopBar } from "./transaction-top-bar";

describe("TransactionTopBar (FLOW-366)", () => {
  it("names the back step by the lines it came from, and hides the title until it is scrolled past", () => {
    render(
      <MemoryRouter>
        <TransactionTopBar fallback="/cash/2026-10/in/ILS" backLabel="נכנס" title="The Home Depot · $1,284.50" end={<span />} />
      </MemoryRouter>,
    );
    expect(screen.getByText("נכנס")).toBeInTheDocument();
    expect(screen.getByText("The Home Depot · $1,284.50")).toHaveAttribute("aria-hidden", "true");
  });
});

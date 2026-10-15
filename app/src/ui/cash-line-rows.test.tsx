import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { sampleMonthLines } from "../dev/project-month-sample";
import { CashLineRows, CashMonthLines } from "./cash-line-rows";

describe("cash line rows (FLOW-442)", () => {
  const lines = sampleMonthLines("2026-09");

  it("names a kept-out loan part on the לא נספר ברווח list, out of the whole payment", () => {
    const { container } = render(
      <MemoryRouter>
        <CashLineRows rows={lines.kept} list="kept" search="" />
      </MemoryRouter>,
    );
    expect(screen.getByText("קרן")).toBeInTheDocument();
    expect((container.textContent ?? "").replace(/\u00a0/g, " ")).toContain("מתוך $3,500");
    expect(screen.queryByText(/תשלומי הלוואה/)).not.toBeInTheDocument();
  });

  it("names it the same way among a month's lines", () => {
    const { container } = render(
      <MemoryRouter>
        <CashMonthLines counted={lines.counted} kept={lines.kept} search="" />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("קרן");
    expect(text).toContain("מתוך $3,500");
    expect(text).toContain("ריבית");
    expect(text).not.toContain("תשלומי הלוואה");
  });
});

import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { periodSearch, presetPeriod, type PeriodChoice } from "./period";
import { useProjectPeriod, withPeriodSearch } from "./project-period";

let setPeriod: (period: PeriodChoice) => void = () => undefined;
let navigate: ReturnType<typeof useNavigate> = () => undefined;

function Probe() {
  const [period, set] = useProjectPeriod();
  setPeriod = set;
  navigate = useNavigate();
  return <p data-testid="period">{JSON.stringify(periodSearch(period))}</p>;
}

function Line() {
  navigate = useNavigate();
  return <p>line</p>;
}

function shown(): Record<string, string> {
  return JSON.parse(screen.getByTestId("period").textContent) as Record<string, string>;
}

describe("a project's own period (decision 0141)", () => {
  it("starts from the URL's period, and Back to the entry restores the one it showed", () => {
    render(
      <MemoryRouter initialEntries={["/projects", "/projects/p1?period=month&at=2026-08"]} initialIndex={1}>
        <Routes>
          <Route path="/projects/:id" element={<Probe />} />
          <Route path="/transactions/:id" element={<Line />} />
          <Route path="/projects" element={<p>list</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(shown()).toEqual({ period: "month", at: "2026-08" });
    const year = presetPeriod("year", new Date(), "2025-12");
    act(() => {
      setPeriod(year);
    });
    expect(shown()).toEqual({ period: "year", at: "2025-12" });
    act(() => {
      void navigate("/transactions/t1");
    });
    expect(screen.getByText("line")).toBeInTheDocument();
    act(() => {
      void navigate(-1);
    });
    expect(shown()).toEqual({ period: "year", at: "2025-12" });
  });

  it("keeps preview and other params when it writes the period into a link", () => {
    expect(withPeriodSearch("?preview=1&period=all", presetPeriod("month", new Date(), "2026-09"))).toBe("?preview=1&period=month&at=2026-09");
  });
});

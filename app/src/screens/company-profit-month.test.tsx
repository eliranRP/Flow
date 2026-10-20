import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { renderWithProviders } from "../test-render";
import { CompanyProfitScreen } from "./company-profit-screen";

const read = vi.hoisted(() => ({ calls: [] as { month: { from: string | null; to: string | null }; ytd: { from: string | null; to: string | null }; overhead?: unknown }[] }));

vi.mock("../ui/date-math", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ui/date-math")>()), israelToday: () => "2026-10-18" }));
// The overhead project's read still loading (owner 20/10).
vi.mock("../project-cash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../project-cash")>()),
  useOverheadProject: () => ({ project: undefined, failed: false, refetch: () => undefined }),
}));
vi.mock("../use-company-profit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-company-profit")>()),
  useCompanyProfitRead: (args: (typeof read.calls)[number]) => {
    read.calls.push(args);
    return { model: null, failed: false, refetch: () => undefined };
  },
}));

describe("CompanyProfitScreen month", () => {
  it("opens on Home's earlier month: that month's lines and its year to date", () => {
    read.calls.length = 0;
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?month=2026-04" });
    const last = read.calls.at(-1);
    expect(last?.month).toMatchObject({ from: "2026-04-01", to: "2026-04-30" });
    expect(last?.ytd).toMatchObject({ from: "2026-01-01", to: "2026-04-30" });
    expect(screen.getAllByText("רווח אפריל").length).toBeGreaterThan(0);
  });

  it("opens on the current month without ?month=, its year to date ending today", () => {
    read.calls.length = 0;
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit" });
    const last = read.calls.at(-1);
    expect(last?.month).toMatchObject({ from: "2026-10-01", to: "2026-10-18" });
    expect(last?.ytd).toMatchObject({ from: "2026-01-01", to: "2026-10-18" });
  });

  it("an earlier month says it is closed", () => {
    renderWithProviders(<CompanyProfitScreen sample={{ ...COMPANY_PROFIT_SAMPLE, monthKey: "2026-09" }} />, { route: "/profit?month=2026-09" });
    expect(screen.getByText("ספטמבר 2026 · חודש סגור")).toBeTruthy();
  });

  it("the current month reads to today", () => {
    renderWithProviders(<CompanyProfitScreen sample={COMPANY_PROFIT_SAMPLE} />, { route: "/profit" });
    expect(screen.getByText("אוקטובר 2026 · עד היום")).toBeTruthy();
  });

  it("only the לפי פרויקט list waits for the overhead project's read; the other orders never do", () => {
    read.calls.length = 0;
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit" });
    expect(read.calls.at(-1)?.overhead).toBeUndefined();
    read.calls.length = 0;
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?by=category" });
    expect(read.calls.at(-1)?.overhead).toBeNull();
    read.calls.length = 0;
    renderWithProviders(<CompanyProfitScreen />, { route: "/profit?by=date" });
    expect(read.calls.at(-1)?.overhead).toBeNull();
  });
});

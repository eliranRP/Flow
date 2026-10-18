import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUNIPER_MONTH_PROFIT } from "../dev/profit-month-sample";
import { sideMinor } from "../cash-lines-groups";
import { ProjectMonthProfitScreen, type ProjectMonthProfitSample } from "./project-month-profit-screen";

type Call = { name: string; args: unknown };
const rpc = vi.hoisted(() => ({
  calls: [] as Call[],
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

afterEach(() => {
  rpc.calls = [];
  rpc.impl = () => Promise.resolve({ data: null, error: null });
});

function withProject(fields: Record<string, unknown>): ProjectMonthProfitSample {
  return { ...JUNIPER_MONTH_PROFIT, project: { ...JUNIPER_MONTH_PROFIT.project, ...fields } };
}

function renderAt(path: string, sample: ProjectMonthProfitSample) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId/profit/:month" element={<ProjectMonthProfitScreen sample={sample} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectMonthProfitScreen", () => {
  it("the month's counted lines add up to its profit", () => {
    const total = JUNIPER_MONTH_PROFIT.lines.reduce((sum, line) => sum + sideMinor(line, "kept"), 0n);
    expect(total).toBe(379_560n);
  });

  it("lists the lines by day, newest day first, under the default date order", () => {
    const { container } = renderAt("/projects/juniper-ct/profit/2026-10", JUNIPER_MONTH_PROFIT);
    const heads = Array.from(container.querySelectorAll(".ui-lines-group-title")).map((head) => head.textContent);
    expect(heads).toEqual(["10/10", "08/10", "06/10", "04/10", "03/10", "01/10"]);
    expect(screen.getByRole("heading", { name: /רווח/ })).toBeTruthy();
  });

  it("the category view groups income then expenses, each head with its total", () => {
    const { container } = renderAt("/projects/juniper-ct/profit/2026-10?order=category", JUNIPER_MONTH_PROFIT);
    const heads = Array.from(container.querySelectorAll(".ui-lines-group-head"));
    expect(heads.map((head) => head.querySelector(".ui-lines-group-title")?.textContent)).toEqual(["הכנסות", "הוצאות"]);
    expect(heads.map((head) => head.querySelector(".ui-lines-group-sum")?.textContent)).toEqual(["+$6,302", "$2,506"]);
  });

  it("lists one row per category, largest first, with its share, count and total", () => {
    const { container } = renderAt("/projects/juniper-ct/profit/2026-10?order=category", JUNIPER_MONTH_PROFIT);
    const rows = Array.from(container.querySelectorAll(".ui-pcat-button"));
    expect(rows.map((row) => row.querySelector(".ui-pcat-name")?.textContent)).toEqual(["שכירות", "החזר ביטוח", "ריבית הלוואות", "תיקונים ותחזוקה", "מסים וביטוח"]);
    expect(rows.map((row) => row.querySelector(".ui-pcat-meta")?.textContent)).toEqual([
      "66% מההכנסות · 2 תנועות",
      "34% מההכנסות · 1 תנועה",
      "47% מההוצאות · 1 תנועה",
      "42% מההוצאות · 2 תנועות",
      "11% מההוצאות · 1 תנועה",
    ]);
    expect(rows[0]).toHaveTextContent("+$4,150");
    expect(rows[0]?.querySelector(".ui-income")).not.toBeNull();
    expect(rows[2]).toHaveTextContent("$1,180");
    expect(rows[2]?.textContent).not.toContain("+");
    expect(rows[2]?.querySelector(".ui-income")).toBeNull();
  });

  it("scales each bar to the largest category of its group", () => {
    const { container } = renderAt("/projects/juniper-ct/profit/2026-10?order=category", JUNIPER_MONTH_PROFIT);
    const widths = Array.from(container.querySelectorAll<HTMLElement>(".ui-pcat-bar-fill")).map((bar) => bar.style.width);
    expect(widths).toEqual(["100%", "52%", "100%", "89%", "24%"]);
  });

  it("opens a category in place to its lines, newest first, and closes it on a second tap", () => {
    const { container } = renderAt("/projects/juniper-ct/profit/2026-10?order=category", JUNIPER_MONTH_PROFIT);
    const links = () => Array.from(container.querySelectorAll("a[href^=\"/transactions/\"]")).map((link) => link.getAttribute("href"));
    const rows = Array.from(container.querySelectorAll(".ui-pcat-button"));
    const [rent, , , repairs] = rows;
    if (rent == null || repairs == null) throw new Error("missing category rows");
    expect(rows.map((row) => row.getAttribute("aria-expanded"))).toEqual(["false", "false", "false", "false", "false"]);
    expect(links()).toEqual([]);
    fireEvent.click(rent);
    expect(rent.getAttribute("aria-expanded")).toBe("true");
    expect(links()).toEqual(["/transactions/t-kim", "/transactions/t-ortiz"]);
    expect(rent.parentElement).toHaveTextContent("03/10");
    fireEvent.click(repairs);
    expect(rent.getAttribute("aria-expanded")).toBe("false");
    expect(links()).toEqual(["/transactions/t-northline", "/transactions/t-clearflow"]);
    fireEvent.click(repairs);
    expect(repairs.getAttribute("aria-expanded")).toBe("false");
    expect(links()).toEqual([]);
  });

  it("shows the month's share of the general expenses and the profit it leaves", () => {
    renderAt("/projects/juniper-ct/profit/2026-10", JUNIPER_MONTH_PROFIT);
    expect(screen.getByText("חלק בהוצאות הכלליות").parentElement).toHaveTextContent("$152");
    expect(screen.getByText("רווח אחרי הוצאות כלליות").parentElement).toHaveTextContent("$3,644");
  });

  it("shows neither row when the project's overhead is not weighted or has no share", () => {
    const unweighted = renderAt("/projects/juniper-ct/profit/2026-10", withProject({ overhead_weighted: false }));
    expect(screen.queryByText("חלק בהוצאות הכלליות")).toBeNull();
    expect(screen.queryByText("רווח אחרי הוצאות כלליות")).toBeNull();
    unweighted.unmount();
    renderAt("/projects/juniper-ct/profit/2026-10", withProject({ overhead_share_minor: null }));
    expect(screen.queryByText("חלק בהוצאות הכלליות")).toBeNull();
  });

  it("shows neither row when the share is in another currency than the figures", () => {
    renderAt("/projects/juniper-ct/profit/2026-10", withProject({ base_currency: "ILS" }));
    expect(screen.queryByText("חלק בהוצאות הכלליות")).toBeNull();
    expect(screen.queryByText("רווח אחרי הוצאות כלליות")).toBeNull();
  });

  it("a share above the profit is a loss, with the minus sign and the loss class", () => {
    renderAt("/projects/juniper-ct/profit/2026-10", withProject({ overhead_share_minor: 400_000n }));
    const row = screen.getByText("רווח אחרי הוצאות כלליות").parentElement;
    expect(row).toHaveTextContent("\u2212$204");
    expect(row?.querySelector(".ui-amount-loss, [class*=\"loss\"]")).not.toBeNull();
  });

  it("a live read takes the share from get_project for the month's range", async () => {
    rpc.impl = (name) => Promise.resolve({
      data: name === "get_project"
        ? {
            id: "p1", name: "פרויקט לדוגמה", status: "active", state_label: "פעיל", budget_agorot: null,
            income_agorot: 630_200, direct_agorot: 250_640, shared_agorot: 0, profit_agorot: 379_560,
            overhead_weighted: true, overhead_share_minor: 15_200, base_currency: "ILS", categories: [], transactions: [],
          }
        : null,
      error: null,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/projects/p1/profit/2026-09"]}>
          <Routes>
            <Route path="/projects/:projectId/profit/:month" element={<ProjectMonthProfitScreen />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const share = await screen.findByText("חלק בהוצאות הכלליות");
    expect(share.parentElement).toHaveTextContent("₪152");
    expect(screen.getByText("רווח אחרי הוצאות כלליות").parentElement).toHaveTextContent("₪3,644");
    const read = rpc.calls.find((call) => call.name === "get_project");
    expect(read?.args).toMatchObject({ p_id: "p1", p_from: "2026-09-01", p_to: "2026-09-30" });
  });
});

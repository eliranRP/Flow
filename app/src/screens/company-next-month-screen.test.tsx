import { formatAmountText } from "@flow/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { companyCashForecast, companyForecastCaption, companyNextMonthForecast } from "../company-next-month";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_PROJECTS, NEXT_MONTH_TODAY } from "../dev/home-next-month-sample";
import { JUNIPER_NEXT_LOAN } from "../dev/project-next-month-sample";
import { NOT_IN_PROFIT_LABEL } from "../cash";
import type { ForecastLoan } from "../project-next-loans";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { CompanyNextMonthScreen } from "./company-next-month-screen";

const reads = HOME_NEXT_MONTH_SAMPLE.next;
const FORECAST = companyCashForecast(companyNextMonthForecast({ currency: "USD", today: NEXT_MONTH_TODAY, recurring: reads.recurring, loans: reads.loans, categories: reads.categories, inputs: reads.inputs }));
const signed = (minor: bigint) => formatAmountText(minor, "USD", { plus: minor > 0n, direction: minor > 0n ? "income" : undefined });

function renderPage() {
  return renderWithProviders(<CompanyNextMonthScreen sample={reads} today={NEXT_MONTH_TODAY} projects={NEXT_MONTH_PROJECTS.projects} currency="USD" />, { route: "/forecast/next" });
}

describe("CompanyNextMonthScreen (FLOW-1000)", () => {
  it("leads with the cards' תזרים צפוי and says what the sum covers", () => {
    const { container } = renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "צפי נובמבר" })).toBeInTheDocument();
    expect(screen.getByText(`כל החברה · ${companyForecastCaption(FORECAST)} · ${String(FORECAST.rows.length)} צפויות`)).toBeInTheDocument();
    expect(container.querySelector(".ui-pn-figure-label")?.textContent).toBe("תזרים צפוי");
    expect(container.querySelector(".ui-pp-figure")?.textContent).toBe(signed(FORECAST.netMinor));
    const rows = Array.from(container.querySelectorAll(".ui-pp-row")).map((row) => row.textContent);
    expect(rows.slice(0, 2)).toEqual([`צפוי להיכנס${signed(FORECAST.incomeMinor)}`, `צפוי לצאת${formatAmountText(FORECAST.expenseMinor, "USD")}`]);
  });

  it("has one section per project in the Projects tab's order, the general costs last, each with its own net", () => {
    const { container } = renderPage();
    const sections = Array.from(container.querySelectorAll(".ui-cn-group"));
    expect(sections).toHaveLength(FORECAST.parts.length);
    const names = sections.map((section) => section.querySelector(".ui-cn-name")?.textContent);
    expect(names.at(-1)).toBe("כללי");
    const nets = FORECAST.parts.map((part) => part.forecast.netMinor);
    expect(nets.reduce((sum, net) => sum + net, 0n)).toBe(FORECAST.netMinor);
    for (const part of FORECAST.parts.filter((item) => item.projectId != null)) {
      const name = NEXT_MONTH_PROJECTS.projects.find((row) => row.id === part.projectId)?.name ?? "";
      const head = screen.getByRole("link", { name: new RegExp(`^${name}`, "u") });
      expect(head).toHaveAttribute("href", `/projects/${part.projectId ?? ""}`);
      expect(head.textContent).toContain(formatAmountText(part.forecast.netMinor, "USD", { plus: part.forecast.netMinor > 0n, direction: part.forecast.netMinor > 0n ? "income" : undefined }));
    }
  });

  it("opens a project's row on its existing edit page; the general costs' rows are read only", () => {
    const { container } = renderPage();
    const sections = Array.from(container.querySelectorAll<HTMLElement>(".ui-cn-group"));
    const project = FORECAST.parts.find((part) => part.projectId != null);
    const first = project?.forecast.rows[0];
    expect(first).toBeDefined();
    const section = sections.find((item) => item.getAttribute("aria-label")?.startsWith(NEXT_MONTH_PROJECTS.projects.find((row) => row.id === project?.projectId)?.name ?? "-") === true);
    const link = within(section as HTMLElement).getByRole("link", { name: new RegExp(`^${first?.name ?? ""}`, "u") });
    expect(link).toHaveAttribute("href", `/projects/${project?.projectId ?? ""}/profit/next/edit/${encodeURIComponent(first?.key ?? "")}`);
    // The general costs: only the heading links, to the overhead project; no row opens an edit page.
    const general = sections.at(-1) as HTMLElement;
    const links = within(general).queryAllByRole("link");
    expect(links.map((item) => item.getAttribute("href"))).toEqual([`/projects/${NEXT_MONTH_PROJECTS.projects.find((row) => row.is_overhead)?.id ?? ""}`]);
  });

  it("shows three rows a project, then links the rest to that project's צפי page", () => {
    renderPage();
    const big = FORECAST.parts.find((part) => part.projectId != null && part.forecast.rows.length + (part.forecast.cashOnlyMinor > 0n ? 1 : 0) > 3);
    expect(big).toBeDefined();
    const name = NEXT_MONTH_PROJECTS.projects.find((row) => row.id === big?.projectId)?.name ?? "";
    const extra = (big?.forecast.rows.length ?? 0) + ((big?.forecast.cashOnlyMinor ?? 0n) > 0n ? 1 : 0) - 3;
    expect(screen.getByRole("link", { name: `עוד ${String(extra)} בצפי של ${name}` })).toHaveAttribute("href", `/projects/${big?.projectId ?? ""}/profit/next`);
  });
});

describe("CompanyNextMonthScreen phases and holds (FLOW-1000 r1)", () => {
  it("shows the skeleton while loading and the failure with נסו שוב on an error, never 'nothing expected'", () => {
    const loading = renderWithProviders(<CompanyNextMonthScreen />, { route: "/forecast/next?preview=loading" });
    expect(loading.container.querySelector(".ui-pp-figure")).toBeNull();
    expect(screen.queryByText("אין תנועות צפויות בחודש הבא.")).toBeNull();
    loading.unmount();
    renderWithProviders(<CompanyNextMonthScreen />, { route: "/forecast/next?preview=error-server" });
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.queryByText("אין תנועות צפויות בחודש הבא.")).toBeNull();
  });

  it("a viewer reads the rows: no row opens an edit page", () => {
    const { container } = renderWithProviders(
      <ViewerPreview>
        <CompanyNextMonthScreen sample={reads} today={NEXT_MONTH_TODAY} projects={NEXT_MONTH_PROJECTS.projects} currency="USD" />
      </ViewerPreview>,
      { route: "/forecast/next" },
    );
    expect(container.querySelectorAll(".ui-pn-rows .ui-row").length).toBeGreaterThan(0);
    const rowLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>(".ui-pn-rows a"));
    expect(rowLinks.filter((link) => link.getAttribute("href")?.includes("/profit/next/edit/") === true)).toHaveLength(0);
  });

  it("lists a project's part the profit leaves out as its last row, and counts it in עוד N", () => {
    // The loan's escrow files to a category the company does not have: it is cash the profit leaves out.
    const loan = { ...(JUNIPER_NEXT_LOAN.loans?.[0] as ForecastLoan), projectId: "p1" };
    const sample = { ...reads, loans: [loan] };
    const forecast = companyCashForecast(companyNextMonthForecast({ currency: "USD", today: NEXT_MONTH_TODAY, recurring: sample.recurring, loans: sample.loans, categories: sample.categories, inputs: sample.inputs }));
    const part = forecast.parts.find((item) => item.projectId === "p1");
    expect((part?.forecast.cashOnlyMinor ?? 0n) > 0n).toBe(true);
    const { container } = renderWithProviders(<CompanyNextMonthScreen sample={sample} today={NEXT_MONTH_TODAY} projects={NEXT_MONTH_PROJECTS.projects} currency="USD" />, { route: "/forecast/next" });
    const section = Array.from(container.querySelectorAll<HTMLElement>(".ui-cn-group")).find((item) => item.getAttribute("aria-label")?.startsWith("בית הדקל") === true);
    // The project's own rows and that part: three or fewer, so all show and that part is the last.
    expect((part?.forecast.rows.length ?? 0) + 1).toBeLessThanOrEqual(3);
    const titles = Array.from(section?.querySelectorAll(".ui-row-title") ?? []).map((title) => title.textContent);
    expect(titles.at(-1)).toBe(NOT_IN_PROFIT_LABEL);
    expect(within(section as HTMLElement).queryByRole("link", { name: /^עוד /u })).toBeNull();
  });
});

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { devProjectsCash } from "../dev/projects-sample";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_PROJECTS, NEXT_MONTH_TODAY } from "../dev/home-next-month-sample";
import { companyCashForecast, companyForecastCaption, companyNextMonthForecast } from "../company-next-month";
import { renderWithProviders } from "../test-render";
import { sampleDashboard } from "../ui/screen-stories-support";
import { ProjectsScreen } from "./projects-screen";

describe("ProjectsScreen (FLOW-445b)", () => {
  it("lists the active projects and the overhead project's row under its own name, with no group rows", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} />);
    expect(screen.getByRole("link", { name: /^Lark Hill/ })).toHaveAttribute("href", "/projects/p2");
    const overhead = screen.getByRole("link", { name: /^משרד החברה \/ תקורה/ });
    expect(overhead).toHaveAttribute("href", "/projects/p0");
    expect(overhead).toHaveTextContent("תקורה · לא פרויקט");
    expect(document.querySelector('a[href*="/projects/groups/"]')).toBeNull();
  });

  it("a renamed overhead project shows its new name (owner 20/10)", () => {
    const renamed = { ...devProjectsCash, projects: devProjectsCash.projects.map((row) => (row.is_overhead ? { ...row, name: "הנהלה ומשרד" } : row)) };
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={renamed} />);
    expect(screen.getByRole("link", { name: /^הנהלה ומשרד/ })).toHaveAttribute("href", "/projects/p0");
    expect(screen.queryByText("משרד החברה / תקורה")).toBeNull();
  });

  it("names a project over its budget on its own row, and keeps the finished ones closed until opened", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} />);
    const over = screen.getByRole("link", { name: /^Elm Ct/ });
    expect(within(over).getByText(/מעל התקציב/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^פרויקט ישן/ })).not.toBeInTheDocument();
  });

  it("opens the finished projects at once with finishedOpen", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} finishedOpen />);
    expect(screen.getByRole("link", { name: /^פרויקט ישן/ })).toHaveTextContent("הסתיים");
  });

  it("with no project draws the board's empty state and its one action", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={{ ...devProjectsCash, projects: [] }} />);
    expect(screen.getByText("עוד אין פרויקטים")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט חדש" })).toBeInTheDocument();
  });

  it("FLOW-990: shows the company's next month above the list, and each project's own under its figure", () => {
    const next = HOME_NEXT_MONTH_SAMPLE.next;
    const forecast = companyCashForecast(companyNextMonthForecast({ currency: "USD", today: NEXT_MONTH_TODAY, recurring: next.recurring, loans: next.loans, categories: next.categories, inputs: next.inputs }));
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={NEXT_MONTH_PROJECTS} nextSample={HOME_NEXT_MONTH_SAMPLE} today={NEXT_MONTH_TODAY} />);
    expect(screen.getByText("נובמבר")).toBeInTheDocument();
    expect(screen.getByText(companyForecastCaption(forecast))).toBeInTheDocument();
    for (const part of forecast.parts.filter((item) => item.projectId != null)) {
      const row = NEXT_MONTH_PROJECTS.projects.find((item) => item.id === part.projectId);
      if (row == null) continue;
      expect(within(screen.getByRole("link", { name: new RegExp(`^${row.name}`, "u") })).getByText("צפי")).toBeInTheDocument();
    }
    // A project that expects nothing next month has no צפי figure.
    const quiet = NEXT_MONTH_PROJECTS.projects.filter((item) => !forecast.parts.some((part) => part.projectId === item.id));
    for (const row of quiet) expect(within(screen.getByRole("link", { name: new RegExp(`^${row.name}`, "u") })).queryByText("צפי")).toBeNull();
  });

  it("FLOW-990: no forecast sample, no card and no צפי figures", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} />);
    expect(screen.queryByText("צפוי להיכנס")).toBeNull();
    expect(screen.queryByText("צפי")).toBeNull();
  });
});

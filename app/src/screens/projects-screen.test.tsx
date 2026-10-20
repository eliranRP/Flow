import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { devProjectsCash } from "../dev/projects-sample";
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
});

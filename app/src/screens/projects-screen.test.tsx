import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { devProjectsCash } from "../dev/projects-sample";
import { renderWithProviders } from "../test-render";
import { sampleDashboard } from "../ui/screen-stories-support";
import { ProjectsScreen } from "./projects-screen";

describe("ProjectsScreen (FLOW-445b)", () => {
  it("lists the active projects and the general-expenses row, with no group rows", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} />);
    expect(screen.getByRole("link", { name: /^Lark Hill/ })).toHaveAttribute("href", "/projects/p2");
    expect(screen.getByRole("link", { name: /^הוצאות כלליות/ })).toBeInTheDocument();
    expect(document.querySelector('a[href*="/projects/groups/"]')).toBeNull();
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

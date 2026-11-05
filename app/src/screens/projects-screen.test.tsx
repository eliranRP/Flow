import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { devProjectsCash } from "../dev/projects-sample";
import { renderWithProviders } from "../test-render";
import { sampleDashboard } from "../ui/screen-stories-support";
import { ProjectsScreen } from "./projects-screen";

const NOW = new Date(2026, 9, 11, 12);

/** The rows of the list (the attention cards above them link to projects too). */
function group(title: string): HTMLElement {
  const head = screen.getByRole("heading", { name: title });
  const section = head.closest("section");
  if (section == null) throw new Error(`no group ${title}`);
  return section;
}

describe("ProjectsScreen (FLOW-445b, FLOW-1044)", () => {
  it("groups the active projects by kind, each head with its count and the month's total", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} recurringSample={{ late: [] }} now={NOW} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((head) => head.textContent)).toEqual(expect.arrayContaining(["שיפוץ", "השכרה", "לקוח", "תקורה"]));
    expect(within(group("שיפוץ")).getByRole("link", { name: /^Lark Hill/ })).toHaveAttribute("href", "/projects/p2");
    expect(within(group("השכרה")).getByRole("link", { name: /^Birch St/ })).toBeInTheDocument();
    const overhead = within(group("תקורה")).getByRole("link", { name: /^משרד החברה \/ תקורה/ });
    expect(overhead).toHaveAttribute("href", "/projects/p0");
    expect(overhead).toHaveTextContent("תקורה · לא פרויקט");
    expect(group("שיפוץ").querySelector(".ui-group-summary")?.textContent).toBe("2 · −$24,693");
    expect(document.querySelector('a[href*="/projects/groups/"]')).toBeNull();
  });

  it("names a project over its budget on its row, and keeps the finished ones under הסתיימו", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} recurringSample={{ late: [] }} now={NOW} />);
    expect(within(within(group("שיפוץ")).getByRole("link", { name: /^Elm Ct/ })).getByText(/מעל התקציב/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^פרויקט ישן/ })).not.toBeInTheDocument();
    const filter = screen.getAllByRole("radiogroup", { name: "סינון פרויקטים" })[0] as HTMLElement;
    fireEvent.click(within(filter).getByRole("radio", { name: "הסתיימו" }));
    expect(within(group("לקוח")).getByRole("link", { name: /^פרויקט ישן/ })).toHaveTextContent("רווח כולל");
    expect(screen.queryByRole("heading", { name: "שיפוץ" })).not.toBeInTheDocument();
  });

  it("opens on הסתיימו with finishedOpen", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} finishedOpen now={NOW} />);
    expect(screen.getByRole("link", { name: /^פרויקט ישן/ })).toHaveTextContent("הסתיים");
  });

  it("the band adds the month across the projects; the next-month card is gone", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} recurringSample={{ late: [] }} now={NOW} />);
    expect(screen.getByText("תזרים הפרויקטים · עד היום")).toBeInTheDocument();
    expect(screen.queryByText("צפוי להיכנס")).toBeNull();
    expect(screen.queryByText(/צפי לחודש הבא/u)).toBeNull();
  });

  it("דורש טיפול: the lines with no project open their list, and a budget past 80% its project", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} recurringSample={{ late: [] }} now={NOW} />);
    const cards = screen.getByRole("heading", { name: "דורש טיפול" }).closest("section") as HTMLElement;
    expect(within(cards).getByRole("link", { name: /שורה אחת בלי פרויקט/ }).getAttribute("href")).toMatch(/^\/projects\/unassigned\?/);
    expect(within(cards).getByRole("link", { name: /^Lark Hill · 80%/ })).toHaveAttribute("href", "/projects/p2");
    expect(within(cards).getByRole("link", { name: /^Elm Ct · מעל התקציב/ })).toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: /^הסתרה: Lark Hill/ })).toBeInTheDocument();
  });

  it("with no project draws the board's empty state and its one action", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={{ ...devProjectsCash, projects: [] }} now={NOW} />);
    expect(screen.getByText("עוד אין פרויקטים")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט חדש" })).toBeInTheDocument();
  });
});

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { devProjectsCash } from "../dev/projects-sample";
import { renderWithProviders } from "../test-render";
import { UNASSIGNED_SAMPLE } from "./project-unassigned-sample";
import { ProjectUnassignedScreen } from "./project-unassigned-screen";

describe("the lines with no project (FLOW-1044)", () => {
  it("lists the lines by month with the count, the total and a שיוך on each", () => {
    renderWithProviders(<ProjectUnassignedScreen sample={UNASSIGNED_SAMPLE} />);
    expect(screen.getByRole("heading", { level: 1, name: "שורות בלי פרויקט" })).toBeInTheDocument();
    expect(screen.getByText("3 תנועות")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "שיוך" }).length + screen.getAllByRole("link", { name: "שיוך" }).length).toBe(3);
    // A line with no category is assigned on its own page, where the category is set too.
    expect(screen.getByRole("link", { name: "שיוך" }).getAttribute("href")).toMatch(/^\/transactions\//);
  });

  it("offers the project the category names first, folds the row on a pick and offers ביטול", async () => {
    renderWithProviders(<ProjectUnassignedScreen sample={UNASSIGNED_SAMPLE} />);
    fireEvent.click(screen.getAllByRole("button", { name: "שיוך" })[0] as HTMLElement);
    const sheet = await screen.findByRole("dialog", { name: "לאיזה פרויקט?" });
    const radios = within(sheet).getAllByRole("radio");
    expect(radios[0]).toHaveAccessibleName(expect.stringContaining("Lark Hill") as string);
    expect(radios[0]).toHaveTextContent("מוצע");
    fireEvent.click(radios[0] as HTMLElement);
    expect(await screen.findByText("שויך לLark Hill")).toBeInTheDocument();
    expect(screen.getByText("2 תנועות")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("3 תנועות")).toBeInTheDocument();
  });

  it("with every line assigned, says so", () => {
    renderWithProviders(<ProjectUnassignedScreen sample={{ rows: [], projects: devProjectsCash.projects }} />);
    expect(screen.getByText("כל השורות משויכות")).toBeInTheDocument();
    expect(screen.getByText("הכול משויך")).toBeInTheDocument();
  });
});

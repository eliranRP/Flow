import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devProjectsCash } from "../dev/projects-sample";
import { renderWithProviders } from "../test-render";
import { UNASSIGNED_SAMPLE } from "./project-unassigned-sample";

const live = vi.hoisted((): { undoId: string | null; calls: { name: string; args: unknown }[] } => ({ undoId: "undo-1", calls: [] }));
// The live path (no sample): the search reads the sample's lines, the write returns live.undoId, and a new project is p-new.
vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      live.calls.push({ name, args });
      return Promise.resolve({ data: name === "reassign_transaction" ? live.undoId : name === "upsert_project" ? "p-new" : null, error: null });
    },
  }),
}));
vi.mock("../search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../search")>();
  const { UNASSIGNED_SAMPLE: sample } = await import("./project-unassigned-sample");
  const query = { data: { pages: [{ expenses: sample.rows, total: sample.rows.length, next: null }] }, isPending: false, isError: false, isPaused: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => undefined };
  return { ...actual, useSearchQuery: () => query };
});
vi.mock("../project-cash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project-cash")>();
  const { devProjectsCash } = await import("../dev/projects-sample");
  return { ...actual, useProjectsCashMonth: () => ({ data: { projects: devProjectsCash.projects } }) };
});
import { assignedToast, ProjectUnassignedScreen } from "./project-unassigned-screen";

describe("the lines with no project (FLOW-1044)", () => {
  afterEach(() => {
    live.undoId = "undo-1";
    live.calls.length = 0;
  });

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

  it("the live assign toast has no ביטול when reassign_transaction returns no id (FLOW-1089)", async () => {
    live.undoId = null;
    renderWithProviders(<ProjectUnassignedScreen />);
    await screen.findByText("3 תנועות");
    fireEvent.click(screen.getAllByRole("button", { name: "שיוך" })[0] as HTMLElement);
    const sheet = await screen.findByRole("dialog", { name: "לאיזה פרויקט?" });
    fireEvent.click(within(sheet).getAllByRole("radio")[0] as HTMLElement);
    expect(await screen.findByText("שויך לLark Hill")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
  });

  it("offers ביטול only when the write returned an undo id (FLOW-1089)", () => {
    expect(assignedToast("Lark Hill", null)).toEqual({ message: "שויך לLark Hill" });
    const undo = vi.fn();
    const withUndo = assignedToast("Lark Hill", undo);
    expect(withUndo.action).toBe("ביטול");
    withUndo.onAction?.();
    expect(undo).toHaveBeenCalledOnce();
  });

  it("+ פרויקט חדש creates the project, then assigns the line to it with ביטול (FLOW-1093)", async () => {
    renderWithProviders(<ProjectUnassignedScreen />);
    await screen.findByText("3 תנועות");
    fireEvent.click(screen.getAllByRole("button", { name: "שיוך" })[0] as HTMLElement);
    const picker = await screen.findByRole("dialog", { name: "לאיזה פרויקט?" });
    // The last row, after the projects.
    const create = within(picker).getByRole("button", { name: "+ פרויקט חדש" });
    expect(within(picker).getAllByRole("radio").at(-1)?.compareDocumentPosition(create)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(create);
    const sheet = await screen.findByRole("dialog", { name: "פרויקט חדש" });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לאיזה פרויקט?" })).toBeNull(); });
    // The name's inline error still stops an empty save.
    fireEvent.click(within(sheet).getByRole("button", { name: "יצירת פרויקט" }));
    expect(await within(sheet).findByText("צריך שם כדי ליצור את הפרויקט")).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("שם הפרויקט"), { target: { value: "Birch Lane" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "יצירת פרויקט" }));
    expect(await screen.findByText("שויך לBirch Lane")).toBeInTheDocument();
    const writes = live.calls.filter((call) => call.name === "upsert_project" || call.name === "reassign_transaction");
    expect(writes.map((call) => call.name)).toEqual(["upsert_project", "reassign_transaction"]);
    expect(writes[1]?.args).toMatchObject({ p_id: "u1", p_project_id: "p-new", p_category_id: "c-lark" });
    expect(screen.getByText("2 תנועות")).toBeInTheDocument();
    // The assign's toast stands for the create's: no "הפרויקט נוצר", and no jump to the new project's page.
    expect(screen.queryByText("הפרויקט נוצר")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "שורות בלי פרויקט" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("3 תנועות")).toBeInTheDocument();
  });

  it("with no active project, the picker says so and offers + פרויקט חדש (FLOW-1093)", async () => {
    renderWithProviders(<ProjectUnassignedScreen sample={{ rows: UNASSIGNED_SAMPLE.rows, projects: [] }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "שיוך" })[0] as HTMLElement);
    const picker = await screen.findByRole("dialog", { name: "לאיזה פרויקט?" });
    expect(within(picker).getByText("אין עדיין פרויקט לשייך אליו")).toBeInTheDocument();
    expect(within(picker).queryByRole("radio")).toBeNull();
    fireEvent.click(within(picker).getByRole("button", { name: "+ פרויקט חדש" }));
    expect(await screen.findByRole("dialog", { name: "פרויקט חדש" })).toBeInTheDocument();
  });

  it("with every line assigned, says so", () => {
    renderWithProviders(<ProjectUnassignedScreen sample={{ rows: [], projects: devProjectsCash.projects }} />);
    expect(screen.getByText("כל השורות משויכות")).toBeInTheDocument();
    expect(screen.getByText("הכול משויך")).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { cleanGroupName, groupMoveMessage, groupNameError, ProjectGroupSheets } from "./project-group-sheets";

const rpc = vi.hoisted(() => vi.fn((name: string, _args?: unknown) =>
  Promise.resolve({ data: name === "upsert_project_group" ? "g-new" : null, error: null })));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({ rpc }),
}));

const groups = [{ id: "g1", name: "בניין לדוגמה" }, { id: "g2", name: "מתחם לדוגמה" }];

function Harness({ currentId, start }: { currentId: string | null; start: "pick" | "new" }) {
  const [view, setView] = useState<"pick" | "new" | null>(start);
  return (
    <ProjectGroupSheets
      projectId="p1"
      groups={groups}
      currentId={currentId}
      view={view}
      onView={setView}
      onBack={() => { setView(null); }}
      blocked={() => false}
    />
  );
}

function renderSheets(currentId: string | null, start: "pick" | "new" = "pick") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>
            <Harness currentId={currentId} start={start} />
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("project group sheets (FLOW-360)", () => {
  it("words the toast for a move in and a move out", () => {
    expect(groupMoveMessage("מתחם הגפן", null)).toBe("הפרויקט עבר לקבוצה מתחם הגפן");
    expect(groupMoveMessage(null, "מתחם הגפן")).toBe("הפרויקט הוצא מהקבוצה מתחם הגפן");
    expect(groupNameError(" א ")).toMatch("קצר");
    expect(groupNameError("מתחם")).toBeUndefined();
  });

  it("moves the project on a tap, and ביטול puts it back", async () => {
    rpc.mockClear();
    renderSheets("g1");
    fireEvent.click(screen.getByRole("radio", { name: "מתחם לדוגמה" }));
    await screen.findByText("הפרויקט עבר לקבוצה מתחם לדוגמה");
    expect(rpc).toHaveBeenCalledWith("set_project_group", { p_project_id: "p1", p_group_id: "g2" });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenLastCalledWith("set_project_group", { p_project_id: "p1", p_group_id: "g1" });
    });
  });

  it("takes the project out with בלי קבוצה", async () => {
    rpc.mockClear();
    renderSheets("g1");
    fireEvent.click(screen.getByRole("radio", { name: "בלי קבוצה" }));
    await screen.findByText("הפרויקט הוצא מהקבוצה בניין לדוגמה");
    expect(rpc).toHaveBeenCalledWith("set_project_group", { p_project_id: "p1", p_group_id: null });
  });

  it("makes a new group and puts the project in it", async () => {
    rpc.mockClear();
    renderSheets(null, "new");
    fireEvent.change(screen.getByLabelText("שם הקבוצה"), { target: { value: "מתחם הגפן" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("הפרויקט עבר לקבוצה מתחם הגפן");
    expect(rpc).toHaveBeenCalledWith("upsert_project_group", { p_id: null, p_name: "מתחם הגפן" });
    expect(rpc).toHaveBeenCalledWith("set_project_group", { p_project_id: "p1", p_group_id: "g-new" });
  });

  it("cleans a name the way the server stores it, so the local duplicate check matches", () => {
    expect(cleanGroupName("  בניין\u00A0לדוגמה ")).toBe("בניין לדוגמה");
    expect(cleanGroupName("בניין  א")).toBe("בניין  א");
  });

  it("puts an existing name on the field instead of making a group", async () => {
    rpc.mockClear();
    renderSheets(null, "new");
    fireEvent.change(screen.getByLabelText("שם הקבוצה"), { target: { value: " בניין\u00A0לדוגמה" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("הפרויקט עבר לקבוצה בניין לדוגמה");
    expect(rpc).not.toHaveBeenCalledWith("upsert_project_group", expect.anything());
  });

  it("shows a refused name on the field, not in a toast", async () => {
    rpc.mockClear();
    rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: "project group already exists" } as never }));
    renderSheets(null, "new");
    fireEvent.change(screen.getByLabelText("שם הקבוצה"), { target: { value: "מתחם הגפן" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    const field = screen.getByLabelText("שם הקבוצה");
    await waitFor(() => {
      expect(field.getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getAllByText("כבר יש קבוצה בשם הזה.")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).toBeNull();
  });
});

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
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

type View = "pick" | "new" | null;

/** A get_project read of the page, for the cache: one period's key and its group (FLOW-1244). */
const PROJECT_KEY = ["project", "off", "p1", null, null];
const PERIOD_KEY = ["project", "off", "p1", "2026-01-01", "2026-12-31"];
const projectAnswer = (groupId: string | null) => ({ id: "p1", name: "בית לדוגמה", status: "active", state_label: null, group_id: groupId } as never);

/** A read of the project that never lands, so a refetch stays in flight (the sheet must close anyway). */
function HangingProjectRead() {
  useQuery({ queryKey: PROJECT_KEY, queryFn: () => new Promise<never>(() => undefined) });
  return null;
}

function Harness({ currentId, start, onViewSpy, onBackSpy, hang }: { currentId: string | null; start: "pick" | "new"; onViewSpy?: (view: View) => void; onBackSpy?: () => void; hang?: boolean }) {
  const [view, setView] = useState<View>(start);
  return (
    <>
      {hang ? <HangingProjectRead /> : null}
      <ProjectGroupSheets
        projectId="p1"
        groups={groups}
        currentId={currentId}
        view={view}
        onView={(next) => {
          onViewSpy?.(next);
          setView(next);
        }}
        onBack={() => {
          onBackSpy?.();
          setView(null);
        }}
        blocked={() => false}
      />
    </>
  );
}

function renderSheets(currentId: string | null, start: "pick" | "new" = "pick", options: { client?: QueryClient; onViewSpy?: (view: View) => void; onBackSpy?: () => void; hang?: boolean } = {}) {
  return render(
    <QueryClientProvider client={options.client ?? new QueryClient()}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>
            <Harness currentId={currentId} start={start} onViewSpy={options.onViewSpy} onBackSpy={options.onBackSpy} hang={options.hang} />
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

describe("a group move closes its sheet after the write, not after the refetch (FLOW-1244)", () => {
  it("closes the sheet when the write succeeds, while the project's refetch is still in flight", async () => {
    rpc.mockClear();
    const client = new QueryClient();
    const onViewSpy = vi.fn();
    renderSheets("g1", "pick", { client, onViewSpy, hang: true });
    fireEvent.click(screen.getByRole("radio", { name: "מתחם לדוגמה" }));
    await waitFor(() => { expect(onViewSpy).toHaveBeenCalledWith(null); });
    // The refetch of the project's read is still running: nothing waited for it.
    expect(client.getQueryState(PROJECT_KEY)?.fetchStatus).toBe("fetching");
  });

  it("sets the new group in every cached project answer at the tap, and ביטול sets the old one back", async () => {
    rpc.mockClear();
    const client = new QueryClient();
    client.setQueryData(PROJECT_KEY, projectAnswer("g1"));
    client.setQueryData(PERIOD_KEY, projectAnswer("g1"));
    renderSheets("g1", "pick", { client });
    fireEvent.click(screen.getByRole("radio", { name: "מתחם לדוגמה" }));
    await waitFor(() => { expect(client.getQueryData<{ group_id: string }>(PERIOD_KEY)?.group_id).toBe("g2"); });
    expect(client.getQueryData<{ group_id: string }>(PROJECT_KEY)?.group_id).toBe("g2");
    await screen.findByText("הפרויקט עבר לקבוצה מתחם לדוגמה");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(client.getQueryData<{ group_id: string }>(PROJECT_KEY)?.group_id).toBe("g1"); });
    expect(client.getQueryData<{ group_id: string }>(PERIOD_KEY)?.group_id).toBe("g1");
  });

  it("a failed write puts the old group back in the cache and keeps the sheet open", async () => {
    rpc.mockClear();
    // The write is held open, so the test sees the new group while it is pending, then the refusal.
    let refuse: (answer: unknown) => void = () => undefined;
    rpc.mockImplementationOnce((() => new Promise((resolve) => { refuse = resolve; })) as never);
    const client = new QueryClient();
    client.setQueryData(PROJECT_KEY, projectAnswer("g1"));
    const onViewSpy = vi.fn();
    renderSheets("g1", "pick", { client, onViewSpy });
    fireEvent.click(screen.getByRole("radio", { name: "מתחם לדוגמה" }));
    await waitFor(() => { expect(client.getQueryData<{ group_id: string }>(PROJECT_KEY)?.group_id).toBe("g2"); });
    expect(onViewSpy).not.toHaveBeenCalledWith(null);
    refuse({ data: null, error: { message: "boom" } });
    await screen.findByText("לא הצלחנו לשנות את הקבוצה.");
    expect(client.getQueryData<{ group_id: string }>(PROJECT_KEY)?.group_id).toBe("g1");
    expect(onViewSpy).not.toHaveBeenCalledWith(null);
  });

  it("a new group is set in the cached answers once its move has succeeded", async () => {
    rpc.mockClear();
    const client = new QueryClient();
    client.setQueryData(PROJECT_KEY, projectAnswer(null));
    renderSheets(null, "new", { client });
    fireEvent.change(screen.getByLabelText("שם הקבוצה"), { target: { value: "מתחם הגפן" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("הפרויקט עבר לקבוצה מתחם הגפן");
    expect(client.getQueryData<{ group_id: string }>(PROJECT_KEY)?.group_id).toBe("g-new");
  });

  it("marks the company's groups list stale after a move (FLOW-1245: a group write refreshes it)", async () => {
    rpc.mockClear();
    const client = new QueryClient();
    client.setQueryData(["project", "groups"], groups);
    renderSheets("g1", "pick", { client });
    fireEvent.click(screen.getByRole("radio", { name: "מתחם לדוגמה" }));
    await screen.findByText("הפרויקט עבר לקבוצה מתחם לדוגמה");
    await waitFor(() => { expect(client.getQueryState(["project", "groups"])?.isInvalidated).toBe(true); });
  });
});

describe("the picker waits for its move (FLOW-1256)", () => {
  it("Back and Escape leave the picker open while a move is pending, and Escape works once it settles", async () => {
    rpc.mockClear();
    // The move is held open, so the test sees the picker while it is pending, then the refusal.
    let refuse: (answer: unknown) => void = () => undefined;
    rpc.mockImplementationOnce((() => new Promise((resolve) => { refuse = resolve; })) as never);
    const onBackSpy = vi.fn();
    renderSheets("g1", "pick", { onBackSpy });
    fireEvent.click(screen.getByRole("radio", { name: "מתחם לדוגמה" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("set_project_group", { p_project_id: "p1", p_group_id: "g2" }); });
    expect(screen.getByRole("button", { name: "חזרה" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBackSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("radiogroup", { name: "קבוצה" })).toBeInTheDocument();
    refuse({ data: null, error: { message: "boom" } });
    await screen.findByText("לא הצלחנו לשנות את הקבוצה.");
    expect(screen.getByRole("button", { name: "חזרה" })).toBeEnabled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBackSpy).toHaveBeenCalledTimes(1);
  });
});

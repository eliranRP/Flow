import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { historyIndex, resetSheetHistoryLock, useSheetHistory } from "./back";
import { ChangeAssignment } from "./change-sheet";

// FLOW-1167 (owner, 2026-11-10): at the new-project view, the browser's Back and the sheet's חזרה
// both go one step back, to the picker. Real browser history (jsdom), in both of the sheet's modes.

const projects = [{ id: "p1", name: "בית הכרם" }, { id: "p2", name: "גבעת אורנים" }];
const categories = [{ id: "c1", name: "חשמל" }, { id: "c2", name: "אינסטלציה" }];

function shared(projectId: string, setProjectId: (id: string) => void, onCommitPick: (kind: "project" | "category", id: string) => Promise<undefined>) {
  return {
    supplier: "נגרייה לדוגמה",
    amount: "₪100",
    direction: "expense" as const,
    projects,
    categories,
    projectId,
    categoryId: "c1",
    onProjectId: setProjectId,
    onCategoryId: () => undefined,
    onCommitPick,
    onSplit: () => undefined,
    onCreateProject: (name: string) => Promise.resolve({ id: "p9", name }),
  };
}

function RouteChange({ onCommitPick }: { onCommitPick: (kind: "project" | "category", id: string) => Promise<undefined> }) {
  const [projectId, setProjectId] = useState("p1");
  return <ChangeAssignment host="route" closeTo="/review" {...shared(projectId, setProjectId, onCommitPick)} />;
}

/** A contained overlay with its own sheet entry, as the transaction screen opens it. */
function ContainedChange({ start, hold, onDiscard, onCommitPick }: {
  start: "summary" | "project";
  hold?: string;
  onDiscard?: () => void;
  onCommitPick: (kind: "project" | "category", id: string) => Promise<undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("p1");
  const leave = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const setSheet = useSheetHistory("change-test", open, setOpen, () => leave.current());
  return (
    <>
      <h1>תנועה</h1>
      <button type="button" onClick={() => { setSheet(true); }}>שינוי</button>
      <ChangeAssignment
        host="overlay"
        open={open}
        onOpenChange={setSheet}
        contained
        start={start}
        leave={leave}
        hold={hold}
        onDiscard={onDiscard}
        {...shared(projectId, setProjectId, onCommitPick)}
      />
    </>
  );
}

const routers: { dispose: () => void }[] = [];

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

async function back() {
  window.history.back();
  await settle();
}

async function heading(name: string) {
  return screen.findByRole("heading", { name });
}

/** Summary → the project picker → פרויקט חדש. */
async function toNew(fromSummary: boolean) {
  if (fromSummary) fireEvent.click(await screen.findByRole("button", { name: /^פרויקט:/ }));
  fireEvent.click(await screen.findByRole("button", { name: "פרויקט חדש" }));
  await heading("פרויקט חדש");
  await settle();
}

async function createNew() {
  fireEvent.change(screen.getByRole("textbox", { name: "שם" }), { target: { value: "גג חדש" } });
  fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
  await settle();
}

async function renderRoute(onCommitPick = vi.fn(() => Promise.resolve(undefined))) {
  window.history.replaceState(null, "", "/review");
  const router = createBrowserRouter([
    { path: "/review", element: <h1>לאישור</h1> },
    { path: "/review/change", element: <RouteChange onCommitPick={onCommitPick} /> },
  ]);
  routers.push(router);
  render(<RouterProvider router={router} />);
  await act(async () => { await router.navigate("/review/change?item=r1"); });
  await heading("שינוי שיוך");
  expect(historyIndex()).toBe(1);
  return { router, onCommitPick };
}

async function renderContained(props: Omit<Parameters<typeof ContainedChange>[0], "onCommitPick"> & { onCommitPick?: (kind: "project" | "category", id: string) => Promise<undefined> }) {
  window.history.replaceState(null, "", "/");
  const onCommitPick = props.onCommitPick ?? vi.fn(() => Promise.resolve(undefined));
  const router = createBrowserRouter([
    { path: "/", element: <h1>בית</h1> },
    { path: "/t", element: <ContainedChange {...props} onCommitPick={onCommitPick} /> },
  ]);
  routers.push(router);
  render(<RouterProvider router={router} />);
  await act(async () => { await router.navigate("/t"); });
  fireEvent.click(await screen.findByRole("button", { name: "שינוי" }));
  await screen.findByRole("dialog");
  await settle();
  expect(historyIndex()).toBe(2);
  return { router, onCommitPick };
}

afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
  resetSheetHistoryLock();
  window.history.replaceState(null, "", "/");
});

describe("the change sheet's new view on the page URL (?pick=)", () => {
  it("Back lands on the picker, and Back again on the summary", async () => {
    const { router } = await renderRoute();
    await toNew(true);
    expect(historyIndex()).toBe(3);
    await back();
    expect(await heading("בחירת פרויקט")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?item=r1&pick=project");
    expect(historyIndex()).toBe(2);
    await back();
    expect(await heading("שינוי שיוך")).toBeInTheDocument();
    expect(historyIndex()).toBe(1);
    await back();
    expect(router.state.location.pathname).toBe("/review");
  });

  it("חזרה lands on the picker, and Back from there on the summary", async () => {
    await renderRoute();
    await toNew(true);
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await settle();
    expect(await heading("בחירת פרויקט")).toBeInTheDocument();
    expect(historyIndex()).toBe(2);
    await back();
    expect(await heading("שינוי שיוך")).toBeInTheDocument();
    expect(historyIndex()).toBe(1);
  });

  it("a created project is picked and the sheet ends on the summary, one Back from the screen below", async () => {
    const { router, onCommitPick } = await renderRoute();
    await toNew(true);
    await createNew();
    expect(await heading("שינוי שיוך")).toBeInTheDocument();
    expect(onCommitPick).toHaveBeenCalledWith("project", "p9");
    expect(historyIndex()).toBe(1);
    await back();
    expect(router.state.location.pathname).toBe("/review");
  });
});

describe("the change sheet's new view in a contained overlay", () => {
  it("Back lands on the picker, and Back again does what Back on the picker does: closes the sheet", async () => {
    await renderContained({ start: "summary" });
    await toNew(true);
    expect(historyIndex()).toBe(3);
    await back();
    expect(await heading("בחירת פרויקט")).toBeInTheDocument();
    expect(historyIndex()).toBe(2);
    await back();
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(historyIndex()).toBe(1);
  });

  it("חזרה lands on the picker, and Back from there closes the sheet", async () => {
    await renderContained({ start: "summary" });
    await toNew(true);
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await settle();
    expect(await heading("בחירת פרויקט")).toBeInTheDocument();
    expect(historyIndex()).toBe(2);
    await back();
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(historyIndex()).toBe(1);
  });

  it("a created project lands on the summary, and one Back closes the sheet", async () => {
    const { onCommitPick } = await renderContained({ start: "summary" });
    await toNew(true);
    await createNew();
    expect(await heading("שינוי שיוך")).toBeInTheDocument();
    expect(onCommitPick).toHaveBeenCalledWith("project", "p9");
    expect(historyIndex()).toBe(2);
    await back();
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(historyIndex()).toBe(1);
  });

  it("opened on the picker, a created project closes the sheet with no entry left", async () => {
    const { onCommitPick } = await renderContained({ start: "project" });
    await toNew(false);
    await createNew();
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(onCommitPick).toHaveBeenCalledWith("project", "p9");
    expect(historyIndex()).toBe(1);
  });

  it("✕ on a hold warns first, and the second ✕ discards and closes with no entry left", async () => {
    const onDiscard = vi.fn();
    await renderContained({ start: "summary", hold: "בחרו פרויקט.", onDiscard });
    await toNew(true);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "סגירה" }));
    await settle();
    expect(screen.getByRole("heading", { name: "פרויקט חדש" })).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(historyIndex()).toBe(3);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(historyIndex()).toBe(1);
  });
});

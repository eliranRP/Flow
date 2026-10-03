import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import {
  JEV_DEFAULT,
  JevSettings,
  parseJevThreshold,
  readJevIntegration,
  type JevCardState,
} from "./jev-settings";

const db = vi.hoisted(() => {
  const state: {
    row: { enabled: boolean; mode: string; threshold: number } | null;
    readError: { message: string } | null;
    writeError: { message: string } | null;
    hold: Promise<void> | null;
    failRefresh: boolean;
    writes: Array<Record<string, unknown>>;
  } = {
    row: null,
    readError: null,
    writeError: null,
    hold: null,
    failRefresh: false,
    writes: [],
  };
  return state;
});

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: db.row, error: db.readError }),
        }),
      }),
    }),
    rpc: (_name: string, args: Record<string, unknown>) => {
      db.writes.push(args);
      const finish = () => {
        if (!db.writeError) {
          db.row = {
            enabled: Boolean(args.p_enabled),
            mode: String(args.p_mode),
            threshold: Number(args.p_threshold),
          };
          if (db.failRefresh) db.readError = { message: "down" };
        }
        return { data: {}, error: db.writeError };
      };
      if (db.hold) return db.hold.then(finish);
      return Promise.resolve(finish());
    },
  }),
}));

function renderLive(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const off: JevCardState = { ...JEV_DEFAULT, enabled: false, status: "ready" };

async function readySwitch() {
  await waitFor(() => expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toBeEnabled());
  return screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
}

describe("Jev settings card", () => {
  beforeEach(() => {
    db.row = null;
    db.readError = null;
    db.writeError = null;
    db.hold = null;
    db.failRefresh = false;
    db.writes = [];
  });

  it("rounds a threshold to two decimals and accepts a comma", () => {
    expect(parseJevThreshold("0.49")).toBeNull();
    expect(parseJevThreshold("0.50")).toBe(0.5);
    expect(parseJevThreshold("0,95")).toBe(0.95);
    expect(parseJevThreshold("0.955")).toBe(0.96);
    expect(parseJevThreshold("1")).toBe(1);
    expect(parseJevThreshold("1.01")).toBeNull();
  });

  it("says כבוי when off and פעיל · מצב צל when on", () => {
    const { unmount } = render(<JevSettings sample={off} />);
    const toggle = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("כבוי")).toBeInTheDocument();
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(screen.queryByText("אין מפתח")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByText("פעיל · מצב צל")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    expect(screen.getByRole("button", { name: "אפשרויות" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("ההצעות נשמרות לבדיקה ולא ממולאות אוטומטית.")).toBeInTheDocument();
    expect(screen.queryByText("צל")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("סף")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    const described = document.getElementById(toggle.getAttribute("aria-describedby") ?? "");
    expect(described).toHaveTextContent("פעיל · מצב צל");
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("כבוי")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
    unmount();

    render(<JevSettings sample={{ ...off, enabled: true, mode: "off" }} />);
    expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeChecked();
    expect(screen.getByText("כבוי")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
  });

  it("shows שגיאה with a retry and does not dim a switch", () => {
    render(<JevSettings sample={{ ...off, enabled: true, status: "error" }} />);
    const row = screen.getByRole("group", { name: "תיוג חכם (Jev)" });
    expect(row).toHaveClass("ui-row-tone-muted");
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
    expect(screen.getByText("שגיאה")).toBeInTheDocument();
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(screen.queryByText("פעיל · מצב צל")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
  });

  it("keeps a threshold outside 0.50 to 1.00 off the stored value", () => {
    render(<JevSettings sample={{ ...JEV_DEFAULT, enabled: true }} showThreshold />);
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    const field = screen.getByLabelText("סף");
    fireEvent.change(field, { target: { value: "0.20" } });
    fireEvent.blur(field);
    expect(screen.getByText("בין 0.50 ל-1.00")).toBeInTheDocument();
    expect(field).toHaveValue("0.20");
  });

  it("gives the loading row the hint height and marks it busy", () => {
    const { container } = render(<JevSettings sample={{ ...JEV_DEFAULT, status: "loading" }} />);
    const row = container.querySelector(".ui-row");
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(row?.querySelector(".ui-row-hint-skel")).not.toBeNull();
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
  });

  it("is absent when there is no company", () => {
    render(<JevSettings sample={off} noCompany />);
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
  });

  it("stores the switch through set_company_integration and sends shadow when turning on", async () => {
    db.row = { enabled: false, mode: "off", threshold: 0.9 };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("כבוי")).toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(db.writes).toEqual([
        { p_enabled: true, p_mode: "shadow", p_threshold: 0.9, p_provider: "jev" },
      ]);
    });
    expect(toggle).toBeChecked();
    expect(screen.getByText("פעיל · מצב צל")).toBeInTheDocument();
  });

  it("keeps the stored mode when turning off", async () => {
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(db.writes).toEqual([
        { p_enabled: false, p_mode: "shadow", p_threshold: 0.9, p_provider: "jev" },
      ]);
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("כבוי")).toBeInTheDocument();
  });

  it("saves a comma threshold at two decimals and keeps אפשרויות open while busy", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    renderLive(<JevSettings showThreshold />);
    const toggle = await readySwitch();
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    const field = screen.getByLabelText("סף");
    fireEvent.change(field, { target: { value: "0,95" } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.getByLabelText("סף")).toBeDisabled());
    expect(db.writes).toEqual([
      { p_enabled: true, p_mode: "shadow", p_threshold: 0.95, p_provider: "jev" },
    ]);
    expect(screen.getByRole("button", { name: "אפשרויות" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("צל")).not.toBeInTheDocument();
    release();
    await waitFor(() => {
      expect(db.writes).toEqual([
        { p_enabled: true, p_mode: "shadow", p_threshold: 0.95, p_provider: "jev" },
      ]);
    });
    expect(screen.getByLabelText("סף")).toHaveValue("0.95");
    expect(screen.getByLabelText("סף")).toBeEnabled();
    expect(screen.getByRole("button", { name: "אפשרויות" })).toHaveAttribute("aria-expanded", "true");
  });

  it("ignores a second toggle while the write is in flight", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    db.row = { enabled: false, mode: "shadow", threshold: 0.9 };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    toggle.focus();
    fireEvent.keyDown(toggle, { key: " ", code: "Space" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "true"));
    expect(toggle).toHaveFocus();
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(db.writes).toHaveLength(1);
    release();
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(db.writes).toEqual([
      { p_enabled: true, p_mode: "shadow", p_threshold: 0.9, p_provider: "jev" },
    ]);
  });

  it("returns the switch and toasts when the save fails", async () => {
    db.row = { enabled: false, mode: "shadow", threshold: 0.9 };
    db.writeError = { message: "validation" };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    fireEvent.click(toggle);
    expect(await screen.findByText("לא הצלחנו לשמור.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("offers ניסיון חוזר when the save fails on the network", async () => {
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    db.writeError = { message: "Failed to fetch" };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    fireEvent.click(toggle);
    expect(await screen.findByText("לא הצלחנו לשמור.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("shows שגיאה when the row fails to load, not an on state", async () => {
    db.readError = { message: "down" };
    renderLive(<JevSettings />);
    expect(await screen.findByText("שגיאה")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(screen.queryByText("פעיל · מצב צל")).not.toBeInTheDocument();
    expect(screen.queryByText("כבוי")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).toBeInTheDocument();
  });

  it("keeps focus on the switch after a keyboard toggle", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    db.row = { enabled: false, mode: "shadow", threshold: 0.9 };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    toggle.focus();
    fireEvent.keyDown(toggle, { key: " ", code: "Space" });
    fireEvent.click(toggle);
    fireEvent.keyUp(toggle, { key: " ", code: "Space" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "true"));
    expect(toggle).toHaveFocus();
    expect(toggle).toBeEnabled();
    release();
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-busy"));
    expect(toggle).toHaveFocus();
    expect(toggle).toBeChecked();
  });

  it("retries the failed turn-off, not a later threshold save", async () => {
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    db.writeError = { message: "Failed to fetch" };
    renderLive(<JevSettings showThreshold />);
    const toggle = await readySwitch();
    fireEvent.click(toggle);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    db.writeError = null;
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    const field = screen.getByLabelText("סף");
    fireEvent.change(field, { target: { value: "0.95" } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(db.writes.at(-1)).toEqual({
        p_enabled: true,
        p_mode: "shadow",
        p_threshold: 0.95,
        p_provider: "jev",
      });
    });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(db.writes.at(-1)).toEqual({
        p_enabled: false,
        p_mode: "shadow",
        p_threshold: 0.9,
        p_provider: "jev",
      });
    });
  });

  it("keeps the saved switch when a later refresh fails", async () => {
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    db.failRefresh = true;
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(screen.getByText("כבוי")).toBeInTheDocument();
    expect(screen.queryByText("שגיאה")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).not.toBeInTheDocument();
  });

  it("reads a missing company row as off", async () => {
    const stored = await readJevIntegration();
    expect(stored).toEqual({ enabled: false, mode: "shadow", threshold: 0.9 });
  });
});

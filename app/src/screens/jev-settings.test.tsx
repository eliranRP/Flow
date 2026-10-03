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
    writes: Array<Record<string, unknown>>;
  } = {
    row: null,
    readError: null,
    writeError: null,
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
      return Promise.resolve({ data: {}, error: db.writeError });
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

const off: JevCardState = { ...JEV_DEFAULT, enabled: false, status: "connected" };

describe("Jev settings card", () => {
  beforeEach(() => {
    db.row = null;
    db.readError = null;
    db.writeError = null;
    db.writes = [];
  });

  it("accepts a threshold from 0.50 to 1.00", () => {
    expect(parseJevThreshold("0.49")).toBeNull();
    expect(parseJevThreshold("0.50")).toBe(0.5);
    expect(parseJevThreshold("1")).toBe(1);
    expect(parseJevThreshold("1.01")).toBeNull();
  });

  it("hides the options while the switch is off, and shows them when it is on", () => {
    render(<JevSettings sample={off} />);
    const toggle = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    expect(screen.getByRole("radio", { name: "צל" })).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
  });

  it("shows אין מפתח and does not offer the switch or the options", () => {
    render(<JevSettings sample={{ ...off, enabled: true, status: "missing-key" }} />);
    expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toBeDisabled();
    expect(screen.getByText("אין מפתח")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
  });

  it("shows שגיאה with a retry and does not offer a working switch", () => {
    render(<JevSettings sample={{ ...off, status: "error" }} />);
    expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toBeDisabled();
    expect(screen.getByText("שגיאה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
  });

  it("keeps a threshold outside 0.50 to 1.00 off the stored value", () => {
    render(<JevSettings sample={{ ...JEV_DEFAULT, enabled: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    const field = screen.getByLabelText("סף");
    fireEvent.change(field, { target: { value: "0.20" } });
    fireEvent.blur(field);
    expect(screen.getByText("בין 0.50 ל-1.00")).toBeInTheDocument();
    expect(field).toHaveValue("0.20");
  });

  it("is absent when there is no company", () => {
    render(<JevSettings sample={off} noCompany />);
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
  });

  it("stores the switch through set_company_integration and sends shadow when turning on", async () => {
    db.row = { enabled: false, mode: "off", threshold: 0.9 };
    renderLive(<JevSettings />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toBeEnabled());
    const toggle = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(db.writes).toEqual([
        { p_enabled: true, p_mode: "shadow", p_threshold: 0.9, p_provider: "jev" },
      ]);
    });
    expect(toggle).toBeChecked();
  });

  it("returns the switch and toasts when the save fails", async () => {
    db.row = { enabled: false, mode: "shadow", threshold: 0.9 };
    db.writeError = { message: "validation" };
    renderLive(<JevSettings />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toBeEnabled());
    const toggle = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
    fireEvent.click(toggle);
    expect(await screen.findByText("לא הצלחנו לשמור.")).toBeInTheDocument();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("reads a missing company row as off", async () => {
    const stored = await readJevIntegration();
    expect(stored).toEqual({ enabled: false, mode: "shadow", threshold: 0.9 });
  });
});

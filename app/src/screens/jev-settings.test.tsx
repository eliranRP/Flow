import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { bindJevConnectorScope, jevConnectorQueryKey, jevConnectorStorageKey, type JevConnectorScope } from "./jev-review";

const scope: JevConnectorScope = { userId: "user-1", companyId: "company-1" };
import {
  JEV_DEFAULT,
  AUTO_HINT,
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
    readHold: Promise<void> | null;
    failRefresh: boolean;
    writes: Array<Record<string, unknown>>;
  } = {
    row: null,
    readError: null,
    writeError: null,
    hold: null,
    readHold: null,
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
          maybeSingle: () => {
            const finish = () => ({ data: db.row, error: db.readError });
            if (db.readHold) return db.readHold.then(finish);
            return Promise.resolve(finish());
          },
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

function renderLive(ui: ReactNode, prepare?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepare?.(client);
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return Object.assign(view, { client });
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
    db.readHold = null;
    db.failRefresh = false;
    db.writes = [];
    bindJevConnectorScope(scope);
    localStorage.removeItem("flow.jev-connector");
    localStorage.removeItem(jevConnectorStorageKey(scope));
  });

  it("rounds a threshold to two decimals and accepts a comma", () => {
    expect(parseJevThreshold("0.49")).toBeNull();
    expect(parseJevThreshold("0.50")).toBe(0.5);
    expect(parseJevThreshold("0,95")).toBe(0.95);
    expect(parseJevThreshold("0.955")).toBe(0.96);
    expect(parseJevThreshold("1")).toBe(1);
    expect(parseJevThreshold("1.01")).toBeNull();
  });

  it("says כבוי when off and פעיל · הצעות בלבד when on", () => {
    const { unmount } = render(<JevSettings sample={off} />);
    const toggle = screen.getByRole("switch", { name: "תיוג חכם (Jev)" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("כבוי")).toBeInTheDocument();
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(screen.queryByText("אין מפתח")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByText("פעיל · הצעות בלבד")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    expect(screen.getByRole("button", { name: "אפשרויות" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("ההצעות נשמרות לבדיקה ולא ממולאות אוטומטית.")).toBeInTheDocument();
    expect(screen.queryByText("צל")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "הצעות בלבד" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radiogroup", { name: "סף ביטחון" })).not.toBeInTheDocument();
    const described = document.getElementById(toggle.getAttribute("aria-describedby") ?? "");
    expect(described).toHaveTextContent("פעיל · הצעות בלבד");
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
    expect(screen.queryByText("פעיל · הצעות בלבד")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
  });

  it("offers the threshold only in auto mode, 90% by default (FLOW-702)", () => {
    render(<JevSettings sample={{ ...JEV_DEFAULT, enabled: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    expect(screen.getByRole("radio", { name: "הצעות בלבד" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radiogroup", { name: "סף ביטחון" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "מילוי אוטומטי" }));
    expect(screen.getByText("פעיל · מילוי אוטומטי")).toBeInTheDocument();
    expect(screen.getByText(AUTO_HINT)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "90%" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "95%" }));
    expect(screen.getByRole("radio", { name: "95%" })).toHaveAttribute("aria-checked", "true");
  });

  it("names a stored threshold that is not one of the choices", () => {
    render(<JevSettings sample={{ ...JEV_DEFAULT, enabled: true, mode: "auto", threshold: 0.92 }} optionsOpen />);
    const hint = screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "הסף כרגע 92%");
    expect(hint.querySelector("bdi")).toHaveTextContent("92%");
    for (const label of ["80%", "85%", "90%", "95%"]) {
      expect(screen.getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "false");
    }
  });

  it("shows a viewer the mode without letting it change", () => {
    render(<JevSettings sample={{ ...JEV_DEFAULT, enabled: true, mode: "auto" }} optionsOpen readOnly />);
    expect(screen.getByRole("radio", { name: "מילוי אוטומטי" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "90%" })).toBeDisabled();
  });

  it("gives the loading row the hint height and marks it busy", () => {
    const { container } = render(<JevSettings sample={{ ...JEV_DEFAULT, enabled: true, status: "loading" }} />);
    const row = container.querySelector(".ui-row");
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(row?.querySelector(".ui-row-hint-skel")).not.toBeNull();
    expect(container.querySelector(".ui-jev-options-reserve")).not.toBeNull();
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
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
    expect(screen.getByText("פעיל · הצעות בלבד")).toBeInTheDocument();
  });

  it("replaces a cached Jev off flag when the connector is turned on", async () => {
    db.row = { enabled: false, mode: "off", threshold: 0.9 };
    const { client } = renderLive(<JevSettings />, (query) => {
      query.setQueryData(jevConnectorQueryKey(), false);
    });
    expect(client.getQueryData(jevConnectorQueryKey())).toBe(false);
    fireEvent.click(await readySwitch());
    await waitFor(() => {
      expect(client.getQueryData(jevConnectorQueryKey())).toBe(true);
    });
    expect(client.getQueryData(jevConnectorQueryKey({ userId: "user-2", companyId: scope.companyId }))).toBeUndefined();
    expect(localStorage.getItem(jevConnectorStorageKey(scope))).toBe("1");
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

  it("stores auto mode and a threshold through set_company_integration and keeps אפשרויות open while busy", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise((resolve) => { release = resolve; });
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    expect(toggle).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    const autoRadio = screen.getByRole("radio", { name: "מילוי אוטומטי" });
    autoRadio.focus();
    fireEvent.click(autoRadio);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "true"));
    // FLOW-331 r1: both segmented controls say busy, and the percents draw in an LTR bdi.
    expect(screen.getByRole("radiogroup", { name: "מצב" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("radiogroup", { name: "סף ביטחון" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("radio", { name: "95%" }).querySelector("bdi[dir='ltr']")?.textContent).toBe("95%");
    expect(screen.getByRole("radio", { name: "מילוי אוטומטי" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "מילוי אוטומטי" })).toHaveFocus();
    fireEvent.click(screen.getByRole("radio", { name: "95%" }));
    expect(db.writes).toEqual([
      { p_enabled: true, p_mode: "auto", p_threshold: 0.9, p_provider: "jev" },
    ]);
    expect(screen.getByRole("button", { name: "אפשרויות" })).toHaveAttribute("aria-expanded", "true");
    release();
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-busy"));
    db.hold = null;
    fireEvent.click(screen.getByRole("radio", { name: "95%" }));
    await waitFor(() => {
      expect(db.writes).toEqual([
        { p_enabled: true, p_mode: "auto", p_threshold: 0.9, p_provider: "jev" },
        { p_enabled: true, p_mode: "auto", p_threshold: 0.95, p_provider: "jev" },
      ]);
    });
    expect(await screen.findByText("פעיל · מילוי אוטומטי")).toBeInTheDocument();
  });

  it("reads a stored auto row back as on, in auto, with its threshold (#231 r1)", async () => {
    db.row = { enabled: true, mode: "auto", threshold: 0.85 };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    expect(toggle).toBeChecked();
    expect(screen.getByText("פעיל · מילוי אוטומטי")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אפשרויות" }));
    expect(screen.getByRole("radio", { name: "מילוי אוטומטי" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "85%" })).toHaveAttribute("aria-checked", "true");
    expect(db.writes).toEqual([]);
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

  it("keeps the error row while a retry runs, then focuses the switch", async () => {
    let release: () => void = () => undefined;
    db.readError = { message: "down" };
    renderLive(<JevSettings />);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: תיוג חכם" });
    retry.focus();
    db.readHold = new Promise((resolve) => { release = resolve; });
    db.readError = null;
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByText("שגיאה")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
    expect(document.querySelector(".ui-row-hint-skel")).toBeNull();
    expect(retry).toHaveFocus();
    release();
    await waitFor(() => expect(screen.getByRole("switch", { name: "תיוג חכם (Jev)" })).toHaveFocus());
    expect(screen.getByText("פעיל · הצעות בלבד")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).not.toBeInTheDocument();
  });

  it("leaves focus on the retry when the load fails again", async () => {
    let release: () => void = () => undefined;
    db.readError = { message: "down" };
    renderLive(<JevSettings />);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: תיוג חכם" });
    retry.focus();
    db.readHold = new Promise((resolve) => { release = resolve; });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByText("שגיאה")).toBeInTheDocument();
    expect(retry).toHaveFocus();
    release();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "ניסיון חוזר: תיוג חכם" })).not.toHaveAttribute("aria-busy");
    });
    expect(screen.getByText("שגיאה")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
  });

  it("reserves אפשרויות while a slow load resolves to on", async () => {
    let release: () => void = () => undefined;
    db.readHold = new Promise((resolve) => { release = resolve; });
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    const { container } = renderLive(<JevSettings />);
    await waitFor(() => {
      expect(container.querySelector(".ui-jev-options-reserve")).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "אפשרויות" })).not.toBeInTheDocument();
    release();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "אפשרויות" })).toBeInTheDocument();
    });
    expect(container.querySelector(".ui-jev-options-reserve")).toBeNull();
    expect(screen.getByText("פעיל · הצעות בלבד")).toBeInTheDocument();
  });

  it("shows שגיאה when the row fails to load, not an on state", async () => {
    db.readError = { message: "down" };
    renderLive(<JevSettings />);
    expect(await screen.findByText("שגיאה")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "תיוג חכם (Jev)" })).not.toBeInTheDocument();
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
    expect(screen.queryByText("פעיל · הצעות בלבד")).not.toBeInTheDocument();
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

  it("retries the failed turn-off", async () => {
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    db.writeError = { message: "Failed to fetch" };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    fireEvent.click(toggle);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    db.writeError = null;
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

  it("stays writable when retry is tapped during a newer save", async () => {
    let release: () => void = () => undefined;
    db.row = { enabled: true, mode: "shadow", threshold: 0.9 };
    db.writeError = { message: "Failed to fetch" };
    renderLive(<JevSettings />);
    const toggle = await readySwitch();
    fireEvent.click(toggle);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    await waitFor(() => expect(toggle).toBeChecked());
    db.writeError = null;
    db.hold = new Promise((resolve) => { release = resolve; });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "true"));
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(db.writes).toHaveLength(2);
    release();
    await waitFor(() => expect(toggle).not.toHaveAttribute("aria-busy"));
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(db.writes.at(-1)).toEqual({
        p_enabled: true,
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

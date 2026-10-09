import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../ui/toast";
import { israelUsePhrase } from "../sumit-copy";
import { SAMPLE_ASSISTANT_SECRET } from "../assistant-sample";
import { claudeCodeCommand } from "../mcp-address";
import { AssistantSettings } from "./assistant-settings";

const edge = vi.hoisted(() => ({
  invoke: (_name: string, _body?: unknown): Promise<{ data: unknown; error: unknown }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    functions: {
      invoke: (name: string, body?: unknown) => edge.invoke(name, body),
    },
  }),
}));

function sheetLayer(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("flowLayer" in state)) return null;
  const layer = state.flowLayer;
  return typeof layer === "string" ? layer : null;
}

function renderAssistant(ui: ReactNode, onLayer?: (layer: string | null) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Layer() {
    const location = useLocation();
    onLayer?.(sheetLayer(location.state));
    return null;
  }
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <Layer />
          {ui}
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("assistant settings", () => {
  function resetEdge() {
    edge.invoke = () => Promise.resolve({ data: null, error: null });
  }
  beforeEach(resetEdge);
  afterEach(() => {
    resetEdge();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("ties the row hint to the control", () => {
    renderAssistant(<AssistantSettings sample={{ state: "empty" }} />);
    const row = screen.getByRole("button", { name: "עוזר AI" });
    const hintId = row.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId ?? "");
    expect(hint).toHaveClass("t-hint");
    expect(hint).toHaveTextContent("לא מחובר");
  });

  it("shows an empty row, and a connected row keeps last use in the sheet", () => {
    const iso = "2026-09-30T11:05:00.000Z";
    // The query matches the DOM's text with its whitespace folded, so the no-break space is folded here too.
    const phrase = (israelUsePhrase(iso) ?? "").replace(/\s+/g, " ");
    const { rerender } = renderAssistant(<AssistantSettings sample={{ state: "empty" }} />);
    expect(screen.getByRole("button", { name: "עוזר AI" })).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <AssistantSettings sample={{ state: "connected", scope: "read", lastUsedAt: iso, id: "mcp-1" }} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const row = screen.getByRole("button", { name: "עוזר AI" });
    expect(document.getElementById(row.getAttribute("aria-describedby") ?? "")).toHaveTextContent("מחובר · קריאה בלבד");
    expect(screen.queryByText(phrase)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
    fireEvent.click(row);
    const sheet = screen.getByRole("dialog", { name: "עוזר AI" });
    const stamp = within(sheet).getByText(phrase);
    expect(stamp).toHaveClass("ui-nowrap");
    expect(getComputedStyle(stamp).whiteSpace).toBe("nowrap");
    expect(phrase.startsWith("שימוש אחרון")).toBe(true);
    expect(within(sheet).getByRole("button", { name: "ניתוק" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("מחובר · קריאה בלבד");
    const note = within(sheet).getByText("כדי לשנות את הגישה מנתקים ומחברים שוב.");
    expect(note).toHaveClass("t-hint");
    expect(stamp.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stamp.parentElement?.parentElement).toBe(note.parentElement);
  });

  it("disables the scope rows while minting, and a failure says to try again", async () => {
    let fail = false;
    edge.invoke = (name) => {
      if (name.includes("mint")) {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(fail
              ? { data: null, error: { message: "mint" } }
              : { data: null, error: null });
          }, 20);
        });
      }
      return Promise.resolve({ data: { state: "empty" }, error: null });
    };
    renderAssistant(<AssistantSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: "עוזר AI" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    fireEvent.click(screen.getByRole("radio", { name: "קריאה בלבד" }));
    expect(screen.getByRole("radio", { name: "קריאה בלבד" })).toBeChecked();
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    expect(screen.getByRole("radio", { name: "קריאה וכתיבה" })).toBeDisabled();
    expect(screen.getAllByText("יוצרים קוד. אי אפשר לשנות עכשיו.")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "יצירת קוד" })).toHaveAttribute("aria-describedby", "assistant-mint-reason");
    expect(document.getElementById("assistant-mint-reason")).toHaveClass("t-hint");
    expect(await screen.findByText("לא הצלחנו להתחבר. נסו שוב.")).toBeInTheDocument();
  });

  it("revokes a code that lands after the sheet has closed", async () => {
    const calls: string[] = [];
    let finish: (value: { data: unknown; error: unknown }) => void = () => undefined;
    edge.invoke = (name) => {
      calls.push(name);
      if (name.includes("mint")) {
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    };
    renderAssistant(<AssistantSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: "עוזר AI" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    finish({
      data: { id: "11111111-1111-4000-8000-000000000001", secret: "flow_mcp_test", scope: ["read", "write"] },
      error: null,
    });
    await waitFor(() => {
      expect(calls.some((name) => name.includes("revoke"))).toBe(true);
    });
  });

  it("copies the code once, and a refused clipboard asks for a manual copy", async () => {
    edge.invoke = (name) => {
      if (name.includes("mint")) {
        return Promise.resolve({
          data: { id: "11111111-1111-4000-8000-000000000001", secret: "flow_mcp_once", scope: ["read"] },
          error: null,
        });
      }
      return Promise.resolve({ data: { state: "empty" }, error: null });
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderAssistant(<AssistantSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: "עוזר AI" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    const code = await screen.findByRole("group", { name: "קוד" });
    expect(within(code).getByRole("textbox", { name: "קוד" })).toHaveValue("flow_mcp_once");
    fireEvent.click(within(code).getByRole("button", { name: "העתקה: קוד" }));
    await waitFor(() => expect(screen.getByText("הועתק")).toBeInTheDocument());
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(within(code).getByRole("button", { name: "העתקה: קוד" }));
    const manual = await within(code).findByRole("status");
    expect(manual).toHaveTextContent("העתיקו ידנית");
    expect(manual.closest("[role=\"dialog\"]")).toBe(screen.getByRole("dialog", { name: "הקוד מוכן" }));
  });

  it("confirms disconnect, and an expired row opens the connect sheet", async () => {
    const calls: string[] = [];
    edge.invoke = (name) => {
      calls.push(name);
      return Promise.resolve({ data: { ok: true }, error: null });
    };
    const connected = renderAssistant(
      <AssistantSettings sample={{ state: "connected", scope: "read_write", id: "mcp-1" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "עוזר AI" })).getByRole("button", { name: "ניתוק" }));
    const confirm = screen.getByRole("dialog", { name: "לנתק את העוזר?" });
    expect(confirm).toHaveTextContent("הקוד יפסיק לעבוד. הספרים נשארים.");
    fireEvent.click(within(confirm).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => expect(screen.getByText("העוזר נותק.")).toBeInTheDocument());
    expect(calls.some((name) => name.includes("revoke"))).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "עוזר AI" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
    connected.unmount();

    renderAssistant(<AssistantSettings sample={{ state: "expired", scope: "read", id: "mcp-1" }} />);
    const expiredRow = screen.getByRole("button", { name: "עוזר AI" });
    expect(expiredRow).toHaveClass("ui-row-tone-warning");
    expect(document.getElementById(expiredRow.getAttribute("aria-describedby") ?? "")).toHaveTextContent("צריך לחבר מחדש");
    expect(screen.queryByText("פג תוקף")).not.toBeInTheDocument();
    fireEvent.click(expiredRow);
    const reconnect = screen.getByRole("dialog", { name: "עוזר AI" });
    const expiredHeading = within(reconnect).getByRole("heading", { name: "פג תוקף" });
    expect(expiredHeading.tagName).toBe("H3");
    expect(expiredHeading.closest("span")).toBeNull();
    expect(reconnect).toHaveTextContent("הקוד הפסיק לעבוד אחרי 90 יום.");
    expect(within(reconnect).getByRole("button", { name: "חיבור מחדש" })).toBeInTheDocument();
    expect(within(reconnect).getByRole("button", { name: "ניתוק" })).toBeInTheDocument();
    fireEvent.click(within(reconnect).getByRole("button", { name: "חיבור מחדש" }));
    const step = screen.getByRole("dialog", { name: "חיבור עוזר AI" });
    expect(step).toBeInTheDocument();
    expect(within(step).getByRole("heading", { name: "חיבור עוזר AI" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "קריאה וכתיבה" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "חיבור עוזר AI" })).getByRole("button", { name: "ניתוק" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "לנתק את העוזר?" })).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "ניתוק" })).not.toBeInTheDocument();
  });

  it("drops both assistant history entries when ניתוק succeeds", async () => {
    let layer: string | null = "unset";
    edge.invoke = () => Promise.resolve({ data: { ok: true }, error: null });
    renderAssistant(
      <AssistantSettings sample={{ state: "connected", scope: "read_write", id: "mcp-1" }} />,
      (next) => { layer = next; },
    );
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    await waitFor(() => { expect(layer).toBe("assistant-details"); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "עוזר AI" })).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => { expect(layer).toBe("assistant-disconnect"); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "לנתק את העוזר?" })).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => { expect(layer).toBeNull(); });
  });

  it("mints the scope that was selected", async () => {
    const bodies: unknown[] = [];
    edge.invoke = (name, options) => {
      bodies.push(options);
      if (name.includes("mint")) {
        return Promise.resolve({
          data: { id: "11111111-1111-4000-8000-000000000001", secret: "flow_mcp_once", scope: ["read"] },
          error: null,
        });
      }
      return Promise.resolve({ data: { state: "empty" }, error: null });
    };
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://example.com/functions/v1/flow-mcp");
    renderAssistant(<AssistantSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: "עוזר AI" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    fireEvent.click(screen.getByRole("radio", { name: "קריאה בלבד" }));
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    expect(await screen.findByRole("heading", { name: "הקוד מוכן" })).toBeInTheDocument();
    const shown = screen.getByText("גישה: קריאה בלבד. הקוד מוצג פעם אחת.");
    expect(shown).toHaveClass("t-hint");
    expect(screen.getByRole("button", { name: "איך מחברים ב־Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "סיום" })).toBeInTheDocument();
    expect(bodies).toContainEqual({ body: { scope: "read" } });
  });

  it("a failed first load offers a retry and does not mint", async () => {
    edge.invoke = () => Promise.resolve({ data: null, error: { message: "status" } });
    renderAssistant(<AssistantSettings />);
    const group = await screen.findByRole("group", { name: "עוזר AI" });
    expect(within(group).getByText("לא הצלחנו לטעון")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניסיון חוזר: עוזר AI" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עוזר AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "נסו שוב" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("היקף הגישה")).not.toBeInTheDocument();
  });

  it("moves focus to the row when the status recovers while ניסיון חוזר is focused", async () => {
    let fail = true;
    edge.invoke = () => fail
      ? Promise.resolve({ data: null, error: { message: "status" } })
      : Promise.resolve({ data: { state: "connected", id: "mcp-1", scope: ["read", "write"] }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <AssistantSettings />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: עוזר AI" });
    retry.focus();
    expect(retry).toHaveFocus();
    fail = false;
    await client.refetchQueries({ queryKey: ["mcp-status"] });
    await waitFor(() => { expect(screen.getByRole("button", { name: (value) => value === "עוזר AI" })).toHaveFocus(); });
  });

  it("returns focus to the assistant row when a reconnect passes through loading", async () => {
    let hang = false;
    let release: (value: { data: unknown; error: unknown }) => void = () => undefined;
    edge.invoke = () => hang
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve({ data: null, error: { message: "status" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <AssistantSettings />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: עוזר AI" });
    retry.focus();
    hang = true;
    const done = client.refetchQueries({ queryKey: ["mcp-status"] });
    await waitFor(() => {
      expect(document.querySelector(".ui-project-list .ui-row")).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: עוזר AI" })).not.toBeInTheDocument();
    release({ data: { state: "connected", id: "mcp-1", scope: ["read", "write"] }, error: null });
    await done;
    await waitFor(() => { expect(screen.getByRole("button", { name: (value) => value === "עוזר AI" })).toHaveFocus(); });
  });

  it("does not move focus when the assistant status recovers away from ניסיון חוזר", async () => {
    let hang = false;
    let release: (value: { data: unknown; error: unknown }) => void = () => undefined;
    const connected = { data: { state: "connected", id: "mcp-1", scope: ["read", "write"] }, error: null };
    edge.invoke = () => hang
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve({ data: null, error: { message: "status" } });
    function SheetSpot() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => { setOpen(true); }}>גיליון</button>
          {open ? (
            <div role="dialog" aria-label="גיליון">
              <button type="button">בגיליון</button>
            </div>
          ) : null}
        </>
      );
    }
    function mount() {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter>
              <SheetSpot />
              <button type="button">אחר</button>
              <AssistantSettings />
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>,
      );
      return { client, ...view };
    }

    const pressed = mount();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: עוזר AI" });
    retry.focus();
    hang = true;
    fireEvent.click(retry);
    await waitFor(() => {
      const link = screen.queryByRole("button", { name: "ניסיון חוזר: עוזר AI" });
      const row = document.querySelector(".ui-project-list .ui-row");
      expect(link?.getAttribute("aria-busy") === "true" || row?.getAttribute("aria-busy") === "true").toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "גיליון" }));
    const inside = screen.getByRole("button", { name: "בגיליון" });
    inside.focus();
    expect(inside).toHaveFocus();
    release(connected);
    await waitFor(() => { expect(screen.getByRole("button", { name: (value) => value === "עוזר AI" })).toBeInTheDocument(); });
    expect(inside).toHaveFocus();
    pressed.unmount();

    hang = false;
    const failed = mount();
    const failedRetry = await screen.findByRole("button", { name: "ניסיון חוזר: עוזר AI" });
    failedRetry.focus();
    hang = true;
    fireEvent.click(failedRetry);
    await waitFor(() => { expect(failedRetry).toHaveAttribute("aria-busy", "true"); });
    release({ data: null, error: { message: "status" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ניסיון חוזר: עוזר AI" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "ניסיון חוזר: עוזר AI" })).not.toHaveAttribute("aria-busy", "true");
    });
    const elsewhere = screen.getByRole("button", { name: "אחר" });
    elsewhere.focus();
    expect(elsewhere).toHaveFocus();
    hang = true;
    const again = failed.client.refetchQueries({ queryKey: ["mcp-status"] });
    await waitFor(() => {
      expect(document.querySelector(".ui-project-list .ui-row")).toHaveAttribute("aria-busy", "true");
    });
    release(connected);
    await again;
    await waitFor(() => { expect(screen.getByRole("button", { name: (value) => value === "עוזר AI" })).toBeInTheDocument(); });
    expect(elsewhere).toHaveFocus();
    failed.unmount();

    hang = false;
    const blank = mount();
    const blankRetry = await screen.findByRole("button", { name: "ניסיון חוזר: עוזר AI" });
    blankRetry.focus();
    blankRetry.blur();
    expect(document.activeElement).toBe(document.body);
    hang = true;
    const recovered = blank.client.refetchQueries({ queryKey: ["mcp-status"] });
    await waitFor(() => {
      expect(document.querySelector(".ui-project-list .ui-row")).toHaveAttribute("aria-busy", "true");
    });
    release(connected);
    await recovered;
    await waitFor(() => { expect(screen.getByRole("button", { name: (value) => value === "עוזר AI" })).toBeInTheDocument(); });
    expect(screen.getByRole("button", { name: (value) => value === "עוזר AI" })).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("preview disconnect closes the confirm", () => {
    renderAssistant(
      <AssistantSettings sample={{ state: "connected", scope: "read_write", id: "mcp-1" }} blocked={() => true} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "עוזר AI" })).getByRole("button", { name: "ניתוק" }));
    const confirm = screen.getByRole("dialog", { name: "לנתק את העוזר?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "ניתוק" }));
    expect(screen.queryByRole("dialog", { name: "לנתק את העוזר?" })).not.toBeInTheDocument();
  });

  it("shows a load error and a disabled row when there is no company", () => {
    const { rerender } = renderAssistant(<AssistantSettings sample={{ state: "error" }} />);
    expect(screen.getByRole("group", { name: "עוזר AI" })).toHaveTextContent("לא הצלחנו לטעון");
    expect(screen.getByRole("button", { name: "ניסיון חוזר: עוזר AI" })).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <AssistantSettings noCompany />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const row = screen.getByRole("button", { name: "עוזר AI" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).not.toHaveAttribute("disabled");
    row.focus();
    expect(row).toHaveFocus();
    expect(row.querySelector(".ui-row-chevron")).toBeNull();
    fireEvent.click(row);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.getElementById(row.getAttribute("aria-describedby") ?? "")).toHaveTextContent("אין עסק עדיין");
  });

  it("reads a live status, and a failed refetch keeps the last state", async () => {
    let calls = 0;
    edge.invoke = (name) => {
      if (!name.includes("status")) return Promise.resolve({ data: null, error: null });
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          data: { state: "connected", id: "mcp-1", scope: ["read", "write"], last_used_at: null },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "down" } });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <AssistantSettings />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const row = await screen.findByRole("button", { name: "עוזר AI" });
    expect(document.getElementById(row.getAttribute("aria-describedby") ?? "")).toHaveTextContent("מחובר · קריאה וכתיבה");
    await client.refetchQueries({ queryKey: ["mcp-status"] });
    await waitFor(() => { expect(calls).toBeGreaterThan(1); });
    expect(document.getElementById(screen.getByRole("button", { name: "עוזר AI" }).getAttribute("aria-describedby") ?? "")).toHaveTextContent("מחובר · קריאה וכתיבה");
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: עוזר AI" })).not.toBeInTheDocument();
  });

  it("moves focus to the row only when it is still on the retry", async () => {
    let fail = true;
    edge.invoke = () => {
      if (fail) return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: { state: "empty" }, error: null });
    };
    renderAssistant(<AssistantSettings />);
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: עוזר AI" });
    fail = false;
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => { expect(screen.getByRole("button", { name: "עוזר AI" })).toHaveFocus(); });
    expect(document.getElementById(screen.getByRole("button", { name: "עוזר AI" }).getAttribute("aria-describedby") ?? "")).toHaveTextContent("לא מחובר");
  });

  it("announces that the retry is offline and leaves the hint", async () => {
    edge.invoke = () => Promise.resolve({ data: null, error: { message: "down" } });
    onlineManager.setOnline(false);
    try {
      renderAssistant(<AssistantSettings />);
      const retry = await screen.findByRole("button", { name: "ניסיון חוזר: עוזר AI" });
      fireEvent.click(retry);
      const group = screen.getByRole("group", { name: "עוזר AI" });
      expect(within(group).getByText("לא הצלחנו לטעון")).toBeInTheDocument();
      expect(within(group).getByText("אין חיבור לאינטרנט")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "עוזר AI" })).not.toBeInTheDocument();
      act(() => { onlineManager.setOnline(true); });
      expect(within(group).queryByText("אין חיבור לאינטרנט")).not.toBeInTheDocument();
      expect(within(group).getByText("לא הצלחנו לטעון")).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("shows a skeleton while the status is loading", () => {
    renderAssistant(<AssistantSettings sample={{ state: "loading" }} showHeading={false} />);
    const title = screen.getByText("עוזר AI");
    expect(title.closest(".ui-row")).toHaveAttribute("aria-busy", "true");
    expect(title.closest("button")).toBeNull();
    expect(screen.getByText("טוען…")).toHaveAttribute("role", "status");
    expect(title.closest(".ui-row")?.querySelector(".ui-skeleton-bar")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("מחובר")).not.toBeInTheDocument();
  });

  it("shows the address, the scope, and the Claude command", async () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://example.com/functions/v1/flow-mcp");
    renderAssistant(
      <AssistantSettings
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2", scope: ["read", "write"] }}
      />,
    );
    const ready = await screen.findByRole("dialog", { name: "הקוד מוכן" });
    expect(within(ready).getByRole("textbox", { name: "כתובת" })).toHaveValue("https://example.com/functions/v1/flow-mcp");
    const shown = within(ready).getByText("גישה: קריאה וכתיבה. הקוד מוצג פעם אחת.");
    expect(shown).toHaveClass("t-hint");
    expect(within(ready).queryByRole("group", { name: "היקף הגישה" })).not.toBeInTheDocument();
    expect(within(ready).queryByText("הקוד מוצג פעם אחת. העתיקו אותו לחלון העוזר.")).not.toBeInTheDocument();
    fireEvent.click(within(ready).getByRole("button", { name: "איך מחברים ב־Claude" }));
    const help = await screen.findByRole("dialog", { name: "איך מחברים ב־Claude" });
    expect(within(help).getByText("ב־Claude Code הריצו את הפקודה.")).toBeInTheDocument();
    const command = within(help).getByRole("textbox", { name: "פקודת חיבור ל־Claude Code" });
    expect(command).toHaveValue(claudeCodeCommand("https://example.com/functions/v1/flow-mcp", "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2"));
    expect(command).toHaveAttribute("dir", "ltr");
    expect(command).toHaveAttribute("readonly");
    expect(within(help).queryByRole("group", { name: "Claude Code" })).not.toBeInTheDocument();
    expect(within(help).getByRole("button", { name: "העתקה: פקודה" })).toBeInTheDocument();
    expect(within(help).getByText("אם Claude Code לא מותקן, התקינו אותו קודם.")).toBeInTheDocument();
    expect(within(help).getByText(/ב־Claude\.ai צריך כותרת מותאמת/)).toBeInTheDocument();
    const header = within(help).getByText("Authorization: Bearer <הקוד>.");
    expect(header).toHaveClass("ui-nowrap");
    expect(getComputedStyle(header).whiteSpace).toBe("nowrap");
    expect(header).toHaveAttribute("dir", "ltr");
    expect(header.tabIndex).toBe(-1);
    expect(header.closest("a, button, input, [tabindex='0']")).toBeNull();
    expect(within(help).queryByText("ב־Claude.ai הדביקו את הכתובת ואת הקוד.")).not.toBeInTheDocument();
    expect(within(ready).queryByText(/קטגור/)).not.toBeInTheDocument();
  });

  it("names read and write on the scope step", async () => {
    renderAssistant(<AssistantSettings sample={{ state: "empty" }} initialOpen />);
    const sheet = await screen.findByRole("dialog", { name: "חיבור עוזר AI" });
    expect(within(sheet).getByText("בחרו מה העוזר יכול לעשות.")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "קריאה וכתיבה" })).toBeChecked();
    expect(within(sheet).queryByText("גם כתיבה")).not.toBeInTheDocument();
    expect(within(sheet).queryByText("בלי כתיבה")).not.toBeInTheDocument();
  });

  it("focuses the code title when the code step replaces the scope step", async () => {
    renderAssistant(<AssistantSettings sample={{ state: "empty" }} sampleSecret={SAMPLE_ASSISTANT_SECRET} />);
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    fireEvent.click(await screen.findByRole("button", { name: "יצירת קוד" }));
    expect(screen.getByRole("heading", { name: "הקוד מוכן" })).toHaveFocus();
  });

  it("returns focus to the row on close and on Escape", async () => {
    renderAssistant(<AssistantSettings sample={{ state: "empty" }} />);
    const row = screen.getByRole("button", { name: "עוזר AI" });
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "חיבור עוזר AI" });
    fireEvent.click(within(sheet).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    await waitFor(() => { expect(row).toHaveFocus(); });

    fireEvent.click(row);
    await screen.findByRole("dialog", { name: "חיבור עוזר AI" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
    await waitFor(() => { expect(row).toHaveFocus(); });
  });

  it("hides the command and the help link when no address is configured", async () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    renderAssistant(
      <AssistantSettings
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2", scope: ["read"] }}
      />,
    );
    const ready = await screen.findByRole("dialog", { name: "הקוד מוכן" });
    const address = within(ready).getByRole("group", { name: "כתובת" });
    expect(within(address).getByRole("textbox")).toHaveValue("");
    expect(within(address).queryByRole("button", { name: "העתקה: כתובת" })).not.toBeInTheDocument();
    expect(within(ready).queryByRole("button", { name: "איך מחברים ב־Claude" })).not.toBeInTheDocument();
    expect(within(ready).queryByText(/claude mcp add/)).not.toBeInTheDocument();
  });

  it("announces a failed command copy from the help sheet", async () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://example.com/functions/v1/flow-mcp");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    renderAssistant(
      <AssistantSettings
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2", scope: ["read", "write"] }}
      />,
    );
    const ready = await screen.findByRole("dialog", { name: "הקוד מוכן" });
    fireEvent.click(within(ready).getByRole("button", { name: "איך מחברים ב־Claude" }));
    const help = await screen.findByRole("dialog", { name: "איך מחברים ב־Claude" });
    fireEvent.click(within(help).getByRole("button", { name: "העתקה: פקודה" }));
    const manual = await within(help).findByRole("status");
    expect(manual).toHaveTextContent("העתיקו ידנית");
    expect(within(ready).queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes only the history layer that was popped", async () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://example.com/functions/v1/flow-mcp");
    let layer: string | null = null;
    renderAssistant(
      <AssistantSettings
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2", scope: ["read", "write"] }}
      />,
      (next) => { layer = next; },
    );
    const ready = await screen.findByRole("dialog", { name: "הקוד מוכן" });
    const link = within(ready).getByRole("button", { name: "איך מחברים ב־Claude" });
    fireEvent.click(link);
    const help = await screen.findByRole("dialog", { name: "איך מחברים ב־Claude" });
    await waitFor(() => { expect(layer).toBe("assistant-help"); });
    help.focus();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", {
        state: { usr: { flowLayer: "assistant-connect", flowLayers: ["assistant-connect"] } },
      }));
    });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "איך מחברים ב־Claude" })).not.toBeInTheDocument(); });
    expect(screen.getByRole("dialog", { name: "הקוד מוכן" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("flw_test_7f3c9a1e2b8046d5c0a91e44b7d2")).toBeInTheDocument();
    await waitFor(() => { expect(link).toHaveFocus(); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "הקוד מוכן" })).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
  });

  it("a second tap on the backdrop under the help leaves the shown-once code sheet open", async () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://example.com/functions/v1/flow-mcp");
    renderAssistant(
      <AssistantSettings
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: SAMPLE_ASSISTANT_SECRET, scope: ["read", "write"] }}
      />,
    );
    const ready = await screen.findByRole("dialog", { name: "הקוד מוכן" });
    fireEvent.click(within(ready).getByRole("button", { name: "איך מחברים ב־Claude" }));
    await screen.findByRole("dialog", { name: "איך מחברים ב־Claude" });
    const scrims = () => [...document.querySelectorAll<HTMLElement>("[data-vaul-overlay]")];
    await waitFor(() => { expect(scrims()).toHaveLength(2); });
    // FLOW-310: two taps in a row. The first closes the help; the second lands on the backdrop
    // left underneath, the code sheet's, which keeps "closeOnBackdrop" off while the code shows.
    const [codeScrim, helpScrim] = scrims();
    if (!codeScrim || !helpScrim) throw new Error("scrim missing");
    const tap = (scrim: HTMLElement, pointerId: number) => {
      fireEvent.pointerDown(scrim, { button: 0, pointerId, pointerType: "touch" });
      fireEvent.pointerUp(scrim, { button: 0, pointerId, pointerType: "touch" });
      fireEvent.click(scrim);
    };
    tap(helpScrim, 1);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "איך מחברים ב־Claude" })).not.toBeInTheDocument(); });
    tap(codeScrim, 2);
    await act(async () => {
      await new Promise((resolve) => { window.setTimeout(resolve, 400); });
    });
    expect(screen.getByRole("dialog", { name: "הקוד מוכן" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(SAMPLE_ASSISTANT_SECRET)).toBeInTheDocument();
  });

  it("keeps the code step and the expired step until the sheet has closed", async () => {
    vi.useFakeTimers();
    const code = renderAssistant(
      <AssistantSettings
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2", scope: ["read", "write"] }}
      />,
    );
    const ready = screen.getByRole("dialog", { name: "הקוד מוכן" });
    fireEvent.click(within(ready).getByRole("button", { name: "סיום" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const sliding = screen.queryByRole("dialog");
    if (sliding) {
      expect(sliding).toHaveTextContent("גישה: קריאה וכתיבה. הקוד מוצג פעם אחת.");
      expect(within(sliding).queryByRole("radio", { name: "קריאה וכתיבה" })).not.toBeInTheDocument();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const step = screen.getByRole("dialog", { name: "חיבור עוזר AI" });
    expect(within(step).getByRole("radio", { name: "קריאה וכתיבה" })).toBeChecked();
    code.unmount();

    renderAssistant(<AssistantSettings sample={{ state: "expired", scope: "read", id: "mcp-1" }} />);
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const expired = screen.getByRole("dialog", { name: "עוזר AI" });
    fireEvent.click(within(expired).getByRole("button", { name: "סגירה" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const slidingExpired = screen.queryByRole("dialog");
    if (slidingExpired) {
      expect(within(slidingExpired).getByRole("heading", { name: "פג תוקף" })).toBeInTheDocument();
      expect(within(slidingExpired).queryByRole("radio", { name: "קריאה וכתיבה" })).not.toBeInTheDocument();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const again = screen.getByRole("dialog", { name: "עוזר AI" });
    expect(within(again).getByRole("heading", { name: "פג תוקף" })).toBeInTheDocument();
    expect(within(again).queryByRole("radio", { name: "קריאה וכתיבה" })).not.toBeInTheDocument();
  });

  it("resets the code step when the sheet reopens before the close animation ends", async () => {
    vi.useFakeTimers();
    renderAssistant(
      <AssistantSettings
        sample={{ state: "empty" }}
        initialSecret={{ id: "mcp-1", secret: "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2", scope: ["read", "write"] }}
      />,
    );
    const ready = screen.getByRole("dialog", { name: "הקוד מוכן" });
    fireEvent.click(within(ready).getByRole("button", { name: "סיום" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const step = screen.getByRole("dialog", { name: "חיבור עוזר AI" });
    expect(within(step).getByRole("radio", { name: "קריאה וכתיבה" })).toBeChecked();
    expect(screen.queryByDisplayValue("flw_test_7f3c9a1e2b8046d5c0a91e44b7d2")).not.toBeInTheDocument();
  });

  it("keeps the assistant details open when the confirm layer is popped", async () => {
    renderAssistant(<AssistantSettings sample={{ state: "connected", scope: "read_write", id: "mcp-1" }} />);
    fireEvent.click(screen.getByRole("button", { name: "עוזר AI" }));
    const details = await screen.findByRole("dialog", { name: "עוזר AI" });
    fireEvent.click(within(details).getByRole("button", { name: "ניתוק" }));
    expect(await screen.findByRole("dialog", { name: "לנתק את העוזר?" })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", {
        state: { usr: { flowLayer: "assistant-details", flowLayers: ["assistant-details"] } },
      }));
    });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "לנתק את העוזר?" })).not.toBeInTheDocument(); });
    expect(screen.getByRole("dialog", { name: "עוזר AI" })).toBeInTheDocument();
  });
});

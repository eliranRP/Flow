import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { AssistantSettings, formatAssistantUse } from "./assistant-settings";

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

function renderAssistant(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

describe("assistant settings", () => {
  it("formats the last use in Asia/Jerusalem", () => {
    expect(formatAssistantUse("2026-09-30T11:05:00.000Z")).toBe("30/09/2026, 14:05");
  });

  it("shows an empty row, and a connected row names the scope and the last use", () => {
    const { rerender } = renderAssistant(<AssistantSettings sample={{ state: "empty" }} />);
    expect(screen.getByRole("button", { name: /חיבור עוזר/ })).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <AssistantSettings sample={{ state: "connected", scope: "read", lastUsedAt: "2026-09-30T11:05:00.000Z", id: "mcp-1" }} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/קריאה בלבד/)).toBeInTheDocument();
    expect(screen.getByText("30/09/2026, 14:05")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ניתוק" })).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: /חיבור עוזר/ }));
    fireEvent.click(screen.getByRole("radio", { name: "קריאה בלבד" }));
    expect(screen.getByRole("radio", { name: "קריאה בלבד" })).toBeChecked();
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    expect(screen.getByRole("radio", { name: "קריאה וכתיבה" })).toBeDisabled();
    expect(screen.getAllByText("יוצרים קוד. אי אפשר לשנות עכשיו.")).toHaveLength(2);
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
    fireEvent.click(await screen.findByRole("button", { name: /חיבור עוזר/ }));
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
    fireEvent.click(await screen.findByRole("button", { name: /חיבור עוזר/ }));
    fireEvent.click(screen.getByRole("button", { name: "יצירת קוד" }));
    expect(await screen.findByLabelText("קוד החיבור")).toHaveValue("flow_mcp_once");
    fireEvent.click(screen.getByRole("button", { name: "העתקה" }));
    await waitFor(() => expect(screen.getByText("הועתק")).toBeInTheDocument());
    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "העתקה" }));
    expect(await screen.findByText("העתיקו ידנית")).toBeInTheDocument();
  });

  it("confirms disconnect, and an expired row opens the connect sheet", async () => {
    const calls: string[] = [];
    edge.invoke = (name) => {
      calls.push(name);
      return Promise.resolve({ data: { ok: true }, error: null });
    };
    const { rerender } = renderAssistant(
      <AssistantSettings sample={{ state: "connected", scope: "read_write", id: "mcp-1" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ניתוק" }));
    const confirm = screen.getByRole("dialog", { name: "לנתק את העוזר?" });
    expect(confirm).toHaveTextContent("הקוד יפסיק לעבוד. הספרים נשארים.");
    fireEvent.click(within(confirm).getByRole("button", { name: "ניתוק" }));
    await waitFor(() => expect(screen.getByText("העוזר נותק.")).toBeInTheDocument());
    expect(calls.some((name) => name.includes("revoke"))).toBe(true);

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <AssistantSettings sample={{ state: "expired", scope: "read", id: "mcp-1" }} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /חיבור מחדש/ }));
    expect(screen.getByRole("dialog", { name: "חיבור עוזר" })).toBeInTheDocument();
  });

  it("shows a load error and a disabled row when there is no company", () => {
    const { rerender } = renderAssistant(<AssistantSettings sample={{ state: "empty", error: true }} />);
    expect(screen.getByText("לא הצלחנו לטעון את החיבור.")).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <AssistantSettings noCompany />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: /אין עסק עדיין/ })).toBeDisabled();
  });
});

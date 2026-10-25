import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { mercuryNoteStatus, mercurySendToast, TransactionThread } from "./transaction-thread";
import { reviewThreadLabel } from "./review-thread";

// FLOW-957: the thread on the transaction page. Invented names only.

const calls = vi.hoisted(() => ({ rpc: [] as Array<{ name: string; args: unknown }>, invoke: [] as string[] }));

const mercuryNote = { id: "m1", source: "mercury" as const, body: "Lumber for back deck, invoice #4471", mine: false, created_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-21T10:00:00Z", edited: false, mercury_push: null };

const thread = {
  transaction_id: "t1",
  company_id: "c1",
  notes: [
    mercuryNote,
    { id: "n1", source: "flow", body: "Check against the quote", mine: true, created_at: "2026-10-22T07:40:00Z", updated_at: "2026-10-22T07:40:00Z", edited: false, mercury_push: null },
  ],
  files: [
    { id: "f1", note_id: null, source: "mercury", file_name: "receipt-4471.pdf", mime: "application/pdf", bytes: 52000, path: "c1/t1/m.pdf", mine: false, created_at: "2026-10-21T10:00:00Z" },
  ],
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    rpc: (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      if (name === "get_transaction_thread") return Promise.resolve({ data: thread, error: null });
      if (name === "add_transaction_note") return Promise.resolve({ data: "n2", error: null });
      if (name === "edit_transaction_note") return Promise.resolve({ data: { source: "mercury" }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    functions: {
      invoke: (name: string) => {
        calls.invoke.push(name);
        return Promise.resolve({ data: { state: "denied" }, error: null });
      },
    },
  }),
}));

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  calls.rpc.length = 0;
  calls.invoke.length = 0;
});

describe("TransactionThread", () => {
  it("shows Mercury's note with its file, then the owner's note", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites={false} />));
    expect(await screen.findByRole("heading", { name: "הערות וקבצים" })).toBeInTheDocument();
    expect(screen.getByText("Lumber for back deck, invoice #4471")).toBeInTheDocument();
    expect(screen.getByText("receipt-4471.pdf")).toBeInTheDocument();
    expect(screen.getByText("Check against the quote")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "צירוף קובץ" })).toBeInTheDocument();
  });

  it("adds a note from the composer", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites={false} />));
    fireEvent.change(await screen.findByLabelText("הוספת הערה"), { target: { value: "Paid in two parts" } });
    fireEvent.click(screen.getByRole("button", { name: "שליחה" }));
    await waitFor(() => {
      expect(calls.rpc.find((call) => call.name === "add_transaction_note")?.args).toEqual({ p_transaction_id: "t1", p_body: "Paid in two parts" });
    });
  });

  it("edits Mercury's note and sends it to Mercury", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites={false} />));
    fireEvent.click(await screen.findByRole("button", { name: "עריכה" }));
    fireEvent.change(screen.getByLabelText("הערה מ־Mercury"), { target: { value: "Lumber, phase 2" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(calls.invoke).toEqual(["mercury-note"]); });
    expect(calls.rpc.find((call) => call.name === "edit_transaction_note")?.args).toEqual({ p_note_id: "m1", p_body: "Lumber, phase 2" });
    expect(await screen.findByText("נשמר ב־Flow. למפתח של Mercury אין הרשאת כתיבה")).toBeInTheDocument();
  });

  it("gives a viewer no composer and no edit", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites />));
    expect(await screen.findByText("Check against the quote")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "צירוף קובץ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "מחיקת ההערה" })).toBeNull();
  });
});

describe("the thread's words", () => {
  it("says where Mercury's note stands", () => {
    expect(mercuryNoteStatus(null)).toBe("מ־Mercury");
    expect(mercuryNoteStatus({ ...mercuryNote, mercury_push: "pending" as const })).toBe("נשמר ב־Flow · יישלח ל־Mercury");
    expect(mercuryNoteStatus({ ...mercuryNote, mercury_push: "denied" as const })).toBe("נשמר ב־Flow בלבד: למפתח של Mercury אין הרשאת כתיבה");
    expect(mercurySendToast("sent")).toBe("נשמר גם ב־Mercury");
    expect(mercurySendToast("waiting")).toBe("נשמר. יישלח ל־Mercury בסנכרון הבא");
  });

  it("labels the approval card's row", () => {
    expect(reviewThreadLabel(0, 0)).toBe("הוספת הערה או קובץ לפני אישור");
    expect(reviewThreadLabel(1, 1)).toBe("הערות וקבצים · הערה · קובץ");
    expect(reviewThreadLabel(2, 0)).toBe("הערות וקבצים · 2 הערות");
    expect(reviewThreadLabel(0, 3)).toBe("הערות וקבצים · 3 קבצים");
  });
});

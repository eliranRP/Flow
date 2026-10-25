import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { mercuryNoteStatus, saveThreadDraft, TransactionThread } from "./transaction-thread";
import { reviewThreadLabel } from "./review-thread";

// FLOW-957: the thread on the transaction page. Invented names only.

const calls = vi.hoisted(() => ({ rpc: [] as Array<{ name: string; args: unknown }>, uploads: [] as string[] }));

const mercuryNote = { id: "m1", source: "mercury" as const, body: "Lumber for back deck, invoice #4471", mine: false, created_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-21T10:00:00Z", edited: false, edited_in_flow: false };

const thread = {
  transaction_id: "t1",
  company_id: "c1",
  notes: [
    mercuryNote,
    { id: "n1", source: "flow", body: "Check against the quote", mine: true, created_at: "2026-10-22T07:40:00Z", updated_at: "2026-10-22T07:40:00Z", edited: false, edited_in_flow: false },
  ],
  files: [
    { id: "f1", note_id: null, source: "mercury", file_name: "receipt-4471.pdf", mime: "application/pdf", bytes: 52000, path: "c1/t1/m.pdf", mine: false, created_at: "2026-10-21T10:00:00Z" },
  ],
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        upload: (path: string) => {
          calls.uploads.push(path);
          return Promise.resolve({ data: { path }, error: null });
        },
      }),
    },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    rpc: (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      if (name === "get_transaction_thread") return Promise.resolve({ data: thread, error: null });
      if (name === "add_transaction_note") return Promise.resolve({ data: "n2", error: null });
      if (name === "edit_transaction_note") return Promise.resolve({ data: { source: "mercury" }, error: null });
      return Promise.resolve({ data: null, error: null });
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
  calls.uploads.length = 0;
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

  it("edits Mercury's note in Flow only", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites={false} />));
    fireEvent.click(await screen.findByRole("button", { name: "עריכה" }));
    expect(screen.getByText("נשמר ב־Flow בלבד. ב־Mercury ההערה לא משתנה")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("הערה מ־Mercury"), { target: { value: "Lumber, phase 2" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(calls.rpc.find((call) => call.name === "edit_transaction_note")?.args).toEqual({ p_note_id: "m1", p_body: "Lumber, phase 2" });
    });
    expect(await screen.findByText("נשמר ב־Flow")).toBeInTheDocument();
  });

  it("gives a viewer no composer and no edit", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites />));
    expect(await screen.findByText("Check against the quote")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "צירוף קובץ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "מחיקת ההערה" })).toBeNull();
  });
});

describe("saveThreadDraft", () => {
  it("saves a file without a note", async () => {
    const photo = new File([new Uint8Array(10)], "image.jpg", { type: "image/jpeg" });
    await saveThreadDraft("c1", "t1", { text: "  ", files: [photo] });
    expect(calls.rpc.some((call) => call.name === "add_transaction_note")).toBe(false);
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0]).toMatch(/^c1\/t1\/[0-9a-f-]{36}\.jpg$/);
    expect(calls.rpc.find((call) => call.name === "add_transaction_file")?.args).toMatchObject({
      p_transaction_id: "t1",
      p_note_id: null,
      p_file_name: "image.jpg",
      p_mime: "image/jpeg",
    });
  });
});

describe("the thread's words", () => {
  it("says when Mercury's note was edited in Flow", () => {
    expect(mercuryNoteStatus(null)).toBeNull();
    expect(mercuryNoteStatus(mercuryNote)).toBeNull();
    expect(mercuryNoteStatus({ ...mercuryNote, edited_in_flow: true })).toMatch(/^נערך ב־Flow .* · ב־Mercury ההערה לא השתנתה$/);
  });

  it("labels the approval card's row", () => {
    expect(reviewThreadLabel(0, 0)).toBe("הוספת הערה או קובץ");
    expect(reviewThreadLabel(1, 1)).toBe("הערות וקבצים · הערה · קובץ");
    expect(reviewThreadLabel(2, 0)).toBe("הערות וקבצים · 2 הערות");
    expect(reviewThreadLabel(0, 3)).toBe("הערות וקבצים · 3 קבצים");
  });
});

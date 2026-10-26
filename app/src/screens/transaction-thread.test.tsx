import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { mercuryNoteStatus, saveThreadDraft, TransactionThread } from "./transaction-thread";
import { readPickedFile, threadFileUrl } from "../transaction-thread";
import { BeforeApproveSheet, reviewThreadLabel } from "./review-thread";

// FLOW-957: the line's one note and its files on the transaction page. Invented names only.

const calls = vi.hoisted(() => ({ rpc: [] as Array<{ name: string; args: unknown }>, uploads: [] as string[], uploadFails: false, noNote: false }));

const mercuryNote = { id: "m1", source: "mercury" as const, body: "Lumber for back deck, invoice #4471", mine: false, created_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-21T10:00:00Z", edited: false, edited_in_flow: false };

const thread = {
  transaction_id: "t1",
  company_id: "c1",
  notes: [mercuryNote],
  files: [
    { id: "f1", note_id: null, source: "mercury", file_name: "receipt-4471.pdf", mime: "application/pdf", bytes: 52000, path: "c1/t1/m.pdf", mine: false, created_at: "2026-10-21T10:00:00Z" },
  ],
};

vi.mock("../lib/supabase", () => ({
  supabaseApi: { url: "https://flow.example.com", anonKey: "anon-key" },
  getSupabase: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      getSession: () => Promise.resolve({ data: { session: { access_token: "user-token" } } }),
    },
    rpc: (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      if (name === "get_transaction_thread") return Promise.resolve({ data: calls.noNote ? { ...thread, notes: [] } : thread, error: null });
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

// The Storage REST API (the build has no supabase-js storage client): uploads are recorded by path.
const storageFetch = vi.fn((input: string, init?: RequestInit) => {
  const url = input;
  if (url === "https://flow.example.com/storage/v1/object/sign/transaction-files/c1/t1/m.pdf") {
    return Promise.resolve(Response.json({ signedURL: "/object/sign/transaction-files/c1/t1/m.pdf?token=t" }));
  }
  const prefix = "https://flow.example.com/storage/v1/object/transaction-files/";
  if (!url.startsWith(prefix) || init?.method !== "POST") return Promise.resolve(new Response(null, { status: 404 }));
  calls.uploads.push(decodeURIComponent(url.slice(prefix.length)));
  if (calls.uploadFails) return Promise.resolve(Response.json({ message: "Load failed" }, { status: 400 }));
  return Promise.resolve(Response.json({ Key: url.slice(prefix.length) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("fetch", storageFetch);
  storageFetch.mockClear();
  calls.rpc.length = 0;
  calls.uploads.length = 0;
  calls.uploadFails = false;
  calls.noNote = false;
});

const ownNote = { ...mercuryNote, id: "n1", source: "flow" as const, body: "Check against the quote", mine: true };

describe("TransactionThread", () => {
  it("shows the line's one note, Mercury's, with the line's files and the paperclip", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites={false} />));
    expect(await screen.findByRole("heading", { name: "הערה וקבצים" })).toBeInTheDocument();
    expect(screen.getByText("הערה מ־Mercury")).toBeInTheDocument();
    expect(screen.getByText("Lumber for back deck, invoice #4471")).toBeInTheDocument();
    expect(screen.getByText("receipt-4471.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "צירוף קובץ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "מחיקת ההערה" })).toBeNull();
  });

  it("adds the note when the line has none", async () => {
    calls.noNote = true;
    render(wrap(<TransactionThread transactionId="t1" holdWrites={false} />));
    fireEvent.change(await screen.findByLabelText("הערה"), { target: { value: "Paid in two parts" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(calls.rpc.find((call) => call.name === "add_transaction_note")?.args).toEqual({ p_transaction_id: "t1", p_body: "Paid in two parts" });
    });
  });

  it("edits Mercury's note in Flow only", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites={false} />));
    fireEvent.click(await screen.findByRole("button", { name: "עריכת ההערה" }));
    expect(screen.getByText("נשמר ב־Flow בלבד. ב־Mercury ההערה לא משתנה")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("הערה מ־Mercury"), { target: { value: "Lumber, phase 2" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(calls.rpc.find((call) => call.name === "edit_transaction_note")?.args).toEqual({ p_note_id: "m1", p_body: "Lumber, phase 2" });
    });
    expect(await screen.findByText("נשמר ב־Flow")).toBeInTheDocument();
  });

  it("gives a viewer the note and files, with no edit and no paperclip", async () => {
    render(wrap(<TransactionThread transactionId="t1" holdWrites />));
    expect(await screen.findByText("Lumber for back deck, invoice #4471")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "צירוף קובץ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "עריכת ההערה" })).toBeNull();
  });
});

describe("saveThreadDraft", () => {
  it("saves a file without a note", async () => {
    const photo = new File([new Uint8Array(10)], "image.jpg", { type: "image/jpeg" });
    await saveThreadDraft("c1", "t1", { text: "  ", files: [photo] }, null);
    expect(calls.rpc.some((call) => call.name === "add_transaction_note")).toBe(false);
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0]).toMatch(/^c1\/t1\/[0-9a-f-]{36}\.jpg$/);
    const headers = new Headers(storageFetch.mock.calls[0]?.[1]?.headers);
    expect([headers.get("authorization"), headers.get("apikey"), headers.get("content-type"), headers.get("x-upsert")])
      .toEqual(["Bearer user-token", "anon-key", "image/jpeg", "false"]);
    expect(calls.rpc.find((call) => call.name === "add_transaction_file")?.args).toMatchObject({
      p_transaction_id: "t1",
      p_note_id: null,
      p_file_name: "image.jpg",
      p_mime: "image/jpeg",
    });
  });

  it("puts the files up before the note, so a failed upload saves nothing", async () => {
    calls.uploadFails = true;
    const photo = new File([new Uint8Array(10)], "image.jpg", { type: "image/jpeg" });
    await expect(saveThreadDraft("c1", "t1", { text: "Paid in two parts", files: [photo] }, null)).rejects.toThrow("Load failed");
    expect(calls.rpc.map((call) => call.name)).toEqual([]);
  });

  it("adds the note when the line has none, then records the files on the line", async () => {
    const photo = new File([new Uint8Array(10)], "image.jpg", { type: "image/jpeg" });
    await saveThreadDraft("c1", "t1", { text: "Paid in two parts", files: [photo] }, null);
    expect(calls.rpc.map((call) => call.name)).toEqual(["add_transaction_note", "add_transaction_file"]);
    expect(calls.rpc[1]?.args).toMatchObject({ p_note_id: null, p_path: calls.uploads[0] });
  });

  it("edits the line's note instead of adding a second one, and leaves it alone when the text is the same", async () => {
    await saveThreadDraft("c1", "t1", { text: "Checked twice", files: [] }, ownNote);
    expect(calls.rpc).toEqual([{ name: "edit_transaction_note", args: { p_note_id: "n1", p_body: "Checked twice" } }]);
    calls.rpc.length = 0;
    await saveThreadDraft("c1", "t1", { text: "Check against the quote", files: [] }, ownNote);
    expect(calls.rpc).toEqual([]);
  });
});

describe("BeforeApproveSheet", () => {
  it("closes and approves at the tap, and the upload finishes behind it", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    storageFetch.mockImplementationOnce(async (input: string) => {
      await gate;
      calls.uploads.push(input);
      return Response.json({ Key: input });
    });
    const onOpenChange = vi.fn();
    const onApprove = vi.fn();
    render(wrap(<BeforeApproveSheet open onOpenChange={onOpenChange} transactionId="t1" approveDisabled={false} onApprove={onApprove} />));
    expect(await screen.findByLabelText("הערה מ־Mercury")).toHaveValue("Lumber for back deck, invoice #4471");
    const input = document.querySelector<HTMLInputElement>("input[type=file][multiple]");
    if (!input) throw new Error("no file input");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], "image.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "לשמור ולאשר" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(calls.rpc.some((call) => call.name === "add_transaction_file")).toBe(false);
    release();
    await waitFor(() => { expect(calls.rpc.some((call) => call.name === "add_transaction_file")).toBe(true); });
    expect(calls.rpc.some((call) => call.name === "edit_transaction_note" || call.name === "add_transaction_note")).toBe(false);
  });
});

describe("threadFileUrl", () => {
  it("signs a ten-minute link through the Storage REST API", async () => {
    await expect(threadFileUrl("c1/t1/m.pdf")).resolves.toBe("https://flow.example.com/storage/v1/object/sign/transaction-files/c1/t1/m.pdf?token=t");
    expect(storageFetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ expiresIn: 600 }));
  });
});

describe("readPickedFile", () => {
  it("copies a picked file into memory with its name and type", async () => {
    const picked = new File([new Uint8Array([1, 2, 3])], "image.jpg", { type: "image/jpeg" });
    const copy = await readPickedFile(picked);
    expect(copy).not.toBe(picked);
    expect([copy.name, copy.type, copy.size]).toEqual(["image.jpg", "image/jpeg", 3]);
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
    expect(reviewThreadLabel(1, 1)).toBe("הערה · קובץ");
    expect(reviewThreadLabel(1, 0)).toBe("הערה");
    expect(reviewThreadLabel(0, 3)).toBe("3 קבצים");
  });
});

import { describe, expect, it } from "vitest";
import { fileSizeLabel, threadCount, threadFileProblem, threadNote, threadObjectName, type Thread } from "./transaction-thread";

// FLOW-957: the line's one note, the file checks and the labels. Invented names only.

const base = { mine: true, edited: false, edited_in_flow: false } as const;

const thread: Thread = {
  transaction_id: "t1",
  company_id: "c1",
  notes: [
    { ...base, id: "n2", source: "flow", body: "Second", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z" },
    { ...base, id: "m1", source: "mercury", body: "From Mercury", mine: false, created_at: "2026-10-21T10:00:00Z", updated_at: "2026-10-21T10:00:00Z" },
    { ...base, id: "n1", source: "flow", body: "First", created_at: "2026-10-19T10:00:00Z", updated_at: "2026-10-19T10:00:00Z" },
  ],
  files: [
    { id: "f1", note_id: "n1", source: "flow", file_name: "a.pdf", mime: "application/pdf", bytes: 10, path: "c1/t1/a.pdf", mine: true, created_at: "2026-10-19T10:00:00Z" },
    { id: "f2", note_id: null, source: "flow", file_name: "b.jpg", mime: "image/jpeg", bytes: 10, path: "c1/t1/b.jpg", mine: true, created_at: "2026-10-19T12:00:00Z" },
    { id: "f3", note_id: null, source: "mercury", file_name: "receipt.pdf", mime: "application/pdf", bytes: 10, path: "c1/t1/m.pdf", mine: false, created_at: "2026-10-21T10:00:00Z" },
  ],
};

describe("threadNote", () => {
  it("is Mercury's note when the line has one, else the owner's, else none", () => {
    expect(threadNote(thread)?.id).toBe("m1");
    expect(threadNote({ ...thread, notes: thread.notes.filter((note) => note.source === "flow") })?.id).toBe("n2");
    expect(threadNote({ ...thread, notes: [] })).toBeNull();
  });
});

describe("files", () => {
  it("takes pictures and PDF up to 20MB", () => {
    expect(threadFileProblem({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(threadFileProblem({ type: "image/heic", size: 1000 })).toBeNull();
    expect(threadFileProblem({ type: "application/zip", size: 1000 })).toBe("אפשר לצרף תמונה או PDF");
    expect(threadFileProblem({ type: "image/png", size: 0 })).toBe("הקובץ ריק");
    expect(threadFileProblem({ type: "image/png", size: 21 * 1024 * 1024 })).toBe("קובץ עד 20MB");
  });

  it("stores a file under a fresh id with its extension only", () => {
    expect(threadObjectName("קבלה של הספק.PDF", "abc")).toBe("abc.pdf");
    expect(threadObjectName("no-extension", "abc")).toBe("abc");
    expect(threadObjectName("../../evil.sh.jpg", "abc")).toBe("abc.jpg");
  });

  it("labels sizes in KB and MB", () => {
    expect(fileSizeLabel(300)).toBe("1KB");
    expect(fileSizeLabel(52_000)).toBe("51KB");
    expect(fileSizeLabel(1_258_291)).toBe("1.2MB");
    expect(fileSizeLabel(2 * 1024 * 1024)).toBe("2MB");
  });

  it("counts a line with nothing as zero", () => {
    expect(threadCount({ t1: { notes: 1, files: 2 } }, "t1")).toEqual({ notes: 1, files: 2 });
    expect(threadCount(undefined, "t2")).toEqual({ notes: 0, files: 0 });
  });
});

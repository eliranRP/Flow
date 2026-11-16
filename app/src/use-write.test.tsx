import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BOOKS_CLOSED_MS, booksClosedNote, booksClosedSettingNote, MY_COMPANIES_KEY, VIEWER_NOTE } from "./company-role-cache";
import { ToastProvider } from "./ui/toast";
import { changeSaveFailure } from "./ui/change-sheet";
import { booksClosedMessage, booksClosedThrough, useWrite } from "./use-write";

vi.mock("./use-books", () => ({
  useInvalidateBooks: () => () => Promise.resolve(),
}));

const toastShow = vi.hoisted(() => vi.fn());

// Every show() is recorded, so a test can read a toast's time.
vi.mock("./ui/toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui/toast")>();
  return {
    ...actual,
    useToast: () => {
      const toast = actual.useToast();
      return { ...toast, show: (input: Parameters<typeof toast.show>[0]) => { toastShow(input); return toast.show(input); } };
    },
  };
});

function Save({
  run,
  failure,
  onSplit,
  onError,
}: {
  run: () => Promise<void>;
  failure: typeof changeSaveFailure | string;
  onSplit?: () => void;
  onError?: (error: Error) => void;
}) {
  const save = useWrite({ keys: [], failure, run, onSplit, onError: (error) => { onError?.(error); } });
  return <button type="button" onClick={() => { save.mutate(); }}>שמירה</button>;
}

function renderSave(
  run: () => Promise<void>,
  failure: typeof changeSaveFailure | string = changeSaveFailure,
  onSplit?: () => void,
  onError?: (error: Error) => void,
): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Save run={run} failure={failure} onSplit={onSplit} onError={onError} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("booksClosedThrough", () => {
  it("reads the closed date from the database's message", () => {
    expect(booksClosedThrough(new Error("the books are closed through 2026-10-31"))).toBe("2026-10-31");
  });

  it("reads it when PostgREST wraps the message", () => {
    expect(booksClosedThrough(new Error("ERROR: the books are closed through 2026-10-31 (SQLSTATE P0001)"))).toBe("2026-10-31");
  });

  it("returns null for any other refusal", () => {
    expect(booksClosedThrough(new Error("category kind must match the direction"))).toBeNull();
    expect(booksClosedThrough(new Error("no company"))).toBeNull();
    expect(booksClosedThrough(new Error("the books are closed"))).toBeNull();
  });

  it("returns null for a malformed date", () => {
    expect(booksClosedThrough(new Error("the books are closed through 2026-10-3"))).toBeNull();
    expect(booksClosedThrough(new Error("the books are closed through 2026-13-45"))).toBeNull();
    expect(booksClosedThrough(new Error("the books are closed through 31/10/2026"))).toBeNull();
  });
});

describe("booksClosedMessage (FLOW-1170)", () => {
  it("words a setting's refusal as a setting, and still reads its date", () => {
    const setting = new Error("the books are closed through 2026-10-31: this setting changes them");
    expect(booksClosedThrough(setting)).toBe("2026-10-31");
    expect(booksClosedMessage(setting)).toBe(booksClosedSettingNote("2026-10-31"));
    expect(booksClosedMessage(new Error("ERROR: the books are closed through 2026-10-31: this setting changes them (SQLSTATE P0001)")))
      .toBe(booksClosedSettingNote("2026-10-31"));
  });

  it("keeps a line's refusal worded as a line, and null for any other error", () => {
    expect(booksClosedMessage(new Error("the books are closed through 2026-10-31"))).toBe(booksClosedNote("2026-10-31"));
    expect(booksClosedMessage(new Error("this setting changes them"))).toBeNull();
    expect(booksClosedMessage(new Error("no company"))).toBeNull();
  });
});

describe("useWrite", () => {
  it("says a setting's refusal in the setting's words, with no retry (FLOW-1170)", async () => {
    renderSave(() => Promise.reject(new Error("the books are closed through 2026-10-31: this setting changes them")), "לא נשמר.");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(booksClosedSettingNote("2026-10-31"))).toBeInTheDocument();
    expect(screen.queryByText(booksClosedNote("2026-10-31"))).not.toBeInTheDocument();
    expect(screen.queryByText("לא נשמר.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: booksClosedSettingNote("2026-10-31"), durationMs: BOOKS_CLOSED_MS }));
  });

  it("says the books are closed through the date, with no retry, and still runs onError", async () => {
    const onError = vi.fn();
    renderSave(() => Promise.reject(new Error("the books are closed through 2026-10-31")), "לא הצלחנו למחוק.", undefined, onError);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(booksClosedNote("2026-10-31"))).toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו למחוק.")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-toast-bad")).toBeNull();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "the books are closed through 2026-10-31" }));
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: booksClosedNote("2026-10-31"), durationMs: BOOKS_CLOSED_MS }));
  });

  it("offers לפיצול, not a retry, when the database refuses a shared cost", async () => {
    const onSplit = vi.fn();
    renderSave(() => Promise.reject(new Error("shared costs are split, not assigned to one project")), changeSaveFailure, onSplit);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("עלות משותפת מפוצלת במסך הפיצול.")).toBeInTheDocument();
    expect(document.querySelector(".ui-toast-bad")).toBeNull();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "לפיצול" }));
    expect(onSplit).toHaveBeenCalledOnce();
  });

  it("offers a retry when the network fails", async () => {
    renderSave(() => Promise.reject(new Error("Failed to fetch")));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByText("לא נשמר – אין חיבור")).toBeInTheDocument();
  });

  it("does not offer a retry when the client is missing", async () => {
    renderSave(() => Promise.reject(new Error("supabase")), "לא הצלחנו ליצור את הקטגוריה.");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא הצלחנו ליצור את הקטגוריה.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("offers a retry for a server error", async () => {
    renderSave(() => Promise.reject(new Error("Internal Server Error")), "לא הצלחנו ליצור את הקטגוריה.");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
  });

  it("dismisses the retry toast when a new save starts", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    renderSave(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("Failed to fetch"));
      return new Promise((resolve) => { release = resolve; });
    });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    });
    fireEvent.click(retry);
    expect(calls).toBe(2);
    release();
    await waitFor(() => {
      expect(calls).toBe(2);
    });
  });

  it("does not offer a retry for another deterministic refusal", async () => {
    renderSave(() => Promise.reject(new Error("category kind must match the direction")));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(screen.getByText("לא נשמר. בדקו את הפרטים ונסו שוב.")).toBeInTheDocument();
    });
    expect(screen.queryByText("לא נשמר – אין חיבור")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("says the company is view only, and reads the role again, when the server answers no company", async () => {
    const client = renderSave(() => Promise.reject(new Error("no company")));
    const reread = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(VIEWER_NOTE)).toBeInTheDocument();
    expect(document.querySelector(".ui-toast-bad")).toBeNull();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    expect(reread).toHaveBeenCalledWith({ queryKey: [MY_COMPANIES_KEY] });
  });

  it("keeps the screen's own words for forbidden, and still reads the role again", async () => {
    const client = renderSave(() => Promise.reject(Object.assign(new Error("forbidden"), { code: "42501" })), "אין הרשאה לעדכן את השורה.");
    const reread = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("אין הרשאה לעדכן את השורה.")).toBeInTheDocument();
    expect(reread).toHaveBeenCalledWith({ queryKey: [MY_COMPANIES_KEY] });
  });

  it("leaves the role alone for any other failure", async () => {
    const client = renderSave(() => Promise.reject(new Error("category kind must match the direction")));
    const reread = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא נשמר. בדקו את הפרטים ונסו שוב.")).toBeInTheDocument();
    expect(reread).not.toHaveBeenCalledWith({ queryKey: [MY_COMPANIES_KEY] });
  });
});

// FLOW-1214 (review): `apply` changes the cache at the tap and its undo runs on failure, before the optimistic snapshot
// goes back. The undo records what the cache holds when it runs: the tapped value means it ran first.
const ROWS = [{ id: 1, paid: false }];
const PAID_ROWS = [{ id: 1, paid: true }];

function ApplyWrite({ run, seen, withApply }: { run: () => Promise<void>; seen: unknown[]; withApply: boolean }) {
  const client = useQueryClient();
  const write = useWrite({
    keys: [],
    failure: "לא נשמר.",
    run,
    optimistic: () => [{ key: ["rows"], update: () => PAID_ROWS }],
    ...(withApply ? { apply: () => () => { seen.push(client.getQueryData(["rows"])); } } : {}),
  });
  return <button type="button" onClick={() => { write.mutate(); }}>שמירה</button>;
}

function renderApply(run: () => Promise<void>, seen: unknown[], withApply = true): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["rows"], ROWS);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ApplyWrite run={run} seen={seen} withApply={withApply} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe("useWrite's apply (FLOW-1214)", () => {
  it("on failure the undo runs before the snapshot restore", async () => {
    const seen: unknown[] = [];
    const client = renderApply(() => Promise.reject(new Error("refused")), seen);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא נשמר.")).toBeInTheDocument();
    expect(seen).toEqual([PAID_ROWS]);
    expect(client.getQueryData(["rows"])).toEqual(ROWS);
  });

  it("does not undo a write that succeeded", async () => {
    const seen: unknown[] = [];
    const client = renderApply(() => Promise.resolve(), seen);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(seen).toEqual([]);
    expect(client.getQueryData(["rows"])).toEqual(PAID_ROWS);
  });

  it("a failure with no apply still restores the snapshot and shows the failure", async () => {
    const client = renderApply(() => Promise.reject(new Error("refused")), [], false);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא נשמר.")).toBeInTheDocument();
    expect(client.getQueryData(["rows"])).toEqual(ROWS);
  });
});

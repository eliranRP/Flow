import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BOOKS_CLOSED_MS, booksClosedNote, MY_COMPANIES_KEY, VIEWER_NOTE } from "./company-role-cache";
import { ToastProvider } from "./ui/toast";
import { changeSaveFailure } from "./ui/change-sheet";
import { booksClosedThrough, useWrite } from "./use-write";

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

describe("useWrite", () => {
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

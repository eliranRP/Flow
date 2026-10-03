import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./ui/toast";
import { changeSaveFailure } from "./ui/change-sheet";
import { useWrite } from "./use-write";

vi.mock("./use-books", () => ({
  useInvalidateBooks: () => () => Promise.resolve(),
}));

function Save({
  run,
  failure,
  onSplit,
}: {
  run: () => Promise<void>;
  failure: typeof changeSaveFailure | string;
  onSplit?: () => void;
}) {
  const save = useWrite({ keys: [], failure, run, onSplit });
  return <button type="button" onClick={() => { save.mutate(); }}>שמירה</button>;
}

function renderSave(
  run: () => Promise<void>,
  failure: typeof changeSaveFailure | string = changeSaveFailure,
  onSplit?: () => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Save run={run} failure={failure} onSplit={onSplit} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("useWrite", () => {
  it("offers לחלוקה, not a retry, when the database refuses a shared cost", async () => {
    const onSplit = vi.fn();
    renderSave(() => Promise.reject(new Error("shared costs are split, not assigned to one project")), changeSaveFailure, onSplit);
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("עלות משותפת מחולקת במסך החלוקה.")).toBeInTheDocument();
    expect(document.querySelector(".ui-toast-bad")).toBeNull();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "לחלוקה" }));
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
});

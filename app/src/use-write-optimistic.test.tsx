import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./ui/toast";
import { useWrite } from "./use-write";

const books = vi.hoisted(() => ({ refresh: (): Promise<void> => Promise.resolve() }));

vi.mock("./use-books", () => ({
  useInvalidateBooks: () => () => books.refresh(),
}));

type Row = { id: number; paid: boolean };

const ROWS: Row[] = [{ id: 1, paid: false }];
const PAID: Row[] = [{ id: 1, paid: true }];

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Pay({
  run,
  optimistic = true,
  onSuccess,
}: {
  run: (id: number) => Promise<void>;
  optimistic?: boolean;
  onSuccess?: () => void;
}) {
  const pay = useWrite<number>({
    keys: ["unpaid"],
    success: "סומן כשולם",
    failure: "לא נשמר. נסו שוב.",
    run,
    onSuccess,
    ...(optimistic
      ? {
          optimistic: (id: number) => [{
            key: ["rows"],
            update: (old: unknown) => (old as Row[]).map((row) => (row.id === id ? { ...row, paid: true } : row)),
          }],
        }
      : {}),
  });
  return <button type="button" onClick={() => { pay.mutate(1); }}>לתשלום</button>;
}

/** Hides the write's screen on demand, while the toasts and the query client stay mounted above it. */
function Host(props: Parameters<typeof Pay>[0]) {
  const [shown, setShown] = useState(true);
  return (
    <>
      {shown && <Pay {...props} />}
      <button type="button" onClick={() => { setShown(false); }}>סגירה</button>
    </>
  );
}

function renderPay(
  ui: "pay" | "host",
  props: Parameters<typeof Pay>[0],
): { client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["rows"], ROWS);
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        {ui === "pay" ? <Pay {...props} /> : <Host {...props} />}
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { client };
}

describe("useWrite with optimistic", () => {
  beforeEach(() => {
    books.refresh = () => Promise.resolve();
  });

  it("shows the new value before run resolves, and a slow run does not hold it back", async () => {
    const write = deferred();
    const run = vi.fn(() => write.promise);
    const { client } = renderPay("pay", { run });
    fireEvent.click(screen.getByRole("button", { name: "לתשלום" }));
    await waitFor(() => {
      expect(client.getQueryData(["rows"])).toEqual(PAID);
    });
    expect(run).toHaveBeenCalledWith(1);
    expect(screen.queryByText("סומן כשולם")).not.toBeInTheDocument();
    act(() => { write.resolve(); });
    expect(await screen.findByText("סומן כשולם")).toBeInTheDocument();
  });

  it("restores the snapshot and shows the failure when the write is refused", async () => {
    const { client } = renderPay("pay", { run: () => Promise.reject(new Error("category kind must match the direction")) });
    fireEvent.click(screen.getByRole("button", { name: "לתשלום" }));
    expect(await screen.findByText("לא נשמר. נסו שוב.")).toBeInTheDocument();
    expect(client.getQueryData(["rows"])).toEqual(ROWS);
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("offers a retry on a dropped connection, and pressing it re-runs the same payload", async () => {
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("Failed to fetch")) : Promise.resolve();
    });
    const { client } = renderPay("pay", { run });
    fireEvent.click(screen.getByRole("button", { name: "לתשלום" }));
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    expect(client.getQueryData(["rows"])).toEqual(ROWS);
    fireEvent.click(retry);
    expect(await screen.findByText("סומן כשולם")).toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(1);
    expect(client.getQueryData(["rows"])).toEqual(PAID);
  });

  it("runs the success step without waiting for the background refresh", async () => {
    books.refresh = () => new Promise<void>(() => undefined);
    const onSuccess = vi.fn();
    const { client } = renderPay("pay", { run: () => Promise.resolve(), onSuccess });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "לתשלום" }));
    expect(await screen.findByText("סומן כשולם")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["rows"] });
  });

  it("still awaits the refresh before the success step for a write without optimistic", async () => {
    const refresh = deferred();
    books.refresh = () => refresh.promise;
    const onSuccess = vi.fn();
    renderPay("pay", { run: () => Promise.resolve(), optimistic: false, onSuccess });
    fireEvent.click(screen.getByRole("button", { name: "לתשלום" }));
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText("סומן כשולם")).not.toBeInTheDocument();
    act(() => { refresh.resolve(); });
    expect(await screen.findByText("סומן כשולם")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith(1);
  });

  it("shows the failure, and retries the write, after the screen unmounted", async () => {
    const write = deferred();
    const run = vi.fn<(id: number) => Promise<void>>()
      .mockReturnValueOnce(write.promise)
      .mockResolvedValue(undefined);
    const { client } = renderPay("host", { run });
    fireEvent.click(screen.getByRole("button", { name: "לתשלום" }));
    await waitFor(() => {
      expect(client.getQueryData(["rows"])).toEqual(PAID);
    });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("button", { name: "לתשלום" })).not.toBeInTheDocument();
    act(() => { write.reject(new Error("Failed to fetch")); });
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    expect(client.getQueryData(["rows"])).toEqual(ROWS);
    fireEvent.click(retry);
    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
    expect(run).toHaveBeenLastCalledWith(1);
    expect(await screen.findByText("סומן כשולם")).toBeInTheDocument();
  });
});

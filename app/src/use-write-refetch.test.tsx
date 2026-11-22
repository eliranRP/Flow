import { type QueryKey, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "./ui/toast";
import { useWrite } from "./use-write";

// FLOW-1250: an optimistic write refetches each cached answer once. These tests run the real
// useInvalidateBooks, so a request is a call to a watched query's queryFn.

const ROWS = [{ id: 1, paid: false }];

let fetches: Map<string, number>;

function countOf(key: QueryKey): number {
  return fetches.get(JSON.stringify(key)) ?? 0;
}

/** A query that is active while mounted, and counts every request it makes. */
function Watch({ queryKey }: { queryKey: QueryKey }) {
  useQuery({
    queryKey,
    queryFn: () => {
      const id = JSON.stringify(queryKey);
      fetches.set(id, (fetches.get(id) ?? 0) + 1);
      return Promise.resolve(ROWS);
    },
  });
  return null;
}

function Pay({ keys, snapshotKey }: { keys: string[]; snapshotKey: QueryKey }) {
  const pay = useWrite<number>({
    keys,
    success: "סומן כשולם",
    failure: "לא נשמר. נסו שוב.",
    run: () => Promise.resolve(),
    optimistic: () => [{ key: snapshotKey, update: (old: unknown) => old }],
  });
  return <button type="button" onClick={() => { pay.mutate(1); }}>לתשלום</button>;
}

/** Renders the write and the active queries, then the requests made after the first load. */
async function payAndCount(keys: string[], snapshotKey: QueryKey, watched: QueryKey[]): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Pay keys={keys} snapshotKey={snapshotKey} />
        {watched.map((queryKey) => <Watch key={JSON.stringify(queryKey)} queryKey={queryKey} />)}
      </ToastProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => {
    for (const queryKey of watched) expect(countOf(queryKey)).toBe(1);
  });
  for (const queryKey of watched) fetches.set(JSON.stringify(queryKey), 0);
  fireEvent.click(screen.getByRole("button", { name: "לתשלום" }));
  expect(await screen.findByText("סומן כשולם")).toBeInTheDocument();
  // Let any second request a write would send start before the counts are read.
  await new Promise((resolve) => { setTimeout(resolve, 30); });
}

describe("useWrite refetches each active query once after an optimistic write (FLOW-1250)", () => {
  beforeEach(() => {
    fetches = new Map();
  });

  it("sends one request for a snapshot that sits under one of its keys", async () => {
    await payAndCount(["unpaid"], ["unpaid", "2026-11"], [["unpaid", "2026-11"]]);
    expect(countOf(["unpaid", "2026-11"])).toBe(1);
  });

  it("sends one request for each active query when every snapshot sits under the keys", async () => {
    await payAndCount(
      ["project", "dashboard"],
      ["project", "live", 7],
      [["project", "live", 7], ["project", "live", 8], ["dashboard"]],
    );
    expect(countOf(["project", "live", 7])).toBe(1);
    expect(countOf(["project", "live", 8])).toBe(1);
    expect(countOf(["dashboard"])).toBe(1);
  });

  it("still refreshes a snapshot that sits outside its keys", async () => {
    await payAndCount(["unpaid"], ["rows"], [["rows"], ["unpaid"]]);
    expect(countOf(["rows"])).toBe(1);
    expect(countOf(["unpaid"])).toBe(1);
  });
});

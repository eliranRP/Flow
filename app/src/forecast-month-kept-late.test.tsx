import { hashKey, QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSetForecastItem } from "./forecast-month";
import { flushKeptReads, keepReadsOf, resetKeptReadsForTests } from "./kept-reads";
import type { KeptRow, KeptStore } from "./kept-store";
import { resetShownCompanyForTests, setShownCompany } from "./lib/company-header";
import { renderWithProviders } from "./test-render";

// FLOW-1341 (review): a month answer that a read kept while the write was out (the screen then goes) is pre-skip: the settle drops its kept row too.
type Answer = { data: unknown; error: unknown };
const server = vi.hoisted(() => ({ write: [] as Array<(answer: Answer) => void> }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({ rpc: () => new Promise<Answer>((resolve) => { server.write.push(resolve); }) }),
}));

const MONTH = "2026-12";
const ANSWER = ["month-forecast", "off", "answer", MONTH];
const OVERRIDES = ["month-forecast", "off", "overrides", MONTH];

function memoryStore(): KeptStore & { held: Map<string, KeptRow> } {
  const held = new Map<string, KeptRow>();
  return {
    held,
    all: () => Promise.resolve([...held.values()]),
    ids: () => Promise.resolve([...held.keys()]),
    put: (next) => { for (const item of next) held.set(item.id, item); return Promise.resolve(); },
    remove: (ids) => { for (const id of ids) held.delete(id); return Promise.resolve(); },
    clear: () => { held.clear(); return Promise.resolve(); },
  };
}

function Skip() {
  const set = useSetForecastItem(MONTH);
  return <button type="button" onClick={() => { set.mutate({ key: "party:expense:power:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>;
}

beforeEach(() => {
  server.write.length = 0;
  resetShownCompanyForTests();
  setShownCompany("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
});

describe("a pre-skip answer kept while the write was out (FLOW-1341)", () => {
  it("is deleted from the device when the write is accepted and no screen holds it", async () => {
    const store = memoryStore();
    resetKeptReadsForTests(store);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    keepReadsOf(client);
    renderWithProviders(<Skip />, { client });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(server.write).toHaveLength(1); });
    // A read of the month that lands while the write is out carries the pre-skip answer; nobody observes it.
    await client.query({ queryKey: ANSWER, queryFn: () => Promise.resolve({ pre: true }), staleTime: 0 });
    await client.query({ queryKey: OVERRIDES, queryFn: () => Promise.resolve([]), staleTime: 0 });
    await flushKeptReads();
    expect([...store.held.keys()].sort()).toEqual([hashKey(ANSWER), hashKey(OVERRIDES)].sort());
    server.write[0]?.({ data: null, error: null });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(async () => { await flushKeptReads(); expect(store.held.size).toBe(0); });
  });
});

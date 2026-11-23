import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { jevBookingsKey, reviewWaiting, useJevBookingCountQuery } from "./jev-booking-count";
import { useJevBookingsQuery } from "./jev-bookings";

const server = vi.hoisted(() => ({ reads: 0, fail: false }));
vi.mock("./ready-client", () => ({
  readyClient: () => Promise.resolve({
    rpc: () => {
      server.reads += 1;
      if (server.fail) return Promise.resolve({ data: null, error: new Error("offline") });
      return Promise.resolve({
        data: [{
          write_id: "w1", transaction_id: "t1", kind: "book_line", party: "Example Co", doc_date: "2026-10-20",
          direction: "expense", amount_gross: "-10000", currency: "USD", source: "manual",
          journal: { transaction_id: "t1", currency: "USD", balanced: true, booked_by_ai: true, legs: [] },
        }],
        error: null,
      });
    },
  }),
}));

/** FLOW-955 (owner, 2026-10-22): Home's לאישור count includes Jev's bookings waiting for review. */
describe("Home's review count", () => {
  it("adds Jev's waiting bookings to the queue's own items", () => {
    expect(reviewWaiting(3, 2)).toBe(5);
    expect(reviewWaiting(0, 1)).toBe(1);
  });

  it("is the queue alone while the bookings read is out or failed", () => {
    expect(reviewWaiting(4, undefined)).toBe(4);
  });
});

/** FLOW-1272: Home's count and Review's queue are one read under one key. */
describe("Jev's bookings read", () => {
  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30 * 60_000 } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    return { client, wrapper };
  }

  it("goes out once for Home's count and Review's queue, and each reads it as before", async () => {
    server.reads = 0;
    const { client, wrapper } = setup();
    const home = renderHook(() => useJevBookingCountQuery(), { wrapper });
    await waitFor(() => { expect(home.result.current.data).toBe(1); });
    // Review opens after Home: its queue is parsed from the read Home made.
    const review = renderHook(() => useJevBookingsQuery(), { wrapper });
    await waitFor(() => { expect(review.result.current.data).toHaveLength(1); });
    expect(review.result.current.data?.[0]?.amount_gross).toBe(-10_000n);
    expect(server.reads).toBe(1);
    expect(client.getQueryCache().findAll({ queryKey: ["jev-bookings"] })).toHaveLength(1);
    expect(client.getQueryData(jevBookingsKey("off"))).toBeDefined();
  });

  it("goes out once when both mount together", async () => {
    server.reads = 0;
    const { wrapper } = setup();
    const both = renderHook(() => ({ count: useJevBookingCountQuery(), queue: useJevBookingsQuery() }), { wrapper });
    await waitFor(() => { expect(both.result.current.queue.data).toHaveLength(1); });
    expect(both.result.current.count.data).toBe(1);
    expect(server.reads).toBe(1);
  });

  it("is not retried after a failure, for Home's count or Review's queue, whichever rendered last", async () => {
    server.reads = 0;
    server.fail = true;
    try {
      // The app's own default would retry: the read's options must say no retry for both hooks.
      const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      );
      const both = renderHook(() => ({ queue: useJevBookingsQuery(), count: useJevBookingCountQuery() }), { wrapper });
      await waitFor(() => { expect(both.result.current.count.isError).toBe(true); });
      expect(both.result.current.queue.isError).toBe(true);
      expect(server.reads).toBe(1);
    } finally {
      server.fail = false;
    }
  });
});

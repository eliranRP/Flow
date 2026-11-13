import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewWaiting, useJevBookingCountQuery } from "./jev-booking-count";
import { useJevBookingsQuery } from "./jev-bookings";

const rpc = vi.hoisted(() => ({ calls: [] as string[], answer: [] as unknown[] }));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      rpc.calls.push(name);
      return Promise.resolve({ data: rpc.answer, error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));
vi.mock("./preview", () => ({ useHomePreview: () => "off" }));

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  rpc.calls = [];
  rpc.answer = [{}, {}];
});

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

/** FLOW-1171: Home's count and Review's list are one query, so Review finds Home's list cached. */
describe("Home's Jev count and Review's list share one read", () => {
  it("counts the list already cached under the queue's key, without a second read", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(["jev-bookings", "off"], [{}, {}, {}]);
    const { result } = renderHook(() => useJevBookingCountQuery(), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(result.current.data).toBe(3);
    });
    expect(rpc.calls).toEqual([]);
  });

  it("gives Review the same cached list", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const list = [{}, {}];
    client.setQueryData(["jev-bookings", "off"], list);
    const { result } = renderHook(() => useJevBookingsQuery(), { wrapper: wrapperFor(client) });
    expect(result.current.data).toBe(list);
    expect(rpc.calls).toEqual([]);
  });
});

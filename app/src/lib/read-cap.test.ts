import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { MAX_REST_IN_FLIGHT, withReadCap } from "./read-cap";

type Call = { url: string; signal?: AbortSignal | null; resolve: () => void; reject: (e: Error) => void };

function fake() {
  const calls: Call[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const done = (): void => {
        inFlight -= 1;
      };
      calls.push({
        url: input as string,
        signal: init?.signal,
        resolve: () => {
          done();
          resolve(new Response("{}"));
        },
        reject: (e) => {
          done();
          reject(e);
        },
      });
    })) as typeof fetch;
  return { calls, fetchFn, peak: () => peak };
}

const REST = "https://x.supabase.co/rest/v1/t";
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withReadCap", () => {
  it("never has more than N in flight and starts the rest first in, first out", async () => {
    const f = fake();
    const cap = withReadCap(f.fetchFn, 2);
    const ps = [1, 2, 3, 4, 5].map((i) => cap(`${REST}?i=${String(i)}`));
    expect(f.calls.map((c) => c.url.slice(-1))).toEqual(["1", "2"]);
    f.calls[0]?.resolve();
    await tick();
    expect(f.calls.map((c) => c.url.slice(-1))).toEqual(["1", "2", "3"]);
    f.calls[1]?.resolve();
    f.calls[2]?.resolve();
    await tick();
    expect(f.calls.map((c) => c.url.slice(-1))).toEqual(["1", "2", "3", "4", "5"]);
    f.calls[3]?.resolve();
    f.calls[4]?.resolve();
    await Promise.all(ps);
    expect(f.peak()).toBe(2);
  });

  it("an abort while queued rejects with an AbortError and never calls fetch", async () => {
    const f = fake();
    const cap = withReadCap(f.fetchFn, 1);
    const first = cap(`${REST}?i=1`);
    const ac = new AbortController();
    const queued = cap(`${REST}?i=2`, { signal: ac.signal });
    const third = cap(`${REST}?i=3`);
    ac.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    f.calls[0]?.resolve();
    await first;
    await tick();
    expect(f.calls.map((c) => c.url.slice(-1))).toEqual(["1", "3"]);
    f.calls[1]?.resolve();
    await third;
  });

  it("an already-aborted request is never sent or queued", async () => {
    const f = fake();
    const cap = withReadCap(f.fetchFn, 1);
    const first = cap(`${REST}?i=1`);
    const ac = new AbortController();
    ac.abort();
    await expect(cap(`${REST}?i=2`, { signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    f.calls[0]?.resolve();
    await first;
    expect(f.calls).toHaveLength(1);
  });

  it("an abort while in flight releases the slot", async () => {
    const f = fake();
    const cap = withReadCap(f.fetchFn, 1);
    const ac = new AbortController();
    const first = cap(`${REST}?i=1`, { signal: ac.signal });
    const second = cap(`${REST}?i=2`);
    expect(f.calls).toHaveLength(1);
    ac.abort();
    f.calls[0]?.reject(new DOMException("aborted", "AbortError"));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    expect(f.calls).toHaveLength(2);
    f.calls[1]?.resolve();
    await second;
  });

  it("a rejected fetch releases the slot", async () => {
    const f = fake();
    const cap = withReadCap(f.fetchFn, 1);
    const first = cap(`${REST}?i=1`);
    const second = cap(`${REST}?i=2`);
    f.calls[0]?.reject(new TypeError("network"));
    await expect(first).rejects.toThrow("network");
    await tick();
    expect(f.calls).toHaveLength(2);
    f.calls[1]?.resolve();
    await second;
  });

  it("auth, storage, functions and realtime go straight through, even with the cap full", () => {
    const f = fake();
    const cap = withReadCap(f.fetchFn, 1);
    void cap(`${REST}?i=1`);
    void cap("https://x.supabase.co/auth/v1/token?grant_type=refresh_token");
    void cap("https://x.supabase.co/storage/v1/object/a");
    void cap("https://x.supabase.co/functions/v1/f");
    expect(f.calls).toHaveLength(4);
  });
});

describe("supabase client", () => {
  it("23 parallel rpc calls never exceed the cap", async () => {
    const f = fake();
    const client = createClient("https://x.supabase.co", "anon", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: withReadCap(f.fetchFn) },
    });
    const ps = Array.from({ length: 23 }, (_, i) => Promise.resolve(client.rpc("r" as never, { i } as never)));
    let done = 0;
    while (done < 23) {
      await vi.waitFor(() => {
        expect(f.calls.length).toBeGreaterThan(done);
      });
      await tick();
      expect(f.calls.length - done).toBeLessThanOrEqual(MAX_REST_IN_FLIGHT);
      const batch = f.calls.slice(done);
      for (const c of batch) c.resolve();
      done += batch.length;
    }
    await Promise.all(ps);
    expect(f.peak()).toBe(MAX_REST_IN_FLIGHT);
  });

  it("frees the slot when the fetch throws before returning a promise", async () => {
    let throwNext = true;
    const run = vi.fn(() => {
      if (throwNext) {
        throwNext = false;
        throw new TypeError("bad input");
      }
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;
    const cap = withReadCap(run, 1);
    await expect(cap(REST)).rejects.toThrow("bad input");
    await expect(cap(REST)).resolves.toBeInstanceOf(Response);
  });
});

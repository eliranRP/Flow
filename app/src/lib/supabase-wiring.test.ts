import { afterEach, expect, it, vi } from "vitest";

const A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("the app's client names the company a queued request was issued under (FLOW-1344)", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.resetModules();
  const calls: Array<{ init?: RequestInit; resolve: () => void }> = [];
  vi.stubGlobal(
    "fetch",
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        calls.push({
          init,
          resolve: () => {
            resolve(new Response("{}"));
          },
        });
      }),
  );
  const { setShownCompany } = await import("./company-header");
  const { supabase } = await import("./supabase");
  setShownCompany(USER, A);
  const ps = Array.from({ length: 5 }, (_, i) => Promise.resolve(supabase?.rpc("r" as never, { i } as never)));
  await vi.waitFor(() => {
    expect(calls).toHaveLength(4);
  });
  setShownCompany(USER, B);
  calls[0]?.resolve();
  await vi.waitFor(() => {
    expect(calls).toHaveLength(5);
  });
  expect(new Headers(calls[4]?.init?.headers).get("x-flow-company")).toBe(A);
  for (const c of calls) c.resolve();
  await Promise.all(ps);
});

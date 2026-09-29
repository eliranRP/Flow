import { describe, expect, it, vi } from "vitest";
import { connectValidated } from "../../supabase/functions/_shared/connect-order";

const LIST_FOLDERS = "https://api.sumit.co.il/crm/schema/listfolders/";

describe("sumit-connect", () => {
  it("does not write when listfolders rejects the key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write = vi.fn(() => Promise.resolve({ error: null }));
    const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({
        Status: 1,
        UserErrorMessage: "invalid api key",
      }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    await expect(connectValidated({
      companyId: 1001,
      apiKey: "secret-key",
      fetch: fetcher,
      write,
    })).rejects.toThrow("sumit_auth");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(LIST_FOLDERS);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes only after listfolders returns Status 0", async () => {
    const write = vi.fn(() => Promise.resolve({ stored: true }));
    const fetcher = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ Status: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    );
    await expect(connectValidated({
      companyId: 1001,
      apiKey: "secret-key",
      fetch: fetcher,
      write,
    })).resolves.toEqual({ stored: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });
});

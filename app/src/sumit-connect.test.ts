import { describe, expect, it, vi } from "vitest";
import { connectValidated } from "../../supabase/functions/_shared/connect-order";
import { classifySumitStatus } from "../../supabase/functions/_shared/sumit-policy";

// --- sumit-connect.test.ts

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
    const called = fetcher.mock.calls[0]?.[0];
    expect(typeof called === "string" ? called : "").toBe(LIST_FOLDERS);
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
// --- sumit-policy.test.ts

describe("classifySumitStatus", () => {
  it.each([
    ["API is restricted due to exceeding the ActionsBilling obligo", "sumit_rejected"],
    ["invalid api key", "sumit_auth"],
    ["wrong company id", "sumit_auth"],
    ["מפתח API שגוי", "sumit_auth"],
    ["מזהה חברה לא תואם", "sumit_auth"],
    ["מזהה מסמך לא קיים", "sumit_rejected"],
    ["permission denied for document", "sumit_rejected"],
    ["unauthorized", "sumit_auth"],
  ] as const)("classifies %s as %s", (message, code) => {
    expect(classifySumitStatus(message)).toBe(code);
  });
});
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { connectValidated } from "../../supabase/functions/_shared/connect-order";

const LIST_FOLDERS = "https://api.sumit.co.il/crm/schema/listfolders/";

describe("sumit-connect", () => {
  it("validates listfolders before it writes", async () => {
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

    const source = readFileSync(path.resolve(process.cwd(), "../supabase/functions/sumit-connect/index.ts"), "utf8");
    const call = source.indexOf("await connectValidated");
    const rpc = source.indexOf('admin.rpc("replace_sumit_connection"');
    expect(call).toBeGreaterThan(-1);
    expect(source.slice(0, call)).not.toContain("admin.rpc");
    expect(source.slice(call, rpc)).toContain("write:");
    expect(source.match(/admin\.rpc\(/g)).toHaveLength(1);
  });
});

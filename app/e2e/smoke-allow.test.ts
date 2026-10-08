import { describe, expect, it } from "vitest";
import { isReadRequest } from "./smoke-allow";

const supabase = "https://example-ref.supabase.co";

describe("smoke write guard", () => {
  it("lets reads through anywhere", () => {
    expect(isReadRequest("GET", "https://flow-app-dx5.pages.dev/settings", supabase)).toBe(true);
    expect(isReadRequest("OPTIONS", `${supabase}/rest/v1/rpc/set_category_hidden`, supabase)).toBe(true);
  });

  it("allows the token refresh, the user read, status and the list RPCs only on the Supabase host", () => {
    expect(isReadRequest("POST", `${supabase}/auth/v1/token?grant_type=refresh_token`, supabase)).toBe(true);
    expect(isReadRequest("GET", `${supabase}/auth/v1/user`, supabase)).toBe(true);
    expect(isReadRequest("POST", `${supabase}/functions/v1/flow-mcp/status`, supabase)).toBe(true);
    expect(isReadRequest("POST", `${supabase}/rest/v1/rpc/list_review`, supabase)).toBe(true);
    const other = "https://evil.example";
    expect(isReadRequest("POST", `${other}/auth/v1/token`, supabase)).toBe(false);
    expect(isReadRequest("GET", `${other}/auth/v1/user`, supabase)).toBe(false);
    expect(isReadRequest("POST", `${other}/functions/v1/flow-mcp/status`, supabase)).toBe(false);
    expect(isReadRequest("POST", `${other}/rest/v1/rpc/list_review`, supabase)).toBe(false);
    expect(isReadRequest("POST", `https://example-ref.supabase.co.evil.example/auth/v1/token`, supabase)).toBe(false);
  });

  it("blocks writes on the Supabase host", () => {
    expect(isReadRequest("POST", `${supabase}/auth/v1/signup`, supabase)).toBe(false);
    expect(isReadRequest("PUT", `${supabase}/auth/v1/user`, supabase)).toBe(false);
    expect(isReadRequest("POST", `${supabase}/rest/v1/rpc/set_category_hidden`, supabase)).toBe(false);
    expect(isReadRequest("PATCH", `${supabase}/rest/v1/projects?id=eq.1`, supabase)).toBe(false);
    expect(isReadRequest("POST", `${supabase}/functions/v1/flow-mcp/status/extra`, supabase)).toBe(false);
  });
});

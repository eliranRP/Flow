import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_HEADER,
  noteShownCompanyUser,
  resetShownCompanyForTests,
  setShownCompany,
  shownCompanyFor,
  shownCompanyId,
  withCompanyHeader,
} from "./company-header";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPANY_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPANY_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const API = "https://flow.example.com";

function sentHeader(base: ReturnType<typeof vi.fn>): string | null {
  const init = base.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get(COMPANY_HEADER);
}

describe("company header (FLOW-601)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetShownCompanyForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the shown company on RPC, table and edge function calls", async () => {
    const base = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response("{}")));
    const fetcher = withCompanyHeader(base);
    setShownCompany(USER_A, COMPANY_A);
    await fetcher(`${API}/rest/v1/rpc/get_dashboard`, { method: "POST", headers: { apikey: "public" } });
    expect(sentHeader(base)).toBe(COMPANY_A);
    expect(new Headers((base.mock.calls.at(-1)?.[1] as RequestInit).headers).get("apikey")).toBe("public");
    await fetcher(`${API}/rest/v1/projects?select=id`, {});
    expect(sentHeader(base)).toBe(COMPANY_A);
    await fetcher(`${API}/functions/v1/mercury-sync`, { method: "POST" });
    expect(sentHeader(base)).toBe(COMPANY_A);
  });

  it("leaves sign-in calls and a session with no shown company as they are", async () => {
    const base = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response("{}")));
    const fetcher = withCompanyHeader(base);
    await fetcher(`${API}/rest/v1/rpc/get_dashboard`, {});
    expect(sentHeader(base)).toBeNull();
    setShownCompany(USER_A, COMPANY_A);
    await fetcher(`${API}/auth/v1/token?grant_type=refresh_token`, { method: "POST" });
    expect(sentHeader(base)).toBeNull();
  });

  it("switches the header at once and keeps it per user across a reload", () => {
    setShownCompany(USER_A, COMPANY_A);
    setShownCompany(USER_A, COMPANY_B);
    expect(shownCompanyId()).toBe(COMPANY_B);
    expect(JSON.parse(localStorage.getItem("flow-shown-company") ?? "{}")).toEqual({ [USER_A]: COMPANY_B });
    resetShownCompanyForTests();
    noteShownCompanyUser(USER_A);
    expect(shownCompanyId()).toBe(COMPANY_B);
    expect(shownCompanyFor(USER_A)).toBe(COMPANY_B);
  });

  it("keeps this tab's company when another tab switches and the same user's session event arrives", () => {
    setShownCompany(USER_A, COMPANY_A);
    // Another tab opened B and saved it; this tab then hears SIGNED_IN or TOKEN_REFRESHED for A.
    localStorage.setItem("flow-shown-company", JSON.stringify({ [USER_A]: COMPANY_B }));
    noteShownCompanyUser(USER_A);
    expect(shownCompanyId()).toBe(COMPANY_A);
  });

  it("drops another user's company when the session changes, and keeps none after sign-out", () => {
    setShownCompany(USER_A, COMPANY_A);
    noteShownCompanyUser(USER_B);
    expect(shownCompanyId()).toBeNull();
    expect(shownCompanyFor(USER_A)).toBeNull();
    expect(localStorage.getItem("flow-shown-company")).toBeNull();
    setShownCompany(USER_B, COMPANY_B);
    noteShownCompanyUser(null);
    expect(shownCompanyId()).toBeNull();
    expect(localStorage.getItem("flow-shown-company")).toBeNull();
  });

  it("sends nothing for an id that is not a uuid, and null clears the company", () => {
    setShownCompany(USER_A, "not-a-uuid");
    expect(shownCompanyId()).toBeNull();
    setShownCompany(USER_A, COMPANY_A);
    setShownCompany(USER_A, null);
    expect(shownCompanyId()).toBeNull();
    expect(localStorage.getItem("flow-shown-company")).toBeNull();
  });

  it("still works when storage refuses", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setShownCompany(USER_A, COMPANY_A);
    expect(shownCompanyId()).toBe(COMPANY_A);
    expect(shownCompanyFor(USER_A)).toBe(COMPANY_A);
    expect(shownCompanyFor(USER_B)).toBeNull();
  });
});

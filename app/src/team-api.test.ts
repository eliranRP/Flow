import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITE_GONE, MEMBER_GONE, OWNER_ONLY, liveTeamApi, teamFailure } from "./team-api";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invokeEdge: vi.fn() }));
vi.mock("./lib/supabase", () => ({ getSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("./edge", () => ({ invokeEdge: mocks.invokeEdge }));

describe("teamFailure (FLOW-601)", () => {
  const failure = teamFailure("לא הצלחנו.");

  it("names a member already gone apart from an invite that is no longer open", () => {
    expect(failure(new Error("member not found"))).toEqual({ message: MEMBER_GONE, retry: false });
    expect(failure(new Error("invite not found"))).toEqual({ message: INVITE_GONE, retry: false });
    expect(failure(new Error("invite is not pending"))).toEqual({ message: INVITE_GONE, retry: false });
  });

  it("keeps its own words for anything else, and says when the role refused", () => {
    expect(failure(new Error("network"))).toBe("לא הצלחנו.");
    expect(failure(Object.assign(new Error("forbidden"), { code: "42501" }))).toEqual({ message: OWNER_ONLY, retry: false });
  });
});

describe("inviteMember sends the invite email (FLOW-601)", () => {
  const saved = { id: "i-1", email: "noa@example.com", role: "viewer", status: "pending" };
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.invokeEdge.mockReset();
    mocks.invokeEdge.mockResolvedValue({ sent: true });
  });

  it("mails a new invite once", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...saved, existing: false }, error: null });
    await liveTeamApi.inviteMember("noa@example.com", "viewer");
    expect(mocks.invokeEdge).toHaveBeenCalledWith("invite-email", { invite_id: "i-1" });
  });

  it("does not mail again when only the role of a pending invite changed", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...saved, existing: true }, error: null });
    await liveTeamApi.inviteMember("noa@example.com", "viewer");
    expect(mocks.invokeEdge).not.toHaveBeenCalled();
  });

  it("keeps the saved invite when the email fails to send", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...saved, existing: false }, error: null });
    mocks.invokeEdge.mockRejectedValue(new Error("send_failed"));
    await expect(liveTeamApi.inviteMember("noa@example.com", "viewer")).resolves.toMatchObject({ id: "i-1" });
  });
});

describe("the invitation screen's reads and writes (FLOW-513)", () => {
  const base = { id: "i-1", company_id: "c-1", company_name: "נכסי הגפן בע״מ", role: "viewer", invited_by_name: "יוסי כהן", created_at: "2026-10-01T09:00:00Z" };
  beforeEach(() => { mocks.rpc.mockReset(); });

  it("reads the expiry fields, and an older payload without them", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { ...base, email: "you@example.com", status: "expired", invited_by_role: "owner", expires_at: "2026-10-09T12:00:00Z", seen_at: null },
        base,
      ],
      error: null,
    });
    const rows = await liveTeamApi.myInvites();
    expect(rows[0]).toMatchObject({ status: "expired", invited_by_role: "owner", email: "you@example.com", seen_at: null });
    expect(rows[1]?.status).toBeUndefined();
  });

  it("marks an invite seen through mark_invite_seen, and throws its refusal", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "i-1" }, error: null });
    await liveTeamApi.markInviteSeen("i-1");
    expect(mocks.rpc).toHaveBeenCalledWith("mark_invite_seen", { p_invite_id: "i-1" });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "invite not found" } });
    await expect(liveTeamApi.markInviteSeen("i-1")).rejects.toThrow("invite not found");
  });
});

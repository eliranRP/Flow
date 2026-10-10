import { describe, expect, it } from "vitest";
import { INVITE_GONE, MEMBER_GONE, OWNER_ONLY, teamFailure } from "./team-api";

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

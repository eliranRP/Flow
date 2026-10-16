import { describe, expect, it } from "vitest";
import { FILED_TODAY_EMPTY_BODY, FILED_TODAY_EMPTY_TITLE } from "./filed-today-copy";

describe("שויכו היום copy", () => {
  it("keeps the empty title and covers both sources", () => {
    expect(FILED_TODAY_EMPTY_TITLE).toBe("אין תנועות ששויכו היום");
    expect(FILED_TODAY_EMPTY_BODY).toBe("כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן.");
  });
});

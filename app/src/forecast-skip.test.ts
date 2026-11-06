import { describe, expect, it } from "vitest";
import { forecastKeyOf, skippedKeys } from "./forecast-skip";

// FLOW-1079: the forecast item a schedule row is, and the month's items taken out.
describe("forecast skip keys", () => {
  const row = { direction: "expense" as const, party_id: "power", currency: "USD", project_id: "p1" };

  it("keys a charge as the month forecast does, with its project only when the party is split", () => {
    expect(forecastKeyOf(row, false)).toBe("party:expense:power:USD");
    expect(forecastKeyOf(row, true)).toBe("party:expense:power:USD:p1");
    expect(forecastKeyOf({ ...row, project_id: null }, true)).toBe("party:expense:power:USD:none");
  });

  it("reads the items moved out of the month, not the ones only changed", () => {
    const keys = skippedKeys([
      { item_key: "party:expense:power:USD", amount_minor: null, due_on: null, moved_out: true },
      { item_key: "party:income:rent:USD", amount_minor: 90_000, due_on: null, moved_out: false },
    ]);
    expect([...keys]).toEqual(["party:expense:power:USD"]);
  });
});

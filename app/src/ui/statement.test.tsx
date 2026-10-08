import { describe, expect, it } from "vitest";
import { statementMethodFromMeta, statementMethodOf } from "./statement";

/** FLOW-305 with FLOW-304 bank details. Invented card digits. */
const meta = (method: string | null, card_last4: string | null = null) =>
  ({ method, card_last4 }) as Parameters<typeof statementMethodFromMeta>[0];

describe("statementMethodOf with bank details", () => {
  it("shows a card as ••4242, spoken with its last 4", () => {
    const method = statementMethodOf("mercury", undefined, meta("card", "4242"));
    expect(method).toMatchObject({ text: "••4242", spoken: "כרטיס שמסתיים ב־4242", ltr: true });
  });

  it("never shows more than the last 4 digits", () => {
    expect(statementMethodOf("mercury", undefined, meta("card", "4242424242"))).toMatchObject({ text: "כרטיס" });
    expect(statementMethodOf("mercury", undefined, meta("card", null))?.text).toBe("כרטיס");
  });

  it("uses FLOW-304's labels for ACH, wire, transfer and check", () => {
    expect(statementMethodOf("mercury", undefined, meta("ach"))).toMatchObject({ text: "ACH", spoken: "העברת ACH", ltr: true });
    const wire = statementMethodOf("mercury", undefined, meta("wire"));
    expect(wire).toMatchObject({ text: "העברה בנקאית" });
    expect(wire?.spoken).toBeUndefined();
    expect(wire?.ltr).toBeUndefined();
    expect(statementMethodOf("mercury", undefined, meta("transfer"))?.text).toBe("העברה פנימית");
    expect(statementMethodOf("mercury", undefined, meta("check"))?.text).toBe("צ׳ק");
  });

  it("keeps בנק with no meta, no method, or other", () => {
    expect(statementMethodOf("mercury", undefined)?.text).toBe("בנק");
    expect(statementMethodOf("mercury", undefined, null)?.text).toBe("בנק");
    expect(statementMethodOf("mercury", undefined, meta(null))?.text).toBe("בנק");
    expect(statementMethodOf("mercury", undefined, meta("other"))?.text).toBe("בנק");
  });

  it("leaves a SUMIT document on its kind even with meta", () => {
    expect(statementMethodOf("sumit", "invoice", meta("card", "4242"))?.text).toBe("חשבונית");
  });
});

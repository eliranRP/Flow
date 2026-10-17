import { describe, expect, it } from "vitest";
import { paceSheetCopy, paceToast } from "./pace";

describe("the pace sheet (FLOW-415, FLOW-447c)", () => {
  it("says what לא קבוע does, on the board's words", () => {
    const copy = paceSheetCopy("month", "Bayside Water Utility");
    expect(copy.choices[0]).toEqual({ value: "never", label: "לא קבוע", description: "לא יופיע בקבועים" });
    expect(copy.subtitle).toBe("חל על כל התשלומים של Bayside Water Utility");
  });

  it("notes the detected pace only", () => {
    const copy = paceSheetCopy("quarter");
    expect(copy.choices.find((choice) => choice.value === "quarter")?.description).toBe("זוהה לבד מהתשלומים הקודמים");
    expect(copy.choices.find((choice) => choice.value === "month")?.description).toBeUndefined();
    expect(paceToast("quarter")).toBe("נשמר: כל רבעון");
  });
});

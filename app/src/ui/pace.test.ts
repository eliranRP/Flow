import { describe, expect, it } from "vitest";
import { paceSheetCopy, paceToast } from "./pace";

describe("the pace sheet (FLOW-415, FLOW-447c)", () => {
  it("puts לא קבוע last and says what it does, on the board's words (FLOW-963)", () => {
    const copy = paceSheetCopy("month", "Bayside Water Utility");
    expect(copy.choices.map((choice) => choice.value)).toEqual(["month", "2months", "quarter", "year", "never"]);
    expect(copy.choices.at(-1)).toEqual({ value: "never", label: "לא קבוע", description: "לא יופיע בקבועים, בהתראות ובתחזית" });
    expect(copy.subtitle).toBe("חל על כל התשלומים של Bayside Water Utility");
  });

  it("notes the detected pace only", () => {
    const copy = paceSheetCopy("quarter");
    expect(copy.choices.find((choice) => choice.value === "quarter")?.description).toBe("זוהה לבד מהתשלומים הקודמים");
    expect(copy.choices.find((choice) => choice.value === "month")?.description).toBeUndefined();
    expect(paceToast("quarter")).toBe("נשמר: כל רבעון");
  });
});

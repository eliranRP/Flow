import { describe, expect, it } from "vitest";
import { FILED_TODAY_EMPTY_BODY, FILED_TODAY_EMPTY_TITLE } from "./filed-today-copy";

describe("שויכו היום copy", () => {
  it("keeps the empty title and covers both sources", () => {
    expect(FILED_TODAY_EMPTY_TITLE).toBe("עוד לא שויך כלום היום");
    expect(FILED_TODAY_EMPTY_BODY).toBe("שורות שתאשרו בלאישור, או ש־SUMIT והעוזר ישייכו, יופיעו כאן עד סוף היום, לפי פרויקט.");
  });
});

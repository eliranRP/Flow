// FLOW-162: the report PDF's right-to-left layout. Invented text only.
import { assertEquals } from "jsr:@std/assert@1";
import { bidiRuns, visualSegments } from "./report_text.ts";

const visual = (text: string) => visualSegments(text).map((segment) => segment.text).join("");

Deno.test("a Hebrew line reads right to left: its letters are reversed", () => {
  assertEquals(visual("רווח נקי"), "יקנ חוור");
});

Deno.test("an amount and a date keep their order inside a Hebrew line", () => {
  assertEquals(visual("רווח נקי $29,000"), "$29,000 יקנ חוור");
  assertEquals(visual("נכון ל־31/10/2026"), "31/10/2026־ל ןוכנ");
  assertEquals(visual("הוצאות −$47,200"), "−$47,200 תואצוה");
});

Deno.test("a Latin name with a space stays one run", () => {
  assertEquals(bidiRuns("פרויקט Cedar St · השנה").map((run) => run.text), ["פרויקט ", "Cedar St", " · השנה"]);
  assertEquals(visual("Cedar St"), "Cedar St");
});

Deno.test("brackets are mirrored inside Hebrew", () => {
  assertEquals(visual("(מכווץ)"), "(ץווכמ)");
});

Deno.test("each segment names the subset that holds its glyphs; the shekel sign is in the Hebrew one", () => {
  assertEquals(visualSegments("סה״כ $100").map((segment) => segment.script), ["latin", "hebrew"]);
  assertEquals(visualSegments("₪500").map((segment) => segment.script), ["hebrew", "latin"]);
});

Deno.test("a shortened line's ellipsis ends the text it cuts", () => {
  assertEquals(visual("Phase Two Townhom…"), "Phase Two Townhom…");
  assertEquals(visual("הוצאות הנכס…"), "…סכנה תואצוה");
});

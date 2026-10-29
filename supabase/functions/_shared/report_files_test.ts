// FLOW-162: the report's PDF and CSV, from an invented company's reports (report_sample.ts).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { cell, decimal, renderReportCsv } from "./report_csv.ts";
import { reportFileName } from "./report_model.ts";
import { forFontkit, renderReportPdf } from "./report_pdf.ts";
import { SAMPLE_BALANCE, SAMPLE_FILE, SAMPLE_STATEMENT } from "./report_sample.ts";

Deno.test("the PDF holds one page per report here, each with its page number", async () => {
  const bytes = await renderReportPdf(SAMPLE_FILE);
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assertEquals(doc.getPageCount(), 3);
  const [width, height] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
  assertEquals([Math.round(width), Math.round(height)], [595, 842]);
});

Deno.test("a long P&L runs onto more pages and never drops a line", async () => {
  const many = { ...SAMPLE_STATEMENT, currencies: SAMPLE_STATEMENT.currencies.map((row) => ({ ...row, expense: Array.from({ length: 30 }, () => row.expense).flat() })) };
  const bytes = await renderReportPdf({ ...SAMPLE_FILE, parts: [{ kind: "pnl", statement: many, byProject: false, expand: true }] });
  assert((await PDFDocument.load(bytes)).getPageCount() >= 3);
});

Deno.test("the CSV opens in Excel: a byte-order mark, the same totals as the reports, amounts as numbers", () => {
  const csv = renderReportCsv(SAMPLE_FILE);
  assert(csv.startsWith("\uFEFF"));
  assertStringIncludes(csv, "סה״כ הכנסות,,,USD,96200.00");
  assertStringIncludes(csv, "סה״כ הוצאות,,,USD,-67200.00");
  assertStringIncludes(csv, "Riverside Commons Phase Two Townhomes,USD,44200.00,-30000.00,14200.00");
  assertStringIncludes(csv, "התחייבויות והון,,USD,615000.00");
  assertStringIncludes(csv, "לא נספר ברווח,קרן הלוואה,,USD,-12000.00");
  assertEquals(SAMPLE_BALANCE.currencies[0]?.total_liabilities_and_equity_minor, 61_500_000n);
});

Deno.test("a CSV cell is quoted when it has to be, and a formula is defused", () => {
  assertEquals(decimal(-1234567n), "-12345.67");
  assertEquals(decimal(5n), "0.05");
  assertEquals(cell('Cedar "St", unit 2'), '"Cedar ""St"", unit 2"');
  assertEquals(cell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assertEquals(cell("-120.00"), "-120.00");
});

Deno.test("the file's name says the report, its dates and its projects", () => {
  assertEquals(reportFileName(SAMPLE_FILE, "pdf"), "דוחות_2026-01-01_2026-10-31_כל-הפרויקטים.pdf");
  assertEquals(reportFileName({ ...SAMPLE_FILE, parts: [{ kind: "balance", sheet: SAMPLE_BALANCE }] }, "csv"), "מאזן_2026-10-31_כל-הפרויקטים.csv");
});

Deno.test("Hebrew is drawn right to left: the font engine lays each run out in the page's visual order", async () => {
  const { default: fontkit } = await import("npm:@pdf-lib/fontkit@1.1.1");
  const { HEBREW_400 } = await import("./report_fonts.ts");
  const { visualSegments } = await import("./report_text.ts");
  const font = fontkit.create(Uint8Array.from(atob(HEBREW_400), (char) => char.charCodeAt(0)));
  for (const line of ["רווח והפסד", "עמוד 1 מתוך 3", "סה״כ הוצאות −$67,200", "נכון ל־31/10/2026"]) {
    for (const segment of visualSegments(line).filter((item) => item.script === "hebrew")) {
      const drawn = font.layout(forFontkit(segment)).glyphs.map((glyph: { codePoints: number[] }) => String.fromCodePoint(...glyph.codePoints)).join("");
      assertEquals(drawn, segment.text, line);
    }
  }
  // Read right to left, the drawn line is the text itself.
  assertEquals([...visualSegments("רווח נקי").map((segment) => segment.text).join("")].reverse().join(""), "רווח נקי");
});

Deno.test("a file name stays short and plain, whatever the project is called", () => {
  const long = { ...SAMPLE_STATEMENT, project_name: `${"פרויקט ארוך מאוד ".repeat(10)}\u200f\u0007` };
  const name = reportFileName({ ...SAMPLE_FILE, parts: [{ kind: "pnl", statement: long, byProject: false, expand: true }] }, "pdf");
  assert(new TextEncoder().encode(name).length <= 255, name);
  assert(!/[\p{Cc}\p{Cf}]/u.test(name));
  assert(name.endsWith(".pdf"));
});

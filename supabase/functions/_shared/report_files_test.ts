// FLOW-162: the report's PDF and CSV, from an invented company's reports (report_sample.ts).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { cell, decimal, renderReportCsv } from "./report_csv.ts";
import { reportFileName } from "./report_model.ts";
import { forFontkit, percent, renderReportPdf } from "./report_pdf.ts";
import { periods } from "./report_grid.ts";
import { SAMPLE_BALANCE, SAMPLE_BALANCE_GRID, SAMPLE_FILE, SAMPLE_PNL_GRID, SAMPLE_QUARTER_GRID, SAMPLE_STATEMENT } from "./report_sample.ts";
import { columnName, crc32, renderReportXlsx, workbookSheets } from "./report_xlsx.ts";

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
  const bytes = await renderReportPdf({ ...SAMPLE_FILE, parts: [{ kind: "pnl", statement: many, expand: true }] });
  assert((await PDFDocument.load(bytes)).getPageCount() >= 3);
});

Deno.test("the CSV opens in Excel: a byte-order mark, the same totals as the reports, amounts as numbers", () => {
  const csv = renderReportCsv(SAMPLE_FILE);
  assert(csv.startsWith("\uFEFF"));
  assertStringIncludes(csv, "סה״כ הכנסות,,,USD,96200.00");
  assertStringIncludes(csv, "סה״כ הוצאות,,,USD,-67200.00");
  // FLOW-991: the by-project grid, a column per project and the total last.
  assertStringIncludes(csv, "חשבון,מטבע,Maple Ave,Riverside Commons Phase Two Townhomes,הוצאות כלליות,סה״כ");
  assertStringIncludes(csv, "רווח נקי,USD,21000.00,14200.00,-6200.00,29000.00");
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
  const name = reportFileName({ ...SAMPLE_FILE, parts: [{ kind: "pnl", statement: long, expand: true }] }, "pdf");
  assert(new TextEncoder().encode(name).length <= 255, name);
  assert(!/[\p{Cc}\p{Cf}]/u.test(name));
  assert(name.endsWith(".pdf"));
});

Deno.test("the CSV carries the PDF's notes: kept out of profit, waiting for review, and the balance check with its warnings", () => {
  const csv = renderReportCsv(SAMPLE_FILE);
  assertStringIncludes(csv, 'הערה,"קרן, פיקדון מסים וביטוח וקניית נכסים לא נספרים ברווח; הם במאזן."');
  assertStringIncludes(csv, "הערה,2 תנועות ממתינות לבדיקה בתקופה ולא נכללו.");
  assertStringIncludes(csv, "הערה,מאוזן · נכסים = התחייבויות + הון");
  const off = { ...SAMPLE_BALANCE, currencies: SAMPLE_BALANCE.currencies.map((row) => ({ ...row, balanced: false, warnings: [{ account_name: "Suspense", balance_minor: -50_000n }] })) };
  const unbalanced = renderReportCsv({ ...SAMPLE_FILE, parts: [{ kind: "balance", sheet: off }] });
  assertStringIncludes(unbalanced, "הערה,לא מאוזן: כדאי לבדוק את הספרים");
  assertStringIncludes(unbalanced, "אזהרה,חשבון מעבר,USD,-500.00");
});

Deno.test("a percent takes the amounts' minus sign", () => {
  assertEquals(percent(-44), "−44%");
  assertEquals(percent(30), "30%");
});

// FLOW-991: the grids.
const grid = (part: typeof SAMPLE_PNL_GRID) => part.grids[0]!;
const rowOf = (part: typeof SAMPLE_PNL_GRID, label: string) => grid(part).rows.find((row) => row.label === label)!;

Deno.test("the P&L by project: the total column equals the company's statement, and each project's net its own", () => {
  const company = SAMPLE_STATEMENT.currencies[0]!;
  assertEquals(rowOf(SAMPLE_PNL_GRID, "סה״כ הכנסות").total, company.income_minor);
  assertEquals(rowOf(SAMPLE_PNL_GRID, "סה״כ הוצאות").total, -company.expense_minor);
  assertEquals(rowOf(SAMPLE_PNL_GRID, "רווח נקי").total, company.net_minor);
  assertEquals(rowOf(SAMPLE_PNL_GRID, "רווח נקי").cells, SAMPLE_STATEMENT.projects.map((project) => project.currencies[0]!.net_minor));
  // A category is one row across the projects, its sub-categories under it adding up to it.
  const parent = rowOf(SAMPLE_PNL_GRID, "הוצאות הנכסים");
  assertEquals(parent.kind, "parent");
  assertEquals(parent.total, (parent.plus ?? []).reduce((sum, at) => sum + (grid(SAMPLE_PNL_GRID).rows[at]!.total ?? 0n), 0n));
  assertEquals(grid(SAMPLE_PNL_GRID).rows.filter((row) => row.label === "שכירות").length, 1);
});

Deno.test("the balance sheet by project: 'כללי' is the company less the projects, net assets per project, equity in the total only", () => {
  const sheet = grid(SAMPLE_BALANCE_GRID);
  assertEquals(sheet.columns, ["Maple Ave", "Riverside Commons", "כללי"]);
  const company = SAMPLE_BALANCE.currencies[0]!;
  assertEquals(rowOf(SAMPLE_BALANCE_GRID, "סה״כ נכסים").total, company.assets.total_minor);
  assertEquals(rowOf(SAMPLE_BALANCE_GRID, "בנק").cells, [1_000_000n, 500_000n, 3_000_000n]);
  assertEquals(rowOf(SAMPLE_BALANCE_GRID, "נכסים נטו (נכסים פחות התחייבויות)").cells, [13_000_000n, 13_500_000n, 2_000_000n]);
  const equity = rowOf(SAMPLE_BALANCE_GRID, "סה״כ הון");
  assertEquals(equity.cells, [null, null, null]);
  assertEquals(equity.total, rowOf(SAMPLE_BALANCE_GRID, "נכסים נטו (נכסים פחות התחייבויות)").total);
});

Deno.test("the balance sheet by period has no total column; each column balances", () => {
  const sheet = grid(SAMPLE_QUARTER_GRID);
  assertEquals(sheet.hasTotal, false);
  const assets = rowOf(SAMPLE_QUARTER_GRID, "סה״כ נכסים").cells;
  assertEquals(rowOf(SAMPLE_QUARTER_GRID, "התחייבויות והון").cells, assets);
});

Deno.test("periods: months, quarters and years, the first and last clipped to the range", () => {
  assertEquals(periods("month", "2026-01-15", "2026-03-10").map((span) => [span.from, span.to, span.label]), [
    ["2026-01-15", "2026-01-31", "ינו׳"],
    ["2026-02-01", "2026-02-28", "פבר׳"],
    ["2026-03-01", "2026-03-10", "מרץ"],
  ]);
  assertEquals(periods("quarter", "2026-01-01", "2026-10-31").map((span) => span.to), ["2026-03-31", "2026-06-30", "2026-09-30", "2026-10-31"]);
  assertEquals(periods("quarter", "2025-11-01", "2026-02-28").map((span) => span.label), ["רבעון 4 2025", "רבעון 1 2026"]);
  assertEquals(periods("year", "2024-03-01", "2026-10-31").map((span) => [span.from, span.label]), [["2024-03-01", "2024"], ["2025-01-01", "2025"], ["2026-01-01", "2026"]]);
});

Deno.test("a wide grid's PDF pages are A4 landscape; a narrow one stays portrait", async () => {
  const wide = { ...SAMPLE_PNL_GRID, grids: [{ ...grid(SAMPLE_PNL_GRID), columns: Array.from({ length: 10 }, (_, index) => `עמודה ${String(index + 1)}`), rows: grid(SAMPLE_PNL_GRID).rows.map((row) => ({ ...row, cells: Array.from({ length: 10 }, () => row.cells[0] ?? null) })) }] };
  const landscape = await PDFDocument.load(await renderReportPdf({ ...SAMPLE_FILE, parts: [wide] }));
  assert(landscape.getPage(0).getWidth() > landscape.getPage(0).getHeight());
  const portrait = await PDFDocument.load(await renderReportPdf({ ...SAMPLE_FILE, parts: [SAMPLE_QUARTER_GRID] }));
  assertEquals(Math.round(portrait.getPage(0).getWidth()), 595);
  // More than 13 amount columns: a second block, never dropped.
  const wider = { ...wide, grids: [{ ...wide.grids[0]!, columns: Array.from({ length: 20 }, (_, index) => `${String(index + 1)}`), rows: wide.grids[0]!.rows.map((row) => ({ ...row, cells: Array.from({ length: 20 }, () => row.cells[0] ?? null) })) }] };
  assert((await PDFDocument.load(await renderReportPdf({ ...SAMPLE_FILE, parts: [wider] }))).getPageCount() >= 2);
});

async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (view.getUint32(at, true) === 0x04034B50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.slice(at + 30, at + 30 + nameLength));
    const packed = bytes.slice(at + 30 + nameLength, at + 30 + nameLength + size);
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const data = new Uint8Array(await new Response(stream).arrayBuffer());
    assertEquals(crc32(data), view.getUint32(at + 14, true), name);
    files.set(name, new TextDecoder().decode(data));
    at += 30 + nameLength + size;
  }
  return files;
}

Deno.test("the xlsx: a sheet per report and פרטים, right to left, frozen head, SUM formulas and outline groups", async () => {
  const file = { ...SAMPLE_FILE, parts: [SAMPLE_PNL_GRID, SAMPLE_BALANCE_GRID] };
  const files = await unzip(await renderReportXlsx(file));
  assertStringIncludes(files.get("xl/workbook.xml") ?? "", 'name="רווח והפסד"');
  assertStringIncludes(files.get("xl/workbook.xml") ?? "", 'name="מאזן"');
  assertStringIncludes(files.get("xl/workbook.xml") ?? "", 'name="פרטים"');
  const pnl = files.get("xl/worksheets/sheet1.xml") ?? "";
  assertStringIncludes(pnl, 'rightToLeft="1"');
  assertStringIncludes(pnl, 'state="frozen"');
  assertStringIncludes(pnl, 'outlineLevel="1"');
  assertStringIncludes(pnl, "<f>SUM(B");
  assertStringIncludes(pnl, "<v>29000.00</v>");
  const details = files.get("xl/worksheets/sheet3.xml") ?? "";
  assertStringIncludes(details, "נכסי הדוגמה");
  assertEquals(workbookSheets(file).map((sheet) => sheet.name), ["רווח והפסד", "מאזן", "פרטים"]);
  assertEquals([columnName(0), columnName(25), columnName(26)], ["A", "Z", "AA"]);
});

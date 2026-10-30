// FLOW-992: the reports as an Excel workbook (Reports export design, section "Excel (xlsx)"). A sheet per
// report, right to left: amounts are numbers in the currency's format with cents, every sum is a formula,
// sub-categories sit in an outline group under their category, the head row and the names column are
// frozen, and a "פרטים" sheet says what the file holds. The same grids as the PDF (report_grid.ts). No
// library: the parts are written as text and zipped with the runtime's own deflate.
import type { GridRow, ReportGrid } from "./report_grid.ts";
import { basisLabel, type GridPart, type ReportFile } from "./report_model.ts";

const BY_WORD: Record<GridPart["by"], string> = { total: "", project: " לפי פרויקט", month: " לפי חודש", quarter: " לפי רבעון", year: " לפי שנה" };

/** Text safe inside XML: the five entities escaped, characters XML refuses dropped. */
export function xml(value: string): string {
  return value
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** A column's letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
}

// The number formats: USD and ILS with their sign before the digits and a minus on money out, any other
// currency as a plain number.
const FORMATS: Record<string, number> = { USD: 164, ILS: 165 };
const NUM_FMTS = `<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;\\-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="&quot;₪&quot;#,##0.00;\\-&quot;₪&quot;#,##0.00"/></numFmts>`;
// cellXfs: 0 plain, 1 bold, 2 the head row, 3 a sub-category (indented), 4 the sheet's title, then a plain and
// a bold amount for each format: USD 5 and 6, ILS 7 and 8, other 9 and 10.
const STYLE = { plain: 0, bold: 1, head: 2, child: 3, title: 4 };
function amountStyle(currency: string, bold: boolean): number {
  const base = currency === "USD" ? 5 : currency === "ILS" ? 7 : 9;
  return base + (bold ? 1 : 0);
}
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${NUM_FMTS}<fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="13"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1EEF6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment indent="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="${String(FORMATS.USD)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="${String(FORMATS.USD)}" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="${String(FORMATS.ILS)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="${String(FORMATS.ILS)}" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`;

type Cell = { text: string; style?: number } | { number: bigint; formula?: string; style: number } | null;
type SheetRow = { cells: Cell[]; outline?: boolean };

/** Minor units as the decimal Excel stores: −1234567 → -12345.67. */
function decimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${String(abs / 100n)}.${String(abs % 100n).padStart(2, "0")}`;
}

function cellXml(cell: Cell, ref: string): string {
  if (cell == null) return "";
  if ("text" in cell) return `<c r="${ref}" t="inlineStr"${cell.style ? ` s="${String(cell.style)}"` : ""}><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
  const formula = cell.formula == null ? "" : `<f>${xml(cell.formula)}</f>`;
  return `<c r="${ref}" s="${String(cell.style)}">${formula}<v>${decimal(cell.number)}</v></c>`;
}

/** A formula over rows of one column: SUM of a run, or the rows added and taken away one by one. */
function rowsFormula(column: string, plus: number[], minus: number[]): string {
  const run = minus.length === 0 && plus.length > 1 && plus.every((row, index) => index === 0 || row === (plus[index - 1] ?? 0) + 1);
  if (run) return `SUM(${column}${String(plus[0])}:${column}${String(plus[plus.length - 1])})`;
  const terms = [...plus.map((row) => `${column}${String(row)}`), ...minus.map((row) => `-${column}${String(row)}`)];
  return terms.length === 0 ? "0" : `SUM(${terms.join(",")})`;
}

/** A grid's rows from sheet row `first` on (1-based); the head row is `first`. */
function gridSheetRows(grid: ReportGrid, first: number): SheetRow[] {
  const heads = [...grid.columns, ...(grid.hasTotal ? ["סה״כ"] : [])];
  const out: SheetRow[] = [{ cells: [{ text: "חשבון", style: STYLE.head }, ...heads.map((text) => ({ text, style: STYLE.head }))] }];
  // A grid row's index → its sheet row.
  const at = (index: number) => first + 1 + index;
  const lastColumn = columnName(grid.columns.length);
  grid.rows.forEach((item: GridRow, index) => {
    if (item.kind === "section") {
      out.push({ cells: [{ text: item.label, style: STYLE.bold }] });
      return;
    }
    const bold = item.kind !== "row" && item.kind !== "child";
    const style = amountStyle(grid.currency, bold);
    const cells: Cell[] = [{ text: item.label, style: item.kind === "child" ? STYLE.child : bold ? STYLE.bold : STYLE.plain }];
    item.cells.forEach((value, column) => {
      const letter = columnName(column + 1);
      if (value == null) cells.push(null);
      else if (item.plus != null) cells.push({ number: value, style, formula: rowsFormula(letter, item.plus.map(at), (item.minus ?? []).map(at)) });
      else cells.push({ number: value, style });
    });
    if (grid.hasTotal && item.total != null) {
      const letter = columnName(grid.columns.length + 1);
      const formula = item.cells.some((value) => value != null) && grid.columns.length > 0
        ? `SUM(B${String(at(index))}:${lastColumn}${String(at(index))})`
        : item.plus != null
        ? rowsFormula(letter, item.plus.map(at), (item.minus ?? []).map(at))
        : undefined;
      cells.push({ number: item.total, style, formula });
    }
    out.push({ cells, outline: item.kind === "child" });
  });
  return out;
}

function sheetXml(rows: SheetRow[], frozen: number | null, widths: number[]): string {
  const pane = frozen == null ? "" : `<pane xSplit="1" ySplit="${String(frozen)}" topLeftCell="B${String(frozen + 1)}" activePane="bottomRight" state="frozen"/>`;
  const cols = widths.map((width, index) => `<col min="${String(index + 1)}" max="${String(index + 1)}" width="${String(width)}" customWidth="1"/>`).join("");
  const body = rows.map((row, index) => {
    const ref = index + 1;
    const cells = row.cells.map((cell, column) => cellXml(cell, `${columnName(column)}${String(ref)}`)).join("");
    return `<row r="${String(ref)}"${row.outline ? ` outlineLevel="1"` : ""}>${cells}</row>`;
  }).join("");
  const outlined = rows.some((row) => row.outline);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><outlinePr summaryBelow="0"/></sheetPr><sheetViews><sheetView rightToLeft="1" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"${outlined ? ` outlineLevelRow="1"` : ""}/>${cols === "" ? "" : `<cols>${cols}</cols>`}<sheetData>${body}</sheetData></worksheet>`;
}

type Sheet = { name: string; xml: string };

/** A sheet name Excel takes: no []:*?/\, at most 31 characters, unique in the workbook. */
function sheetName(wanted: string, taken: Set<string>): string {
  const base = [...wanted.replace(/[[\]:*?/\\]/g, " ")].slice(0, 28).join("").trim() || "דוח";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${String(n)}`;
  taken.add(name);
  return name;
}

/** The workbook's sheets: a sheet per grid part, then "פרטים". Only grid parts are written here. */
export function workbookSheets(file: ReportFile): Sheet[] {
  const taken = new Set<string>();
  const sheets: Sheet[] = [];
  const details: SheetRow[] = [
    { cells: [{ text: file.company, style: STYLE.title }] },
    { cells: [{ text: "הופק" }, { text: file.createdAt }] },
    { cells: [{ text: "דוח ניהולי מתוך Flow · לא דוח כספי מבוקר" }] },
    { cells: [] },
  ];
  for (const part of file.parts) {
    if (part.kind !== "grid") continue;
    const title = `${part.report === "pnl" ? "רווח והפסד" : "מאזן"}${BY_WORD[part.by]}`;
    const rows: SheetRow[] = [{ cells: [{ text: `${title} · ${part.when} · ${part.scope}${part.basis == null ? "" : ` · ${basisLabel(part.basis)}`}`, style: STYLE.title }] }, { cells: [] }];
    let frozen: number | null = null;
    let columns = 1;
    for (const grid of part.grids) {
      if (part.grids.length > 1) rows.push({ cells: [{ text: grid.currency, style: STYLE.bold }] });
      frozen ??= rows.length + 1;
      rows.push(...gridSheetRows(grid, rows.length + 1));
      rows.push({ cells: [] });
      columns = Math.max(columns, grid.columns.length + (grid.hasTotal ? 1 : 0));
    }
    if (part.grids.length === 0) rows.push({ cells: [{ text: part.report === "pnl" ? "אין תנועות בתקופה הזאת." : "אין עדיין יתרות עד התאריך הזה." }] });
    sheets.push({ name: sheetName(part.report === "pnl" ? "רווח והפסד" : "מאזן", taken), xml: sheetXml(rows, frozen, [40, ...Array.from({ length: columns }, () => 15)]) });
    details.push({ cells: [{ text: title, style: STYLE.bold }] });
    details.push({ cells: [{ text: part.report === "pnl" ? "תקופה" : "תאריך" }, { text: part.when }] });
    details.push({ cells: [{ text: "פרויקטים" }, { text: part.scope }] });
    if (part.basis != null) details.push({ cells: [{ text: "בסיס" }, { text: basisLabel(part.basis) }] });
    for (const grid of part.grids) for (const note of grid.notes) details.push({ cells: [{ text: "הערה" }, { text: note }] });
    details.push({ cells: [] });
  }
  sheets.push({ name: sheetName("פרטים", taken), xml: sheetXml(details, null, [24, 90]) });
  return sheets;
}

/** The workbook's bytes (an xlsx: a zip of its XML parts). */
export async function renderReportXlsx(file: ReportFile): Promise<Uint8Array> {
  const sheets = workbookSheets(file);
  const parts: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${String(index + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${String(index + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(index + 1)}.xml"/>`).join("")}<Relationship Id="rId${String(sheets.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES],
    ...sheets.map((sheet, index): [string, string] => [`xl/worksheets/sheet${String(index + 1)}.xml`, sheet.xml]),
  ];
  return await zip(parts.map(([name, text]) => ({ name, data: new TextEncoder().encode(text) })));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xFF] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zip of the files, each deflated, names in UTF-8. */
export async function zip(files: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const packed = await deflate(file.data);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    // Signature, version 2.0, flags (bit 11: UTF-8 names), deflate, time and date (1 Jan 1980), crc, sizes, name length.
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 8, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, packed);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014B50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 8, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, packed.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

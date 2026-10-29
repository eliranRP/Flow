// FLOW-162: the report as a PDF (Design canvas, row "the shared PDF", and its build-spec note). A4 portrait,
// Rubik embedded (Hebrew and Latin subsets, 400 and 600), right to left. Every page has the header (business,
// report, period or date, projects, basis, currency, when it was made, page n of N) and the footer. A table's
// head repeats after a page break, a row never splits, and a section heading never ends a page alone.
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "npm:pdf-lib@1.17.1";
import { HEBREW_400, HEBREW_600, LATIN_400, LATIN_600 } from "./report_fonts.ts";
import {
  accountName,
  basisLabel,
  categoryName,
  displayDate,
  marginPercent,
  money,
  periodLabel,
  projectKeyName,
  type BalanceCurrency,
  type BalancePart,
  type PnlPart,
  type ReportFile,
  type StatementCurrency,
  systemAccountName,
} from "./report_model.ts";
import { visualSegments } from "./report_text.ts";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MM = 72 / 25.4;
const SIDE = 18 * MM;
const TOP = 15 * MM;
const BOTTOM = 20 * MM;
const RIGHT = PAGE_W - SIDE;
const LEFT = SIDE;
const INK = rgb(0.1, 0.086, 0.133);
const SECONDARY = rgb(0.31, 0.28, 0.376);
const MUTED = rgb(0.42, 0.39, 0.5);
const RULE = rgb(0.85, 0.83, 0.89);
const BAND = rgb(0.953, 0.941, 0.973);
const ACCENT = rgb(0.353, 0.176, 0.69);

type Weight = 400 | 600;
type Fonts = { hebrew: Record<Weight, PDFFont>; latin: Record<Weight, PDFFont> };
type Ink = ReturnType<typeof rgb>;

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// fontkit lays a run with a Hebrew letter out right to left itself (pdf-lib hands it the whole string), so a
// segment already in visual order goes back to logical order before it is drawn; fontkit turns it again.
export function forFontkit(segment: { text: string }): string {
  return /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(segment.text) ? [...segment.text].reverse().join("") : segment.text;
}

/** The width of a line as drawn. */
function width(fonts: Fonts, value: string, size: number, weight: Weight = 400): number {
  return visualSegments(value).reduce((sum, segment) => sum + fonts[segment.script][weight].widthOfTextAtSize(forFontkit(segment), size), 0);
}

/** Draws a line so it ends at `x` (its right edge), or starts there with align "left". */
function draw(page: PDFPage, fonts: Fonts, value: string, x: number, y: number, size: number, options: { weight?: Weight; color?: Ink; align?: "right" | "left" } = {}) {
  const weight = options.weight ?? 400;
  let cursor = options.align === "left" ? x : x - width(fonts, value, size, weight);
  for (const segment of visualSegments(value)) {
    const font = fonts[segment.script][weight];
    const text = forFontkit(segment);
    page.drawText(text, { x: cursor, y, size, font, color: options.color ?? INK });
    cursor += font.widthOfTextAtSize(text, size);
  }
}

/** Shortens a line with "…" until it fits. */
function fit(fonts: Fonts, value: string, size: number, max: number, weight: Weight = 400): string {
  if (width(fonts, value, size, weight) <= max) return value;
  let chars = [...value];
  while (chars.length > 1 && width(fonts, `${chars.join("")}…`, size, weight) > max) chars = chars.slice(0, -1);
  return `${chars.join("")}…`;
}

type Head = { title: string; meta: string; footer: string };

/** Lays pages out top to bottom; the header and footer are drawn last, once the page count is known. */
class Layout {
  readonly pages: { page: PDFPage; head: Head }[] = [];
  page!: PDFPage;
  y = 0;
  private head!: Head;
  private repeat: (() => void) | null = null;
  constructor(private readonly doc: PDFDocument, readonly fonts: Fonts) {}

  start(head: Head) {
    this.head = head;
    this.repeat = null;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push({ page: this.page, head: this.head });
    this.y = PAGE_H - TOP - 70;
    this.repeat?.();
  }

  /** Room for `height` more points, else a new page (with the table's head again). */
  need(height: number) {
    if (this.y - height < BOTTOM + 24) this.newPage();
  }

  /** A table's head, drawn now and again at the top of every page the table runs onto. */
  tableHead(draw: () => void) {
    // Drawn before it is set to repeat: a break inside draw() must not draw the head twice.
    this.repeat = null;
    draw();
    this.repeat = draw;
  }

  endTable() {
    this.repeat = null;
  }

  finish(company: string, createdAt: string) {
    const total = this.pages.length;
    this.pages.forEach(({ page, head }, index) => {
      const top = PAGE_H - TOP;
      draw(page, this.fonts, fit(this.fonts, company, 9, RIGHT - LEFT - 60), RIGHT, top - 10, 9, { color: SECONDARY });
      draw(page, this.fonts, head.title, RIGHT, top - 32, 18, { weight: 600 });
      draw(page, this.fonts, fit(this.fonts, head.meta, 9, RIGHT - LEFT), RIGHT, top - 48, 9, { color: SECONDARY });
      draw(page, this.fonts, "Flow", LEFT, top - 10, 11, { weight: 600, color: ACCENT, align: "left" });
      draw(page, this.fonts, `הופק ב־${createdAt}`, LEFT + width(this.fonts, `הופק ב־${createdAt}`, 8), top - 24, 8, { color: MUTED });
      const pageWords = `עמוד ${String(index + 1)} מתוך ${String(total)}`;
      draw(page, this.fonts, pageWords, LEFT + width(this.fonts, pageWords, 8), top - 36, 8, { color: MUTED });
      page.drawLine({ start: { x: LEFT, y: top - 58 }, end: { x: RIGHT, y: top - 58 }, thickness: 1.5, color: ACCENT });
      page.drawLine({ start: { x: LEFT, y: BOTTOM }, end: { x: RIGHT, y: BOTTOM }, thickness: 0.5, color: RULE });
      const note = "דוח ניהולי מתוך Flow · לא דוח כספי מבוקר";
      // The footer and the note share a line: the footer is cut short before it reaches the note.
      draw(page, this.fonts, fit(this.fonts, head.footer, 7.5, RIGHT - LEFT - width(this.fonts, note, 7.5) - 12), RIGHT, BOTTOM - 12, 7.5, { color: MUTED });
      draw(page, this.fonts, note, LEFT + width(this.fonts, note, 7.5), BOTTOM - 12, 7.5, { color: MUTED });
    });
  }
}

const KEEP_WITH_TABLE = 52 + 27 + 22 + 17;

/** Four boxes across the page: the first, on the right, is the lead figure. */
function boxes(layout: Layout, items: { label: string; value: string }[]) {
  // The boxes keep with the table under them: their 52, a two-line column head, a heading and one row.
  layout.need(KEEP_WITH_TABLE);
  const gap = 6;
  const boxW = (RIGHT - LEFT - gap * (items.length - 1)) / items.length;
  const top = layout.y;
  items.forEach((item, index) => {
    const xRight = RIGHT - index * (boxW + gap);
    layout.page.drawRectangle({ x: xRight - boxW, y: top - 40, width: boxW, height: 40, color: BAND });
    draw(layout.page, layout.fonts, item.label, xRight - 8, top - 14, 8, { color: SECONDARY });
    draw(layout.page, layout.fonts, fit(layout.fonts, item.value, index === 0 ? 13 : 11, boxW - 16, 600), xRight - 8, top - 32, index === 0 ? 13 : 11, { weight: 600 });
  });
  layout.y = top - 52;
}

type Column = { right: number; header: string; max?: number };

/** A table row: the label on the right, then one cell per column (amounts end at their column's right edge). */
function row(layout: Layout, label: string, cells: string[], columns: Column[], options: { kind?: "row" | "child" | "sub" | "total" | "note"; height?: number } = {}) {
  const kind = options.kind ?? "row";
  const height = options.height ?? (kind === "total" ? 22 : 17);
  layout.need(height);
  const page = layout.page;
  const base = layout.y - height + 5;
  const weight: Weight = kind === "sub" || kind === "total" ? 600 : 400;
  const size = kind === "total" ? 11 : 9;
  if (kind === "sub") page.drawLine({ start: { x: LEFT, y: layout.y }, end: { x: RIGHT, y: layout.y }, thickness: 0.5, color: RULE });
  if (kind === "total") {
    page.drawLine({ start: { x: LEFT, y: layout.y }, end: { x: RIGHT, y: layout.y }, thickness: 1.2, color: INK });
    page.drawLine({ start: { x: LEFT, y: layout.y - height }, end: { x: RIGHT, y: layout.y - height }, thickness: 1.2, color: INK });
  }
  const firstCell = columns[0]?.right ?? LEFT;
  const labelMax = RIGHT - firstCell - 70 - (kind === "child" ? 14 : 0);
  draw(page, layout.fonts, fit(layout.fonts, label, size, labelMax, weight), RIGHT - (kind === "child" ? 14 : 0), base, size, { weight, color: kind === "note" ? SECONDARY : INK });
  cells.forEach((cell, index) => {
    const column = columns[index];
    if (column != null && cell !== "") draw(page, layout.fonts, cell, column.right, base, size, { weight });
  });
  layout.y -= height;
}

function sectionHeading(layout: Layout, title: string) {
  // A heading never sits alone at the bottom of a page: it needs room for one row under it.
  layout.need(22 + 17);
  draw(layout.page, layout.fonts, title, RIGHT, layout.y - 15, 10, { weight: 600 });
  layout.y -= 22;
}

/** A header in at most two lines of `max` width, the second shortened with "…" if it still runs over. */
function headLines(fonts: Fonts, value: string, max: number): string[] {
  if (width(fonts, value, 7.5, 600) <= max) return [value];
  const words = value.split(" ");
  let first = words[0] ?? "";
  let index = 1;
  while (index < words.length && width(fonts, `${first} ${words[index] ?? ""}`, 7.5, 600) <= max) first = `${first} ${words[index++] ?? ""}`;
  const rest = words.slice(index).join(" ");
  return rest === "" ? [fit(fonts, first, 7.5, max, 600)] : [fit(fonts, first, 7.5, max, 600), fit(fonts, rest, 7.5, max, 600)];
}

function columnHeads(layout: Layout, columns: Column[]) {
  const lines = columns.map((column) => (column.max == null ? [column.header] : headLines(layout.fonts, column.header, column.max)));
  const height = lines.some((item) => item.length > 1) ? 27 : 18;
  layout.need(height);
  columns.forEach((column, index) => {
    (lines[index] ?? []).forEach((line, at) => {
      draw(layout.page, layout.fonts, line, column.right, layout.y - 12 - at * 9, 7.5, { weight: 600, color: MUTED });
    });
  });
  layout.page.drawLine({ start: { x: LEFT, y: layout.y - height + 2 }, end: { x: RIGHT, y: layout.y - height + 2 }, thickness: 0.5, color: RULE });
  layout.y -= height;
}

/** A whole percent with the amounts' minus sign: −44%. */
export function percent(value: number): string {
  return `${value < 0 ? "−" : ""}${String(Math.abs(value))}%`;
}

function percentOf(part: bigint, whole: bigint): string {
  return whole <= 0n ? "" : percent(Math.round((Number(part) * 100) / Number(whole)));
}

function statementBlock(layout: Layout, row0: StatementCurrency, expand: boolean) {
  const columns: Column[] = [{ right: LEFT + 150, header: "סכום" }, { right: LEFT + 50, header: "% מההכנסות" }];
  layout.tableHead(() => { columnHeads(layout, columns); });
  const money0 = (value: bigint) => money(value, row0.currency);
  const side = (title: string, total: string, nodes: StatementCurrency["income"], sign: 1n | -1n, totalLabel: string) => {
    if (nodes.length === 0) return;
    sectionHeading(layout, title);
    for (const node of nodes) {
      const shown = node.children.length > 0 && expand;
      row(layout, categoryName(node.name), [money0(sign * node.amount_minor), percentOf(node.amount_minor, row0.income_minor)], columns, { kind: shown ? "sub" : "row" });
      if (!shown) continue;
      if (node.own_minor !== 0n) row(layout, `${categoryName(node.name)} · ישירות`, [money0(sign * node.own_minor), ""], columns, { kind: "child" });
      for (const item of node.children) row(layout, categoryName(item.name), [money0(sign * item.amount_minor), percentOf(item.amount_minor, row0.income_minor)], columns, { kind: "child" });
    }
    row(layout, totalLabel, [total, percentOf(sign === 1n ? row0.income_minor : row0.expense_minor, row0.income_minor)], columns, { kind: "sub" });
  };
  side("הכנסות", money0(row0.income_minor), row0.income, 1n, "סה״כ הכנסות");
  side("הוצאות", money0(-row0.expense_minor), row0.expense, -1n, "סה״כ הוצאות");
  row(layout, "רווח נקי", [money0(row0.net_minor), percentOf(row0.net_minor, row0.income_minor)], columns, { kind: "total" });
  layout.endTable();
  if (row0.kept_out.length > 0) {
    layout.y -= 8;
    sectionHeading(layout, "לא נספר ברווח (במאזן)");
    for (const item of row0.kept_out) {
      const accountText = item.account_name == null ? null : systemAccountName(item.account_name);
      const account = accountText == null || accountText === categoryName(item.name) ? "" : ` · ${accountText}`;
      row(layout, `${categoryName(item.name)}${account}`, [money0(item.direction === "income" ? item.amount_minor : -item.amount_minor)], columns, { kind: "note" });
    }
  }
}

function pnlPages(layout: Layout, part: PnlPart) {
  const statement = part.statement;
  const scope = statement.project_name ?? (part.byProject ? "לפי פרויקט" : "כל הפרויקטים");
  const currencies = statement.currencies.map((row0) => row0.currency).join(", ") || "—";
  const meta = `${periodLabel(statement)} · ${scope} · ${basisLabel(statement.basis)} · ${currencies}`;
  layout.start({ title: part.byProject ? "רווח והפסד לפי פרויקט" : "רווח והפסד", meta, footer: `רווח והפסד · ${periodLabel(statement)} · ${scope}` });
  if (statement.currencies.length === 0) {
    draw(layout.page, layout.fonts, "אין תנועות בתקופה הזאת.", RIGHT, layout.y - 20, 10, { color: SECONDARY });
    layout.y -= 30;
    return;
  }
  statement.currencies.forEach((row0, index) => {
    if (index > 0) {
      layout.need(30 + KEEP_WITH_TABLE);
      layout.y -= 10;
      draw(layout.page, layout.fonts, `ב־${row0.currency}`, RIGHT, layout.y - 12, 12, { weight: 600 });
      layout.y -= 20;
    }
    const margin = marginPercent(row0);
    boxes(layout, [
      { label: "רווח נקי", value: money(row0.net_minor, row0.currency) },
      { label: "הכנסות", value: money(row0.income_minor, row0.currency) },
      { label: "הוצאות", value: money(-row0.expense_minor, row0.currency) },
      { label: "מההכנסות", value: margin == null ? "—" : percent(margin) },
    ]);
    if (part.byProject && statement.projects.length > 0) projectTable(layout, part, row0.currency);
    else statementBlock(layout, row0, part.expand);
  });
  const notes: string[] = ["קרן, פיקדון מסים וביטוח וקניית נכסים לא נספרים ברווח; הם במאזן."];
  if (statement.review_count > 0) notes.push(`${String(statement.review_count)} תנועות ממתינות לבדיקה בתקופה ולא נכללו.`);
  for (const note of notes) {
    layout.need(14);
    draw(layout.page, layout.fonts, note, RIGHT, layout.y - 12, 7.5, { color: SECONDARY });
    layout.y -= 14;
  }
}

/** By project: up to four project columns and the total per page width; more projects take more blocks. */
function projectTable(layout: Layout, part: PnlPart, currency: string) {
  // A project with no lines in this currency has no column in its block.
  const projects = part.statement.projects.filter((project) => project.currencies.some((row0) => row0.currency === currency));
  const company = part.statement.currencies.find((row0) => row0.currency === currency);
  const perBlock = 4;
  for (let start = 0; start < projects.length; start += perBlock) {
    const block = projects.slice(start, start + perBlock);
    const last = start + perBlock >= projects.length;
    const count = block.length + (last ? 1 : 0);
    const columnW = (RIGHT - LEFT - 130) / count;
    const columns: Column[] = Array.from({ length: count }, (_, index) => {
      const project = block[index];
      return { right: RIGHT - 130 - index * columnW, header: project == null ? "סה״כ" : projectKeyName(project), max: columnW - 6 };
    });
    const cell = (pick: (row0: StatementCurrency) => bigint) => [
      ...block.map((project) => {
        const row0 = project.currencies.find((item) => item.currency === currency);
        return row0 == null ? "—" : money(pick(row0), currency);
      }),
      ...(last && company != null ? [money(pick(company), currency)] : []),
    ];
    layout.tableHead(() => { columnHeads(layout, columns); });
    row(layout, "הכנסות", cell((row0) => row0.income_minor), columns);
    row(layout, "הוצאות", cell((row0) => -row0.expense_minor), columns);
    row(layout, "רווח נקי", cell((row0) => row0.net_minor), columns, { kind: "total" });
    layout.endTable();
    layout.y -= 10;
  }
}

function balanceBlock(layout: Layout, row0: BalanceCurrency) {
  const equity = row0.equity.total_minor + row0.retained_earnings_minor;
  const suspense = row0.warnings.reduce((sum, warning) => sum + (warning.balance_minor < 0n ? -warning.balance_minor : warning.balance_minor), 0n);
  boxes(layout, [
    { label: "הון עצמי", value: money(equity, row0.currency) },
    { label: "נכסים", value: money(row0.assets.total_minor, row0.currency) },
    { label: "התחייבויות", value: money(row0.liabilities.total_minor, row0.currency) },
    { label: "חשבון מעבר", value: money(suspense, row0.currency) },
  ]);
  const columns: Column[] = [{ right: LEFT + 150, header: "יתרה" }];
  layout.tableHead(() => { columnHeads(layout, columns); });
  const side = (title: string, accounts: BalanceCurrency["assets"]["accounts"], total: bigint, extra?: [string, bigint]) => {
    sectionHeading(layout, title);
    for (const account of accounts) row(layout, accountName(account), [money(account.balance_minor, row0.currency)], columns);
    if (extra != null && extra[1] !== 0n) row(layout, extra[0], [money(extra[1], row0.currency)], columns);
    row(layout, `סה״כ ${title}`, [money(total, row0.currency)], columns, { kind: "sub" });
  };
  side("נכסים", row0.assets.accounts, row0.assets.total_minor);
  side("התחייבויות", row0.liabilities.accounts, row0.liabilities.total_minor);
  side("הון", row0.equity.accounts, equity, ["רווח שנצבר", row0.retained_earnings_minor]);
  row(layout, "התחייבויות והון", [money(row0.total_liabilities_and_equity_minor, row0.currency)], columns, { kind: "total" });
  layout.endTable();
  layout.need(16);
  const check = row0.balanced && row0.warnings.length === 0
    ? "מאוזן · נכסים = התחייבויות + הון"
    : row0.balanced
    ? `מאוזן, עם ${money(suspense, row0.currency)} בחשבון מעבר: יש קטגוריות שלא קשורות לחשבון במאזן`
    : "לא מאוזן: כדאי לבדוק את הספרים";
  draw(layout.page, layout.fonts, check, RIGHT, layout.y - 14, 9, { weight: 600 });
  layout.y -= 22;
}

function balancePages(layout: Layout, part: BalancePart) {
  const sheet = part.sheet;
  const scope = sheet.project_name ?? "כל הפרויקטים";
  const currencies = sheet.currencies.map((row0) => row0.currency).join(", ") || "—";
  const date = displayDate(sheet.as_of);
  layout.start({ title: "מאזן", meta: `נכון ל־${date} · ${scope} · ${currencies}`, footer: `מאזן · ${date} · ${scope}` });
  if (sheet.currencies.length === 0) {
    draw(layout.page, layout.fonts, "אין עדיין יתרות עד התאריך הזה.", RIGHT, layout.y - 20, 10, { color: SECONDARY });
    layout.y -= 30;
    return;
  }
  sheet.currencies.forEach((row0, index) => {
    if (index > 0) {
      layout.need(30 + KEEP_WITH_TABLE);
      layout.y -= 10;
      draw(layout.page, layout.fonts, `ב־${row0.currency}`, RIGHT, layout.y - 12, 12, { weight: 600 });
      layout.y -= 20;
    }
    balanceBlock(layout, row0);
  });
}

/** The PDF's bytes: one report after another, each starting on its own page. */
export async function renderReportPdf(file: ReportFile): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embed = (base64: string) => doc.embedFont(bytes(base64), { subset: true });
  const fonts: Fonts = {
    hebrew: { 400: await embed(HEBREW_400), 600: await embed(HEBREW_600) },
    latin: { 400: await embed(LATIN_400), 600: await embed(LATIN_600) },
  };
  const layout = new Layout(doc, fonts);
  for (const part of file.parts) {
    if (part.kind === "pnl") pnlPages(layout, part);
    else balancePages(layout, part);
  }
  layout.finish(file.company, file.createdAt);
  const title = file.parts.map((part) => (part.kind === "pnl" ? "רווח והפסד" : "מאזן")).join(" ו");
  doc.setTitle(`${title} · ${file.company}`);
  doc.setAuthor("Flow");
  doc.setCreator("Flow");
  doc.setProducer("Flow");
  doc.setLanguage("he");
  return await doc.save();
}

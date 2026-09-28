import { formatDayMonthYear } from "./dates.ts";

export interface LedgerCsvRow {
  doc_date: string;
  direction: string;
  description: string;
  project_name: string | null;
  category_name: string | null;
  amount_net: number;
  vat_amount: number;
  amount_gross: number;
}

function cell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function shekel(agorot: number): string {
  return (agorot / 100).toFixed(2);
}

/** Excel-friendly CSV. A leading BOM keeps Hebrew headers in Excel. */
export function ledgerToCsv(rows: LedgerCsvRow[]): string {
  const header = ["תאריך", "סוג", "תיאור", "פרויקט", "קטגוריה", "נטו", 'מע"מ', "ברוטו"];
  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        formatDayMonthYear(row.doc_date.slice(0, 10)),
        row.direction === "income" ? "הכנסה" : "הוצאה",
        row.description,
        row.project_name ?? "",
        row.category_name ?? "",
        shekel(row.amount_net),
        shekel(row.vat_amount),
        shekel(row.amount_gross),
      ]
        .map(cell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

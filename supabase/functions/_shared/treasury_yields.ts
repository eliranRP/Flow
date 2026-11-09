// FLOW-1119: the US Treasury's daily par yield curve, for the member share report's expected rate.
// The flow-treasury-yields job (every four hours; mercury-sync, kind "treasury-yields") reads this year's and last year's CSV and stores
// each trading day's 5 and 10 year yields with store_treasury_yields. A yield the owner typed lives in
// the company's own setting and always wins over these.

export type TreasuryYield = { on_date: string; y5_ppm: number | null; y10_ppm: number | null };

const FEED = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv";

/** The CSV of one year's daily par yield curve. */
export function treasuryCsvUrl(year: number): string {
  return `${FEED}/${String(year)}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${String(year)}&page&_format=csv`;
}

/** A percent written with up to four decimals ("4.38") in parts per million (43800); null when not a percent. */
export function percentToPpm(text: string | undefined): number | null {
  const value = (text ?? "").trim().replace(/^"|"$/g, "");
  const match = /^(\d{1,2})(?:\.(\d{1,4}))?$/.exec(value);
  if (match == null) return null;
  return Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0"));
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

/** Each day of the CSV with its 5 and 10 year yields; days with neither are left out. */
export function parseTreasuryCsv(text: string): TreasuryYield[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines.shift();
  if (header == null) return [];
  const columns = splitCsvLine(header);
  const dateAt = columns.indexOf("Date");
  const fiveAt = columns.indexOf("5 Yr");
  const tenAt = columns.indexOf("10 Yr");
  if (dateAt < 0 || fiveAt < 0 || tenAt < 0) throw new Error("treasury csv: missing a column");
  const rows: TreasuryYield[] = [];
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cells[dateAt] ?? "");
    if (date == null) continue;
    const y5 = percentToPpm(cells[fiveAt]);
    const y10 = percentToPpm(cells[tenAt]);
    if (y5 == null && y10 == null) continue;
    rows.push({ on_date: `${date[3]}-${date[1]}-${date[2]}`, y5_ppm: y5, y10_ppm: y10 });
  }
  return rows;
}

type StoreRpc = (fn: "store_treasury_yields", args: { p_rows: TreasuryYield[] }) => PromiseLike<{ data: unknown; error: unknown }>;

/** Reads this year's and last year's yields and stores them. Returns how many days each year gave. */
export async function refreshTreasuryYields(
  rpc: StoreRpc,
  fetchFn: typeof fetch = fetch,
  today: Date = new Date(),
): Promise<{ stored: number; years: Record<string, number> }> {
  const year = today.getUTCFullYear();
  const years: Record<string, number> = {};
  const rows: TreasuryYield[] = [];
  for (const y of [year - 1, year]) {
    const res = await fetchFn(treasuryCsvUrl(y), { headers: { accept: "text/csv" } });
    if (!res.ok) throw new Error(`treasury csv ${String(y)}: http ${String(res.status)}`);
    const parsed = parseTreasuryCsv(await res.text());
    years[String(y)] = parsed.length;
    rows.push(...parsed);
  }
  if (rows.length === 0) return { stored: 0, years };
  const { error } = await rpc("store_treasury_yields", { p_rows: rows });
  if (error) throw new Error("treasury yields: the store failed");
  return { stored: rows.length, years };
}

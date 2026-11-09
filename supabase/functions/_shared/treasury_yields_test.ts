// FLOW-1119: the Treasury's daily par yield curve CSV, parsed and stored. The sample rows are the
// feed's own format (public market data), trimmed to a few days.
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { parseTreasuryCsv, percentToPpm, refreshTreasuryYields, treasuryCsvUrl, type TreasuryYield } from "./treasury_yields.ts";

const CSV = [
  `Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"`,
  "11/06/2026,4.02,4.07,4.15,4.19,4.19,4.23,4.33,4.51,4.59,4.64,4.74,4.86,5.29,5.26",
  "11/05/2026,4.03,4.07,4.15,4.17,4.16,4.19,4.28,4.46,4.53,4.59,4.70,4.84,5.27,5.25",
  "11/04/2026,4.01,4.08,4.15,4.21,4.20,4.25,4.39,4.58,4.64,4.69,4.77,,5.30,5.28",
  "11/03/2026,,,,,,,,,,,,,,",
  "",
].join("\r\n");

Deno.test("the CSV gives each day's 5 and 10 year yields in ppm", () => {
  assertEquals(parseTreasuryCsv(CSV), [
    { on_date: "2026-11-06", y5_ppm: 46400, y10_ppm: 48600 },
    { on_date: "2026-11-05", y5_ppm: 45900, y10_ppm: 48400 },
    { on_date: "2026-11-04", y5_ppm: 46900, y10_ppm: null },
  ]);
});

Deno.test("percents convert without floating point", () => {
  assertEquals(percentToPpm("4.38"), 43800);
  assertEquals(percentToPpm("4.1"), 41000);
  assertEquals(percentToPpm("0.0525"), 525);
  assertEquals(percentToPpm("5"), 50000);
  assertEquals(percentToPpm(""), null);
  assertEquals(percentToPpm("N/A"), null);
});

Deno.test("a CSV without the columns is refused, an empty one is no days", () => {
  assertThrows(() => parseTreasuryCsv("Date,\"1 Mo\"\n11/06/2026,4.02"));
  assertEquals(parseTreasuryCsv(""), []);
});

Deno.test("refresh reads last year's and this year's CSV and stores the days once", async () => {
  const urls: string[] = [];
  const stored: TreasuryYield[][] = [];
  const fetchFn = ((url: string) => {
    urls.push(url);
    return Promise.resolve(new Response(url.includes("/2026/") ? CSV : "Date,\"5 Yr\",\"10 Yr\"\n12/31/2025,4.10,4.40\n"));
  }) as typeof fetch;
  const rpc = (_fn: "store_treasury_yields", args: { p_rows: TreasuryYield[] }) => {
    stored.push(args.p_rows);
    return Promise.resolve({ data: 4, error: null });
  };
  const result = await refreshTreasuryYields(rpc, fetchFn, new Date("2026-11-09T23:17:00Z"));
  assertEquals(urls, [treasuryCsvUrl(2025), treasuryCsvUrl(2026)]);
  assertEquals(result, { stored: 4, years: { "2025": 1, "2026": 3 } });
  assertEquals(stored[0]?.[0], { on_date: "2025-12-31", y5_ppm: 41000, y10_ppm: 44000 });
});

Deno.test("a failed download or store is an error, and nothing is stored on a failed download", async () => {
  let calls = 0;
  const rpc = () => { calls += 1; return Promise.resolve({ data: null, error: { message: "x" } }); };
  await assertRejects(() => refreshTreasuryYields(rpc, (() => Promise.resolve(new Response("", { status: 503 }))) as typeof fetch));
  assertEquals(calls, 0);
  await assertRejects(() => refreshTreasuryYields(rpc, (() => Promise.resolve(new Response(CSV))) as typeof fetch));
  assertEquals(calls, 1);
});

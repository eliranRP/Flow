import { parseImportFrom, saveImportFrom } from "./import-from.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

Deno.test("parseImportFrom keeps a date, null and absent, and rejects the rest", () => {
  assertEquals(parseImportFrom("2026-01-01"), "2026-01-01");
  assertEquals(parseImportFrom(null), null);
  assertEquals(parseImportFrom(undefined) === undefined, true);
  assertEquals(parseImportFrom("2026-02-30"), false);
  assertEquals(parseImportFrom("2026-1-1"), false);
  assertEquals(parseImportFrom("2026-01-01T00:00:00Z"), false);
  assertEquals(parseImportFrom(20260101), false);
  assertEquals(parseImportFrom(""), false);
});

function recorder(result: { error: unknown } | Error) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      rpc(name: "set_import_from", args: { p_provider: string; p_from: string | null }) {
        calls.push([name, args]);
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    },
  };
}

Deno.test("saveImportFrom calls set_import_from with the date or null", async () => {
  const dated = recorder({ error: null });
  assertEquals(await saveImportFrom(dated.client, "mercury", "2026-01-01"), true);
  assertEquals(dated.calls, [["set_import_from", { p_provider: "mercury", p_from: "2026-01-01" }]]);
  const start = recorder({ error: null });
  assertEquals(await saveImportFrom(start.client, "sumit", null), true);
  assertEquals(start.calls, [["set_import_from", { p_provider: "sumit", p_from: null }]]);
});

Deno.test("saveImportFrom skips an absent date and reports a failed save", async () => {
  const skipped = recorder({ error: null });
  assertEquals(await saveImportFrom(skipped.client, "mercury", undefined) === undefined, true);
  assertEquals(skipped.calls.length, 0);
  assertEquals(await saveImportFrom(recorder({ error: { message: "import date is after today" } }).client, "sumit", "2099-01-01"), false);
  assertEquals(await saveImportFrom(recorder(new Error("network")).client, "mercury", "2026-01-01"), false);
});

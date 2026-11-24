import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { UnpaidRow } from "./dashboard.ts";
import type { ExpectedMonths } from "./forecast.ts";
import { buildLoanSchedule, LoanScheduleError, type LoanScheduleRow, type LoanTerms } from "./loan-schedule.ts";
import { buildMonthForecast, type ForecastItem } from "./month-forecast.ts";

/**
 * FLOW-1305: the shared vectors (packages/shared/fixtures/vectors, format in its README). Each
 * `{ name, input, expected }` runs through the TypeScript builder here; the database cores run the same
 * files through the pgTAP tests that scripts/vectors-sql.mjs writes once a core exists.
 */
const vectorsDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/vectors");

type Vector = { name: string; description?: string; input: Record<string, unknown>; expected: Record<string, unknown> };

function load(builder: string): Vector[] {
  const dir = join(vectorsDir, builder);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const vector = JSON.parse(readFileSync(join(dir, file), "utf8")) as Vector;
      expect(file, "the file is named after the vector").toBe(`${vector.name}.json`);
      return vector;
    });
}

/** Every amount in a vector is an integer JSON number inside 2^53 - 1, so a database reads it exactly. */
const amountKey = /(_minor|Minor|_agorot)$/;
function expectSafeAmounts(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) expectSafeAmounts(entry, `${path}[${String(index)}]`);
  } else if (value != null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (amountKey.test(key) && typeof entry === "number") {
        expect(Number.isSafeInteger(entry), `${path}.${key} is a safe integer`).toBe(true);
      }
      expectSafeAmounts(entry, `${path}.${key}`);
    }
  }
}

describe("shared vectors: month-forecast", () => {
  const vectors = load("month-forecast");
  const big = (value: unknown) => BigInt(value as number);

  /** The builder takes bigint for the party and invoice amounts; the JSON holds them as numbers. */
  function buildInput(input: Record<string, unknown>): Parameters<typeof buildMonthForecast>[0] {
    const expected = input.expected as { recurring: Record<string, unknown>[] };
    const recurring = expected.recurring.map((party) => {
      const handover = party.handover as Record<string, unknown> | null | undefined;
      return {
        ...party,
        typical_amount_minor: big(party.typical_amount_minor),
        ...(handover == null ? {} : { handover: { ...handover, amount_minor: big(handover.amount_minor) } }),
      };
    });
    const unpaid = (input.unpaid as Record<string, unknown>[]).map((row) => ({
      ...row,
      open_gross_agorot: big(row.open_gross_agorot),
      open_net_agorot: big(row.open_net_agorot),
    }));
    return { ...input, expected: { ...expected, recurring } as unknown as ExpectedMonths, unpaid: unpaid as unknown as UnpaidRow[] } as unknown as Parameters<typeof buildMonthForecast>[0];
  }

  const wire = (item: ForecastItem) => ({ ...item, usual: Number(item.usual), minor: Number(item.minor) });

  it("has the cases the task names", () => {
    const names = vectors.map((vector) => vector.name);
    for (const part of ["split-party", "handover", "ended-charge", "quarter-charge-in", "quarter-charge-next", "edit-add", "edit-change", "edit-remove", "2-pow-53"]) {
      expect(names.some((name) => name.includes(part)), part).toBe(true);
    }
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    expectSafeAmounts(vector, vector.name);
    const build = buildMonthForecast(buildInput(vector.input));
    const keys = (list: readonly ForecastItem[]) => list.map((item) => item.key);
    expect({
      items: build.items.map(wire),
      income: keys(build.income),
      expense: keys(build.expense),
      moved: keys(build.moved),
      small: keys(build.small),
      incomeTotal: Number(build.incomeTotal),
      expenseTotal: Number(build.expenseTotal),
      changed: build.changed,
    }).toEqual(vector.expected);
  });
});

describe("shared vectors: loan-schedule", () => {
  const vectors = load("loan-schedule");

  function terms(input: Record<string, unknown>): LoanTerms {
    return {
      ...input,
      principalMinor: BigInt(input.principalMinor as number),
      paymentMinor: BigInt(input.paymentMinor as number),
      escrowMinor: BigInt(input.escrowMinor as number),
    } as unknown as LoanTerms;
  }

  const wireRow = (row: LoanScheduleRow) => ({
    period: row.period,
    dueDate: row.dueDate,
    interestMinor: Number(row.interestMinor),
    escrowMinor: Number(row.escrowMinor),
    principalMinor: Number(row.principalMinor),
    paymentMinor: Number(row.paymentMinor),
    balanceMinor: Number(row.balanceMinor),
  });

  it("has every refusal code and a balloon, an adjustment, a rate change and each kind", () => {
    const text = vectors.map((vector) => JSON.stringify(vector.expected) + JSON.stringify(vector.input)).join("\n");
    for (const code of ["principal", "rate", "term", "payment", "escrow", "start_date", "payment_below_interest", "kind", "interest_only_months", "amortization_months", "rate_date"]) {
      expect(text, code).toContain(`"error":"${code}"`);
    }
    for (const part of ['"balloon":{', '"finalAdjustment":{', '"rates":[{', '"kind":"interest_only"', '"kind":"balloon"']) {
      expect(text, part).toContain(part);
    }
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    expectSafeAmounts(vector, vector.name);
    const refused = typeof vector.expected.error === "string";
    if (refused) {
      let code: string | null = null;
      try {
        buildLoanSchedule(terms(vector.input));
      } catch (error) {
        expect(error).toBeInstanceOf(LoanScheduleError);
        code = (error as LoanScheduleError).code;
      }
      expect({ error: code }).toEqual(vector.expected);
      return;
    }
    const schedule = buildLoanSchedule(terms(vector.input));
    expect({
      rows: schedule.rows.map(wireRow),
      balloon: schedule.balloon == null ? null : { amountMinor: Number(schedule.balloon.amountMinor), ratioToPayment: schedule.balloon.ratioToPayment },
      finalAdjustment: schedule.finalAdjustment == null ? null : { amountMinor: Number(schedule.finalAdjustment.amountMinor) },
    }).toEqual(vector.expected);
  });
});

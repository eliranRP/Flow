import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  CONNECTOR_COPY_KEYS,
  CONNECTOR_ERROR_CLASSES,
  MERCURY_CAPABILITIES,
  PROVIDERS,
  SUMIT_CAPABILITIES,
  parseCanonicalLine,
  type CanonicalLine,
} from "./types.ts";

function line(overrides: Partial<CanonicalLine> = {}): CanonicalLine {
  return {
    source: "mercury",
    external_id: "txn_1",
    direction: "expense",
    status: "posted",
    currency: "USD",
    amount_original: 1250,
    doc_date: "2026-10-03",
    cash_date: "2026-10-03",
    counterparty: { name: "Hardware", external_id: "cp_1" },
    description: "screws",
    vat: { amount: 0, status: "source" },
    project_hint: null,
    category_hint: null,
    linked_external_id: null,
    provider_meta: { kind: "creditCardTransaction" },
    ...overrides,
  };
}

Deno.test("a posted Mercury line parses", () => {
  assertEquals(parseCanonicalLine(line()), line());
});

Deno.test("a pending line may omit the cash date", () => {
  const pending = line({ status: "pending", cash_date: null, amount_original: 0 });
  assertEquals(parseCanonicalLine(pending).status, "pending");
});

Deno.test("a SUMIT line keeps an ILS amount and a project hint", () => {
  const sumit = line({
    source: "sumit",
    currency: "ILS",
    amount_original: 11800,
    vat: { amount: 1800, status: "source" },
    project_hint: "foundation",
    provider_meta: {},
  });
  assertEquals(parseCanonicalLine(sumit).project_hint, "foundation");
});

Deno.test("amount_original rejects floats and negatives", () => {
  assertThrows(() => parseCanonicalLine(line({ amount_original: 1.5 })));
  assertThrows(() => parseCanonicalLine(line({ amount_original: -1 })));
});

Deno.test("currency, status, and extra keys are refused", () => {
  assertThrows(() => parseCanonicalLine(line({ currency: "usd" })));
  assertThrows(() => parseCanonicalLine(line({ status: "sent" as CanonicalLine["status"] })));
  assertThrows(() => parseCanonicalLine({ ...line(), account_number: "000" }));
});

Deno.test("capabilities and copy keys stay the contract names", () => {
  assertEquals(PROVIDERS, ["sumit", "mercury"]);
  assertEquals(SUMIT_CAPABILITIES, {
    listing: "full",
    removal: "sweep",
    currencies: ["ILS"],
    hasPending: false,
  });
  assertEquals(MERCURY_CAPABILITIES, {
    listing: "window",
    removal: "status",
    currencies: ["USD"],
    hasPending: true,
  });
  assertEquals(CONNECTOR_ERROR_CLASSES, ["auth", "rejected", "rate_limited", "transient"]);
  assertEquals(CONNECTOR_COPY_KEYS.includes("pending.tag"), true);
  assertEquals(CONNECTOR_COPY_KEYS.includes("range.from_start"), true);
});

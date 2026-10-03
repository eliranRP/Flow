import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { MercuryApiChecked } from "./mercury/api_check.ts";

const mercuryApiChecked: MercuryApiChecked | null = null;
void mercuryApiChecked;
import { MERCURY_CAPABILITIES, MERCURY_SKIP_REASONS } from "./mercury/capabilities.ts";
import { assertMercuryGet } from "./mercury/guard.ts";
import { jerusalemDate } from "./mercury/dates.ts";
import { redactMercury } from "./mercury/redact.ts";
import { CONNECTOR_MODULES, PROVIDERS } from "./registry.ts";
import { SUMIT_CAPABILITIES } from "./sumit/capabilities.ts";
import {
  CONNECTOR_COPY_KEYS,
  CONNECTOR_ERROR_CLASSES,
  parseCanonicalLine,
  type CanonicalLine,
} from "./types.ts";

function line(overrides: Partial<CanonicalLine> = {}): CanonicalLine {
  return {
    source: "mercury",
    external_id: "txn_1",
    direction: "expense",
    line_status: "posted",
    doc_kind: "expense",
    pnl_role: "project",
    currency: "USD",
    amount_original: 1250,
    doc_date: "2026-10-03",
    cash_date: "2026-10-03",
    source_account_id: "acct_1",
    counterparty: { name: "Hardware", external_id: "cp_1", kind: "supplier" },
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
  const pending = line({ line_status: "pending", cash_date: null, amount_original: 0 });
  assertEquals(parseCanonicalLine(pending).line_status, "pending");
});

Deno.test("a SUMIT line keeps gross ILS, a role, and a section hint", () => {
  const sumit = line({
    source: "sumit",
    currency: "ILS",
    amount_original: 11800,
    doc_kind: "expense",
    pnl_role: "project",
    vat: { amount: 1800, status: "source" },
    project_hint: { external_id: "42", name: "foundation" },
    provider_meta: {},
  });
  assertEquals(parseCanonicalLine(sumit).project_hint, { external_id: "42", name: "foundation" });
  assertEquals(parseCanonicalLine(sumit).amount_original, 11800);
});

Deno.test("amount_original rejects floats and negatives", () => {
  assertThrows(() => parseCanonicalLine(line({ amount_original: 1.5 })));
  assertThrows(() => parseCanonicalLine(line({ amount_original: -1 })));
});

Deno.test("an impossible calendar date is refused", () => {
  assertThrows(() => parseCanonicalLine(line({ doc_date: "2026-13-45" })));
  assertThrows(() => parseCanonicalLine(line({ doc_date: "2026-02-29" })));
  assertEquals(parseCanonicalLine(line({ doc_date: "2024-02-29" })).doc_date, "2024-02-29");
});

Deno.test("currency, status, and extra keys are refused", () => {
  assertThrows(() => parseCanonicalLine(line({ currency: "usd" })));
  assertThrows(() => parseCanonicalLine(line({ line_status: "sent" as CanonicalLine["line_status"] })));
  assertThrows(() => parseCanonicalLine({ ...line(), account_number: "000" }));
});

Deno.test("provider_meta refuses an account number", () => {
  assertThrows(() =>
    parseCanonicalLine(line({
      provider_meta: { kind: "wire", accountNumber: "026073150" } as CanonicalLine["provider_meta"],
    }))
  );
});

Deno.test("capabilities and copy keys stay the contract names", () => {
  assertEquals(PROVIDERS, ["sumit", "mercury"]);
  assertEquals(CONNECTOR_MODULES.sumit.kek_ref, "SUMIT_KEK");
  assertEquals(CONNECTOR_MODULES.mercury.kek_ref, "MERCURY_KEK");
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
  assertEquals(MERCURY_SKIP_REASONS.includes("own_account_transfer"), true);
  assertEquals(CONNECTOR_ERROR_CLASSES, ["auth", "rejected", "rate_limited", "transient"]);
  assertEquals(CONNECTOR_COPY_KEYS.includes("pending.tag"), true);
});

Deno.test("Mercury dates use the Asia/Jerusalem calendar", () => {
  assertEquals(jerusalemDate("2026-10-03T21:30:00Z"), "2026-10-04");
  assertEquals(jerusalemDate("2026-10-03T20:00:00Z"), "2026-10-03");
});

Deno.test("redact drops account and routing numbers", () => {
  const clean = redactMercury({
    kind: "wire 123456789",
    accountNumber: "026073150",
    routingNumber: "026073150",
    details: { accountNumber: "111122223333" },
    dashboardLink: "https://app.mercury.com/tx/1",
    note: "acct 9999",
    externalMemo: "memo",
    attachments: [{ url: "https://files.example/a" }],
  });
  const text = JSON.stringify(clean);
  assertEquals(text.includes("026073150"), false);
  assertEquals(text.includes("111122223333"), false);
  assertEquals(text.includes("accountNumber"), false);
  assertEquals(text.includes("dashboardLink"), false);
  assertEquals(text.includes("9999"), false);
  assertEquals(text.includes("https://"), false);
  assertEquals((clean as { kind: string }).kind, "wire ****");
});

Deno.test("the Mercury fetch wrapper is GET on the allowlist only", () => {
  assertMercuryGet("GET", "/credit");
  assertMercuryGet("GET", "/transaction/txn_1");
  assertThrows(() => assertMercuryGet("POST", "/transactions"));
  assertThrows(() => assertMercuryGet("GET", "/account/acct_1/transactions"));
  assertThrows(() => assertMercuryGet("GET", "https://api.mercury.com/accounts"));
});

import { describe, expect, it } from "vitest";
import { hasBankRows, maskLongDigits, methodLabel, sameParty, splitAccountLast4 } from "./txn-meta";
import { parseTxnMeta, parseTxnMetaList } from "./txn-meta-parse";

const empty = {
  transaction_id: "t1",
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
};

describe("parseTxnMeta", () => {
  it("keeps a line with no meta as all nulls", () => {
    expect(parseTxnMeta(empty)).toEqual(empty);
    expect(hasBankRows(parseTxnMeta(empty), "Example Office Suite")).toBe(false);
    expect(methodLabel(parseTxnMeta(empty))).toBeNull();
  });

  it("reads an unknown method as other, and other shows no method line", () => {
    const meta = parseTxnMeta({ ...empty, method: "crypto" });
    expect(meta?.method).toBe("other");
    expect(methodLabel(meta)).toBeNull();
  });

  it("drops a card_last4 that is not exactly 4 digits", () => {
    expect(parseTxnMeta({ ...empty, method: "card", card_last4: "42" })?.card_last4).toBeNull();
    expect(parseTxnMeta({ ...empty, method: "card", card_last4: "424242" })?.card_last4).toBeNull();
    expect(parseTxnMeta({ ...empty, method: "card", card_last4: 4242 })?.card_last4).toBeNull();
    expect(parseTxnMeta({ ...empty, method: "card", card_last4: "4242" })?.card_last4).toBe("4242");
  });

  it("masks a 9-digit run in the memo and the bank text, and trims blanks to null", () => {
    const meta = parseTxnMeta({ ...empty, memo: "WIRE TO ACCT 123456789", bank_description: "  ", counterparty: "" });
    expect(meta?.memo).toBe("WIRE TO ACCT ••6789");
    expect(meta?.bank_description).toBeNull();
    expect(meta?.counterparty).toBeNull();
  });

  it("keeps a Hebrew memo as is", () => {
    expect(parseTxnMeta({ ...empty, memo: "תשלום על חשבונית 1042" })?.memo).toBe("תשלום על חשבונית 1042");
  });

  it("drops rows that do not parse from a list and accepts a non-array as empty", () => {
    expect(parseTxnMetaList([empty, { method: "card" }])).toEqual([empty]);
    expect(parseTxnMetaList(null)).toEqual([]);
  });
});

describe("maskLongDigits", () => {
  it("keeps the last 4 of a run of 5 or more and leaves short runs", () => {
    expect(maskLongDigits("REF 12345 INV 1042")).toBe("REF ••2345 INV 1042");
    expect(maskLongDigits("123456789")).toBe("••6789");
    expect(maskLongDigits("••6789")).toBe("••6789");
  });
});

describe("splitAccountLast4", () => {
  it("splits a trailing ••1234 and keeps an account with no last 4 whole", () => {
    expect(splitAccountLast4("Mercury Checking ••1234")).toEqual({ name: "Mercury Checking", last4: "1234" });
    expect(splitAccountLast4("Mercury Checking (1)")).toEqual({ name: "Mercury Checking (1)", last4: null });
    expect(splitAccountLast4("••5678")).toEqual({ name: "", last4: "5678" });
  });
});

describe("methodLabel", () => {
  it("labels each method for the card and the detail", () => {
    expect(methodLabel({ method: "card", card_last4: "4242" })).toEqual({
      icon: "card",
      short: "••4242",
      detail: "כרטיס ••4242",
      spoken: "כרטיס שמסתיים ב־4242",
    });
    expect(methodLabel({ method: "card", card_last4: null })?.short).toBe("כרטיס");
    expect(methodLabel({ method: "ach", card_last4: null })).toMatchObject({ short: "ACH", detail: "העברת ACH" });
    expect(methodLabel({ method: "wire", card_last4: null })?.short).toBe("העברה בנקאית");
    expect(methodLabel({ method: "transfer", card_last4: null })?.short).toBe("העברה פנימית");
    expect(methodLabel({ method: "check", card_last4: null })).toMatchObject({ icon: "check", short: "צ׳ק" });
  });
});

describe("sameParty", () => {
  it("compares trimmed and case-insensitive", () => {
    expect(sameParty(" example office suite ", "Example Office Suite")).toBe(true);
    expect(sameParty("Example Office Suite", "Sample Supplies")).toBe(false);
    expect(sameParty(null, "x")).toBe(false);
  });
});

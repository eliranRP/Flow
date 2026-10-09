import { z } from "zod";
import { maskLongDigits, TXN_METHODS, type TxnMeta, type TxnMethod } from "./txn-meta";

/**
 * FLOW-804: the zod parse of `get_line_meta`, apart from txn-meta.ts so the labels Home draws
 * do not pull zod into the first load. Reads reach it through loadReadSchemas().
 */
const text = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? maskLongDigits(trimmed) : null;
  });

const methodSet = new Set<string>(TXN_METHODS);

const txnMetaSchema = z.object({
  transaction_id: z.string(),
  method: z
    .string()
    .nullish()
    .transform((value): TxnMethod | null => (value == null ? null : methodSet.has(value) ? (value as TxnMethod) : "other")),
  card_last4: z
    .unknown()
    .transform((value) => (typeof value === "string" && /^\d{4}$/.test(value) ? value : null)),
  memo: text,
  account: text,
  counterparty: text,
  bank_description: text,
});

/** Parses the RPC result. A row that does not parse is dropped; the meta is supplementary. */
export function parseTxnMetaList(data: unknown): TxnMeta[] {
  if (!Array.isArray(data)) return [];
  const rows: TxnMeta[] = [];
  for (const item of data) {
    const parsed = txnMetaSchema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

export function parseTxnMeta(data: unknown): TxnMeta | null {
  const parsed = txnMetaSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

import { z } from "zod";

/** FLOW-413 (decision 0168). Which date puts a line in a cash month: the payment date or the document date. */
export const cashBasisSchema = z.enum(["paid", "invoice"]);

/** JSON numbers and digit strings both become bigint minor units. Fractions are rejected. */
const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

const cashCurrencyRowSchema = z.object({
  currency: currencySchema,
  /** נכנס: money in, positive. */
  in_minor: minorSchema,
  /** יצא: money out, positive (a month where refunds beat costs is negative). */
  out_minor: minorSchema,
  net_minor: minorSchema,
  /** The month's profit on the P&L's invoiced basis, for the "רווח החודש" row. */
  profit_minor: minorSchema,
  excluded_count: z.number().int().nonnegative(),
  excluded_in_minor: minorSchema,
  excluded_out_minor: minorSchema,
});

/** `cash_months`: the months newest first, the current month included; each month's base currency comes first. */
export const cashMonthsSchema = z
  .object({
    basis: cashBasisSchema,
    base_currency: currencySchema,
    months: z.array(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}-01$/),
        by_currency: z.array(cashCurrencyRowSchema).nullable().transform((rows) => rows ?? []),
      }),
    ),
  })
  .nullable();

export const cashSideSchema = z.enum(["in", "out"]);

/** `cash_month_lines`: the lines behind one month's נכנס or יצא, newest first. Amounts are positive on their side. */
export const cashLinesSchema = z
  .object({
    rows: z.array(
      z.object({
        transaction_id: z.string(),
        part: z.string().nullable(),
        description: z.string(),
        supplier_name: z.string().nullable(),
        project_name: z.string().nullable(),
        category_name: z.string().nullable(),
        doc_date: z.string(),
        cash_month_date: z.string(),
        currency: currencySchema,
        amount_minor: minorSchema,
        side: cashSideSchema,
        source: z.string().nullable().optional().catch(undefined),
      }),
    ),
    has_more: z.boolean(),
  })
  .nullable();

export type CashBasis = z.infer<typeof cashBasisSchema>;
export type CashMonths = z.infer<typeof cashMonthsSchema>;
export type CashMonth = NonNullable<CashMonths>["months"][number];
export type CashCurrencyRow = CashMonth["by_currency"][number];
export type CashSide = z.infer<typeof cashSideSchema>;
export type CashLinesPage = z.infer<typeof cashLinesSchema>;
export type CashLine = NonNullable<CashLinesPage>["rows"][number];

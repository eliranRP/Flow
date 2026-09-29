/** Signed expense rows. Negating them gives the positive amount on the category line. */
export function categoryRowsTotal(rows: readonly { amount_net: bigint }[]): bigint {
  return rows.reduce((sum, row) => sum - row.amount_net, 0n);
}

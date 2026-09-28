/** Absolute agorot. Home and Unpaid both sum open invoices this way. */
export function absAgorot(value: bigint): bigint {
  return value < 0n ? -value : value;
}

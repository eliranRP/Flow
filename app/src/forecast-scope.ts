/** The month's writes run one after another, in the order tapped (a change, then its ביטול). */
export function forecastScope(month: string): string {
  return `month-forecast-${month}`;
}

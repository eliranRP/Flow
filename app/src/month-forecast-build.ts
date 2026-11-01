/**
 * The month-end forecast's builder, loaded on demand (FLOW-1008): Home and the תזרים צפוי screen read the same
 * forecast, and the builder is only needed once its reads have come back, so it stays out of Home's entry.
 */
export { buildMonthForecast, parseMonthEdits } from "@flow/shared";

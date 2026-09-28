/**
 * Fixture helpers for Vitest. The app barrel does not export these, and
 * check:bundle fails if a production module imports this path.
 */
export { demoKindToDocKind, demoDocKindSchema } from "./schemas.ts";
export type { DemoDocKind } from "./schemas.ts";
export { demoDataSchema, demoSumitDocSchema, pnlFromDemo } from "./pnl.ts";
export type { DemoData, DemoPnl, DemoSumitDoc } from "./pnl.ts";

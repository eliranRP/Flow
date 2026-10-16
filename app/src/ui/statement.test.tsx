import { describe, expect, it } from "vitest";
import { statementMethodFromMeta } from "./statement";

/** FLOW-305 with FLOW-304 bank details. Invented card digits. */
const meta = (method: string | null, card_last4: string | null = null) =>
  ({ method, card_last4 }) as Parameters<typeof statementMethodFromMeta>[0];


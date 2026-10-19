/**
 * Decision 0192: vite.config points `zod` here. Zod 4 probes `new Function("")` when the first
 * object schema is built, to decide whether to compile a faster parser. The app's CSP has no
 * 'unsafe-eval', so that probe is a CSP violation on every load. jitless skips the probe; parsing
 * stays the same, only interpreted. This module runs before any module that imports `zod`.
 * Server code (Deno, MCP) imports zod directly and keeps the compiled parser.
 */
import { config } from "zod/v4";

config({ jitless: true });

export * from "zod/v4";
export { default } from "zod/v4";

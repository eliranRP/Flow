import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The library modules the app never calls, pointed at stubs (FLOW-804, FLOW-1215), and zod without
 * its `new Function` probe (Decision 0192). vite.config.ts builds with them; vitest.config.ts's
 * `unit-aliased` project runs the unit suite with them so the tests see the same modules.
 */
export const libraryAliases = [
  { find: /^@supabase\/realtime-js$/, replacement: path.resolve(dirname, "src/lib/supabase-unused.ts") },
  { find: /^@supabase\/storage-js$/, replacement: path.resolve(dirname, "src/lib/supabase-unused.ts") },
  // auth-js's passkey (WebAuthn) factor code, which GoTrueClient imports and Flow never calls.
  { find: /^\.\/lib\/webauthn$/, replacement: path.resolve(dirname, "src/lib/supabase-unused.ts") },
  // FLOW-1215: auth-js's Ethereum sign-in helpers (signInWithWeb3), which Flow never calls.
  { find: /^\.\/lib\/web3\/ethereum$/, replacement: path.resolve(dirname, "src/lib/supabase-unused.ts") },
  // FLOW-1215: zod's JSON Schema conversion and its compiled-parser code writer, which Flow never calls.
  { find: /^\.\.\/core\/json-schema-processors\.js$/, replacement: path.resolve(dirname, "src/lib/zod-json-schema-unused.ts") },
  { find: /^\.\.\/core\/to-json-schema\.js$/, replacement: path.resolve(dirname, "src/lib/zod-json-schema-unused.ts") },
  { find: /^\.\/doc\.js$/, replacement: path.resolve(dirname, "src/lib/zod-doc-unused.ts") },
  // Decision 0192: zod without its new Function probe, which the CSP (no 'unsafe-eval') reports.
  { find: /^zod$/, replacement: path.resolve(dirname, "src/lib/zod-jitless.ts") },
];

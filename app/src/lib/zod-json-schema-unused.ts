/**
 * FLOW-1215: zod's JSON Schema conversion (z.toJSONSchema, schema.toJSONSchema() and the
 * `~standard.jsonSchema` methods) is about 33 KB minified in the zod-jitless chunk, and nothing in
 * Flow calls it: Flow parses data with zod and never reads a schema back out as JSON Schema. zod's
 * classic schemas import their `*Processor` functions from `core/json-schema-processors.js` and
 * `createToJSONSchemaMethod` from `core/to-json-schema.js`, so every schema keeps all of both.
 * vite.config points those two files here, and `core/doc.js` (the writer behind the compiled
 * object parser that zod-jitless.ts turns off). Using any of it throws, so a feature that needs it
 * fails loudly and drops the aliases.
 * zod-json-schema-unused.test.ts checks the names match what zod imports.
 */

function unused(): never {
  throw new Error("zod's JSON Schema conversion is not in Flow's build. Remove its aliases in vite.config.ts to use it.");
}

/** What the schema getters `.minLength`, `.maxValue` and the like read; no schema in Flow reads one. */
export function aggregateChecks(_schema: unknown): Record<string, undefined> {
  return {};
}

export const toJSONSchema = unused;
export const createToJSONSchemaMethod = () => unused;
export const createStandardJSONSchemaMethod = () => unused;

/** One name per schema type zod's classic schemas read, all the same function. */
export {
  unused as anyProcessor,
  unused as arrayProcessor,
  unused as bigintProcessor,
  unused as booleanProcessor,
  unused as catchProcessor,
  unused as customProcessor,
  unused as dateProcessor,
  unused as defaultProcessor,
  unused as enumProcessor,
  unused as fileProcessor,
  unused as functionProcessor,
  unused as intersectionProcessor,
  unused as lazyProcessor,
  unused as literalProcessor,
  unused as mapProcessor,
  unused as nanProcessor,
  unused as neverProcessor,
  unused as nonoptionalProcessor,
  unused as nullProcessor,
  unused as nullableProcessor,
  unused as numberProcessor,
  unused as objectProcessor,
  unused as optionalProcessor,
  unused as pipeProcessor,
  unused as prefaultProcessor,
  unused as promiseProcessor,
  unused as readonlyProcessor,
  unused as recordProcessor,
  unused as setProcessor,
  unused as stringProcessor,
  unused as successProcessor,
  unused as symbolProcessor,
  unused as templateLiteralProcessor,
  unused as transformProcessor,
  unused as tupleProcessor,
  unused as undefinedProcessor,
  unused as unionProcessor,
  unused as unknownProcessor,
  unused as voidProcessor,
};

/**
 * The code writer behind zod's compiled object parser. zod-jitless.ts turns that parser off before
 * any schema is built (`jit` is false), so nothing constructs one. It has no methods, so a build
 * that did would fail at its first `write`.
 */
export class Doc {}

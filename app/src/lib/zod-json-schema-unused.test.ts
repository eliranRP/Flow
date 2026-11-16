// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as unusedDoc from "./zod-doc-unused";
import * as unused from "./zod-json-schema-unused";

// zod's own build, the code the aliases in vite.config.ts feed.
const zodRoot = path.dirname(createRequire(import.meta.url).resolve("zod/v4"));
const read = (file: string): string => readFileSync(path.join(zodRoot, file), "utf8");

describe("zod-json-schema-unused (FLOW-1215)", () => {
  it("exports every processor name zod's classic schemas read", () => {
    const names = new Set([...read("classic/schemas.js").matchAll(/processors\.(\w+)/g)].map((m) => m[1] ?? ""));
    names.delete("js");
    expect(names.size).toBeGreaterThan(30);
    for (const name of names) expect(unused, name).toHaveProperty(name);
  });

  it("exports the JSON Schema method builders the classic schemas import", () => {
    const imported = /import \{([^}]*)\} from "\.\.\/core\/to-json-schema\.js"/.exec(read("classic/schemas.js"))?.[1] ?? "";
    const names = imported.split(",").map((name) => name.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(unused, name).toHaveProperty(name);
    // Building the method is what every schema does; only calling it fails.
    expect(() => unused.createToJSONSchemaMethod()).not.toThrow();
    expect(() => unused.createStandardJSONSchemaMethod()).not.toThrow();
  });

  it("exports the code writer zod's core imports from core/doc.js, and nothing else", () => {
    expect(/^export class (\w+)/m.exec(read("core/doc.js"))?.[1]).toBe("Doc");
    expect(Object.keys(unusedDoc)).toEqual(["Doc"]);
    expect(new unusedDoc.Doc()).not.toHaveProperty("write");
  });

  it("throws, naming library-aliases.ts, when something converts a schema to JSON Schema", () => {
    expect(() => unused.toJSONSchema()).toThrow(/library-aliases\.ts/);
    expect(() => unused.stringProcessor()).toThrow(/library-aliases\.ts/);
  });

  it("throws rather than answer wrongly for the aggregate-checks getters", () => {
    expect(() => unused.aggregateChecks({})).toThrow(/library-aliases\.ts/);
  });

  // The default `unit` project runs zod as installed; `pnpm test:aliased` runs it through the aliases.
  const aliased = isAliased();
  it.runIf(aliased)("through the aliases: z.toJSONSchema and the aggregate-check getters throw", () => {
    expect(() => z.toJSONSchema(z.string())).toThrow(/library-aliases\.ts/);
    expect(() => z.string().min(3).minLength).toThrow(/library-aliases\.ts/);
    expect(() => z.number().min(5).minValue).toThrow(/library-aliases\.ts/);
    // zod-jitless.ts ran before any schema was built.
    expect(z.core.globalConfig.jitless).toBe(true);
    // Parsing is untouched.
    expect(z.object({ a: z.string().min(2) }).parse({ a: "ok" })).toEqual({ a: "ok" });
  });

  it.runIf(!aliased)("without the aliases: the getters return zod's real values", () => {
    expect(z.string().min(3).minLength).toBe(3);
    expect(z.string().max(9).maxLength).toBe(9);
    expect(z.number().min(5).minValue).toBe(5);
  });
});

/** True when zod's JSON Schema modules are the stubs: reading the getter throws instead of answering. */
function isAliased(): boolean {
  try {
    return typeof z.string().min(3).minLength !== "number";
  } catch {
    return true;
  }
}

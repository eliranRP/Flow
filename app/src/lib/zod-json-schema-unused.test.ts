// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

  it("exports the code writer zod's core imports from core/doc.js, with none of its methods", () => {
    expect(/^export class (\w+)/m.exec(read("core/doc.js"))?.[1]).toBe("Doc");
    expect(new unused.Doc()).not.toHaveProperty("write");
  });

  it("throws, naming vite.config.ts, when something converts a schema to JSON Schema", () => {
    expect(() => unused.toJSONSchema()).toThrow(/vite\.config\.ts/);
    expect(() => unused.stringProcessor()).toThrow(/vite\.config\.ts/);
  });
});

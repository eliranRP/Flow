// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readSupabaseEnv } from "./supabase";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as unused from "./supabase-unused";

// --- supabase.test.ts

describe("readSupabaseEnv", () => {
  it("returns null for a URL that is not a URL", () => {
    expect(readSupabaseEnv({ url: "not a url", anonKey: "public" })).toBeNull();
  });

  it("accepts an empty pair so the app can render signed-out", () => {
    expect(readSupabaseEnv({ url: "", anonKey: "" })).toEqual({ url: "", anonKey: "" });
  });
});
// --- supabase-unused.test.ts

// supabase-js's own build, the code the alias in vite.config.ts feeds.
const entry = createRequire(import.meta.url).resolve("@supabase/supabase-js");
const source = readFileSync(path.join(path.dirname(entry), "index.mjs"), "utf8");

function importedFrom(pkg: string): string[] {
  const match = new RegExp(`import \\{([^}]*)\\} from "${pkg}"`).exec(source);
  return (match?.[1] ?? "").split(",").map((name) => name.trim()).filter(Boolean);
}

describe("supabase-unused (FLOW-804)", () => {
  it("exports every name supabase-js imports from realtime and storage", () => {
    const names = [...importedFrom("@supabase/realtime-js"), ...importedFrom("@supabase/storage-js")];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(unused, name).toHaveProperty(name);
  });

  it("has every realtime method supabase-js calls", () => {
    const methods = new Set([...source.matchAll(/this\.realtime\.(\w+)/g)].map((m) => m[1] ?? ""));
    expect(methods.size).toBeGreaterThan(0);
    const client = new unused.RealtimeClient();
    for (const method of methods) expect(typeof (client as unknown as Record<string, unknown>)[method], method).toBe("function");
  });

  it("throws when a feature reaches for realtime or storage", () => {
    expect(() => new unused.RealtimeClient().channel("any")).toThrow(/vite\.config\.ts/);
    expect(() => new unused.StorageClient().from("any")).toThrow(/vite\.config\.ts/);
  });
});
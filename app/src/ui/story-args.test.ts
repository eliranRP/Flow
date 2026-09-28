import { describe, expect, it } from "vitest";

type StoryModule = {
  default?: { args?: unknown };
} & Record<string, unknown>;

const modules = import.meta.glob<StoryModule>("./**/*.stories.tsx", { eager: true });

/** Paths of bigint values. Storybook sends args across the manager channel with JSON.stringify. */
export function bigintPaths(value: unknown, path = "args", seen = new WeakSet()): string[] {
  if (typeof value === "bigint") return [path];
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => bigintPaths(item, `${path}[${String(index)}]`, seen));
  }
  return Object.entries(value).flatMap(([key, child]) => bigintPaths(child, `${path}.${key}`, seen));
}

function storyArgs(story: unknown): unknown {
  if (story === null || typeof story !== "object") return undefined;
  return "args" in story ? story.args : undefined;
}

describe("story args", () => {
  it("finds a bigint nested in args", () => {
    expect(bigintPaths({ agorot: 1n })).toEqual(["args.agorot"]);
    expect(bigintPaths({ nested: [{ amount: 2n }] })).toEqual(["args.nested[0].amount"]);
    expect(bigintPaths({ label: "1500", onChange: () => undefined })).toEqual([]);
  });

  it("never puts a bigint in any story's args", () => {
    const files = Object.keys(modules);
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const [file, mod] of Object.entries(modules)) {
      for (const [name, story] of Object.entries(mod)) {
        const args = storyArgs(story);
        if (args === undefined) continue;
        for (const found of bigintPaths(args)) hits.push(`${file} ${name} ${found}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

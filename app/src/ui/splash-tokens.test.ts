// @vitest-environment node
// FLOW-1277: the splash's timer constants are the numbers of its motion tokens.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SPLASH_END_MS, SPLASH_FADE_MS, SPLASH_WORD_DELAY_MS } from "./splash";

const tokensCss = readFileSync(new URL("../../../design/system/implementation-tokens.css", import.meta.url), "utf8");

function token(name: string): string {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss)?.[1]?.trim() ?? "";
}

describe("the splash timing constants", () => {
  it("match the motion tokens", () => {
    expect(token("--motion-splash-word-delay")).toBe(`${String(SPLASH_WORD_DELAY_MS)}ms`);
    expect(token("--motion-splash-word")).toBe(`${String(SPLASH_END_MS - SPLASH_WORD_DELAY_MS)}ms`);
    expect(token("--motion-toast-out")).toBe(`${String(SPLASH_FADE_MS)}ms`);
  });

  it("run the liquid for 2.4s, the wave 4 times in step with it, and the whole splash about 2.9s", () => {
    expect(token("--motion-splash-fill")).toBe("2400ms");
    expect(token("--motion-splash-wave")).toBe("600ms");
    expect(SPLASH_END_MS + SPLASH_FADE_MS).toBe(2860);
  });
});

// @vitest-environment node
// FLOW-363 (1/4): the motion tokens, their reduced-motion values and the motion utilities.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(new URL("../../../design/system/implementation-tokens.css", import.meta.url), "utf8");
const motionCss = readFileSync(new URL("./css/00-motion.css", import.meta.url), "utf8");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the first block that starts with `head` (e.g. ":root {"), brace-matched. */
function blockBody(css: string, head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`no block starting "${head}"`);
  let depth = 0;
  for (let i = start + head.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + head.length, i);
    }
  }
  throw new Error(`unclosed block "${head}"`);
}

/** Custom property declarations in a block: name -> value. */
function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name = "", value = ""] of stripComments(body).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return map;
}

/** Rules in a flat block (no nested braces): selectors and declaration text. */
function flatRules(body: string): Array<{ selectors: string[]; declarations: string }> {
  return [...stripComments(body).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectorText = "", declarationText = ""]) => ({
    selectors: selectorText.split(",").map((selector) => selector.trim()),
    declarations: declarationText,
  }));
}

const rootTokens = declarations(blockBody(tokensCss, ":root {"));
const reducedTokens = declarations(blockBody(tokensCss, "@media (prefers-reduced-motion: reduce) {"));
const motionTokenNames = [...rootTokens.keys()].filter((name) => name.startsWith("--motion-"));

describe("motion tokens in implementation-tokens.css", () => {
  it("defines the motion tokens in the light :root block", () => {
    expect(motionTokenNames.length).toBeGreaterThan(0);
  });

  it("sets every --motion-* token to 0ms when the user asks for reduced motion", () => {
    // The two sheet tokens stay at 1ms: Vaul has no animationend fallback (10-settings-onboarding.css).
    for (const name of motionTokenNames) {
      const expected = name === "--motion-sheet-in" || name === "--motion-sheet-out" ? "1ms" : "0ms";
      expect(reducedTokens.get(name), name).toBe(expected);
    }
  });

  it("sets the rise distances to 0px and the shimmer to 0ms under reduced motion", () => {
    expect(reducedTokens.get("--rise-page")).toBe("0px");
    expect(reducedTokens.get("--rise-push")).toBe("0px");
    expect(reducedTokens.get("--dur-shimmer")).toBe("0ms");
  });

  it("keeps the approved motion values", () => {
    const expected: Record<string, string> = {
      "--ease-enter": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      "--ease-exit": "cubic-bezier(0.4, 0, 1, 1)",
      "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
      "--motion-press": "120ms",
      "--motion-fast": "150ms",
      "--motion-width": "300ms",
      "--skeleton-delay": "300ms",
      "--motion-toast-out": "160ms",
      "--motion-fade": "200ms",
      "--motion-sheet-out": "220ms",
      "--motion-bar": "240ms",
      "--motion-scrim": "260ms",
      "--motion-page": "280ms",
      "--motion-sheet-in": "280ms",
      "--motion-stagger": "40ms",
      "--motion-bar-grow": "480ms",
      "--motion-pulse": "1.2s",
      "--motion-spin": "800ms",
      "--rise-page": "8px",
      "--rise-push": "24px",
      "--dur-shimmer": "1400ms",
      "--toast-duration": "2500ms",
      "--toast-duration-error": "4000ms",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(rootTokens.get(name), name).toBe(value);
    }
  });

  it("no longer defines the old --dur-* motion tokens", () => {
    for (const name of ["--dur-press", "--dur-fast", "--dur-base", "--dur-sheet-in", "--dur-sheet-out"]) {
      expect(rootTokens.has(name), name).toBe(false);
    }
  });
});

describe("00-motion.css", () => {
  const css = stripComments(motionCss);

  it("writes every duration and easing as a token, never a raw value", () => {
    expect(css).not.toMatch(/\b\d+(\.\d+)?(ms|s)\b/);
    expect(css).not.toMatch(/cubic-bezier\(/);
    expect(css).not.toMatch(/(?<![-\w])(linear|ease-in-out|ease-in|ease-out|ease)(?![-\w])/);
  });

  it("uses only var(--motion-*), var(--ease-*) and var(--rise-*) for its timing and distances", () => {
    // --i is the stagger index a page sets on each child (see .m-page-enter), not a timing value.
    for (const match of css.matchAll(/var\(--([\w-]+)/g)) {
      expect(match[1], match[0]).toMatch(/^(motion-|ease-|rise-|i$)/);
    }
  });

  it("turns off the animation of every animated .m-* class under reduced motion", () => {
    const withoutKeyframes = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
    const reducedBody = blockBody(css, "@media (prefers-reduced-motion: reduce) {");
    const mainRules = withoutKeyframes.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
    const animatedClasses = flatRules(mainRules)
      .filter((rule) => /(^|;|\s)animation\s*:/.test(rule.declarations))
      .flatMap((rule) => rule.selectors)
      .map((selector) => selector.match(/\.m-[\w-]+/)?.[0])
      .filter((name): name is string => name !== undefined);
    expect(animatedClasses.length).toBeGreaterThan(0);
    const reduced = flatRules(reducedBody);
    for (const name of new Set(animatedClasses)) {
      const rule = reduced.find(
        (candidate) => candidate.selectors.includes(name) && /animation\s*:\s*none/.test(candidate.declarations),
      );
      expect(rule, `${name} needs animation: none under reduced motion`).toBeDefined();
    }
  });

  it("names the motion classes the app uses", () => {
    for (const name of [".m-press", ".m-press-scale", ".m-page-enter", ".m-push-in", ".m-push-back", ".m-sheet-in", ".m-sheet-out", ".m-bar-in", ".m-bar-out", ".m-row-leave", ".m-bar-grow"]) {
      expect(css).toContain(name);
    }
  });
});

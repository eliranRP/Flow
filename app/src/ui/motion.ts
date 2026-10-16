import type { CSSProperties } from "react";

/**
 * FLOW-364: the stagger index a page sets on each `.m-page-enter` child (REDESIGN-PLAN §2.1). The
 * delay is `--i` times `--motion-stagger`, capped at 4 in the stylesheet.
 */
export function pageEnterStyle(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

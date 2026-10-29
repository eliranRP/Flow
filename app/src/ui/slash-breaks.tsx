import { Fragment, type ReactNode } from "react";

/**
 * A "/" between letters ("Contributions/Distributions"), where a line may break; not a date's ("1/1/2026").
 * A lookahead only: a lookbehind needs Safari 16.4, and the build targets Safari 16, where the RegExp
 * (built when screen-header's chunk loads) would throw.
 */
const SLASH = /\p{L}\/(?=\p{L})/gu;

/**
 * FLOW-171: a name with a <wbr> after each slash between letters, so a long Latin name in a right-to-left
 * line breaks after "/" before it breaks inside a word (Safari does not break at a slash on its own).
 * The text itself is unchanged: the accessible name and a copy read the same.
 */
export function slashBreaks(text: string): ReactNode {
  const parts: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SLASH)) {
    const end = match.index + match[0].length;
    parts.push(text.slice(start, end));
    start = end;
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(start));
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}

import { Fragment, type ReactNode } from "react";

/** A "/" between letters ("Contributions/Distributions"), where a line may break; not a date's ("1/1/2026"). */
const SLASH = /(?<=\p{L}\/)(?=\p{L})/u;

/**
 * FLOW-171: a name with a <wbr> after each slash between letters, so a long Latin name in a right-to-left
 * line breaks after "/" before it breaks inside a word (Safari does not break at a slash on its own).
 * The text itself is unchanged: the accessible name and a copy read the same.
 */
export function slashBreaks(text: string): ReactNode {
  const parts = text.split(SLASH);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}

/** The הצעה mark on a suggestion line, a summary row, and a picker row. */
export function SuggestTag() {
  return <span className="ui-suggest-tag">הצעה</span>;
}

/**
 * The הצעת Jev mark: a suggested value that Jev, the AI tagger, filled. It replaces
 * הצעה on that line only. A supplier rule or a value the user set keeps הצעה or no mark.
 * The ✦ is decoration; the words are the accessible name. On a narrow card (FLOW-327) the
 * words are visually hidden and only ✦ shows, so the value keeps the room.
 */
export function JevTag() {
  return (
    <span className="ui-suggest-tag ui-suggest-tag-jev">
      <span aria-hidden="true">✦</span>
      <span className="ui-suggest-tag-words">הצעת Jev</span>
    </span>
  );
}

/** The החזר mark on a line filed under the other kind's category. Same look as הצעה. */
export function ReversalTag() {
  return <span className="ui-suggest-tag">החזר</span>;
}

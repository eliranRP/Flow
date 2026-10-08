/**
 * Where the typed text sits in a name, case-insensitive, for the search tint (FLOW-323). Null when
 * it does not appear there: the line may have matched its description or the other party instead.
 */
export function matchRange(text: string, needle: string | undefined): { start: number; end: number } | null {
  const q = (needle ?? "").trim();
  if (q === "") return null;
  // Lower case can change a string's length (İ becomes two units), which would shift the tint;
  // such a name is matched as typed instead.
  const lower = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const start = lower.length === text.length && lowerQ.length === q.length ? lower.indexOf(lowerQ) : text.indexOf(q);
  if (start < 0) return null;
  return { start, end: start + q.length };
}

/** The text with the first match tinted (`mark`, tint background, the text's own colour). */
export function MatchText({ text, match }: { text: string; match?: string }) {
  const range = matchRange(text, match);
  if (range == null) return <>{text}</>;
  return (
    <>
      {text.slice(0, range.start)}
      <mark className="ui-match">{text.slice(range.start, range.end)}</mark>
      {text.slice(range.end)}
    </>
  );
}

/** The hidden word of each up mark: one icon, two meanings. */
export const UP_MARK_LABEL = { high: "גבוה מהרגיל", new: "חדש" } as const;

/** FLOW-401 v5: the one signal on a category, a small amber up arrow. The hidden word names it. */
export function UpMark({ kind }: { kind: keyof typeof UP_MARK_LABEL }) {
  return (
    <span className="ui-up-mark" role="img" aria-label={UP_MARK_LABEL[kind]}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
    </span>
  );
}

type NoteProps = {
  title: string;
  body: string;
  tone?: "neutral" | "bad";
};

export function Note({ title, body, tone = "neutral" }: NoteProps) {
  return (
    <div className="flex gap-3 rounded-card bg-tint px-4 py-3 text-text">
      {tone === "bad" ? <BadIcon /> : <InfoIcon />}
      <div>
        <p className="text-title-3 text-text">{title}</p>
        <p className="mt-1 text-label text-text-secondary">{body}</p>
      </div>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 text-accent-text">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function BadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 text-bad">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 8v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

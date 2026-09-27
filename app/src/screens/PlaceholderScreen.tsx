import { Link } from "react-router-dom";

export function LegalScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="page min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <h1 className="t-title-1">{title}</h1>
      <p className="t-label mt-4 text-text-secondary">{body}</p>
      <Link to="/sign-in" aria-label="חזרה" className="icon-btn mt-6 inline-flex text-accent-text">
        <span className="t-label">חזרה</span>
      </Link>
    </main>
  );
}

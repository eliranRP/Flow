import { Link } from "react-router-dom";
import { Wordmark } from "../components/Wordmark";
import { usePreviewMode } from "../preview";

export function PlaceholderScreen({
  title,
  note,
  showBack = false,
}: {
  title: string;
  note: string;
  showBack?: boolean;
}) {
  const preview = usePreviewMode();
  const home = preview ? "/?preview=1" : "/";
  return (
    <div className="screen-pad px-side pb-8">
      <Wordmark />
      <h1 className="mt-2 text-title-1">{title}</h1>
      <p className="mt-3 text-label text-text-secondary">{note}</p>
      {showBack ? (
        <Link to={home} className="mt-6 inline-flex h-touch items-center text-label text-accent-text">
          חזרה לבית
        </Link>
      ) : null}
    </div>
  );
}

export function LegalScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto min-h-dvh max-w-content bg-bg px-side py-10">
      <h1 className="text-title-1">{title}</h1>
      <p className="mt-4 text-label text-text-secondary">{body}</p>
      <Link to="/sign-in" className="mt-8 inline-flex h-touch items-center text-label text-accent-text">
        חזרה לכניסה
      </Link>
    </main>
  );
}

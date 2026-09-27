import { Link } from "react-router-dom";

export function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  return (
    <div className="px-6 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <p className="text-[13px] text-text-muted">Flow</p>
      <h1 className="mt-2 text-[28px] font-semibold">{title}</h1>
      <p className="mt-3 text-[15px] font-normal leading-relaxed text-text-secondary">{note}</p>
      <Link to="/" className="mt-6 inline-block text-accent-text">
        חזרה לבית
      </Link>
    </div>
  );
}

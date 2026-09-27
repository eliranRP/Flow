import { NavLink } from "react-router-dom";
import { usePreviewMode } from "../preview";
import { HomeIcon, ProjectsIcon, ReviewIcon, SettingsIcon } from "./icons";

const tabClass =
  "flex min-h-touch min-w-touch flex-1 flex-col items-center justify-center gap-0.5 text-micro text-text-muted aria-[current=page]:text-accent-text";

export function TabBar() {
  const preview = usePreviewMode();
  const search = preview ? "?preview=1" : "";
  return (
    <nav className="fixed inset-x-0 bottom-0 mx-auto flex h-tabbar w-full max-w-content items-end border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <NavLink to={`/${search}`} end className={tabClass}>
        <HomeIcon />
        בית
      </NavLink>
      <NavLink to={`/projects${search}`} className={tabClass}>
        <ProjectsIcon />
        פרויקטים
      </NavLink>
      <NavLink
        to={`/add${search}`}
        aria-label="הוספה"
        className="mb-2 flex size-fab shrink-0 items-center justify-center rounded-fab bg-accent text-title-2 text-on-accent"
      >
        +
      </NavLink>
      <NavLink to={`/review${search}`} className={tabClass}>
        <ReviewIcon />
        לאישור
      </NavLink>
      <NavLink to={`/settings${search}`} className={tabClass}>
        <SettingsIcon />
        הגדרות
      </NavLink>
    </nav>
  );
}

import { Link, useLocation } from "react-router-dom";
import { addTriggerRef } from "../add-trigger";
import { usePreviewSearch } from "../preview";
import { withSheetBackground } from "../sheet-background";
import { HomeIcon, PlusIcon, ProjectsIcon, ReviewIcon, SettingsIcon } from "./icons";

const slot = "ui-tab-slot";

export function reviewAwaitingLabel(count: number): string {
  if (count === 1) return "לאישור, פריט אחד ממתין לאישור";
  const shown = count > 99 ? "99+" : String(count);
  return `לאישור, ${shown} פריטים ממתינים לאישור`;
}

type TabBarProps = {
  label?: string;
  reviewCount?: number;
};

type Section = "home" | "projects" | "review" | "settings";

/** Pushed screens keep the tab of the section they belong to. /add highlights none. */
export function tabSection(pathname: string): Section | null {
  if (pathname === "/" || pathname.startsWith("/unpaid")) return "home";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/settings") || pathname.startsWith("/notifications")) return "settings";
  return null;
}

export function TabBar({ label = "ניווט ראשי", reviewCount = 0, fabPressed = false }: TabBarProps & { fabPressed?: boolean }) {
  const search = usePreviewSearch();
  const location = useLocation();
  const section = tabSection(location.pathname);
  const badge = reviewCount > 99 ? "99+" : String(reviewCount);
  return (
    <nav className="ui-tabbar" aria-label={label}>
      <div className="ui-tabbar-slots">
        <Link to={`/${search}`} className={slot} aria-current={section === "home" ? "page" : undefined}>
          <span className="ui-tab-icon">
            <HomeIcon />
          </span>
          <span className="ui-tab-label">בית</span>
        </Link>
        <Link to={`/projects${search}`} className={slot} aria-current={section === "projects" ? "page" : undefined}>
          <span className="ui-tab-icon">
            <ProjectsIcon />
          </span>
          <span className="ui-tab-label">פרויקטים</span>
        </Link>
        <Link
          ref={addTriggerRef}
          to={`/add${search}`}
          state={withSheetBackground(location)}
          aria-label="הוספה"
          className={`${slot} ui-tab-slot-fab`}
        >
          <span className={fabPressed ? "ui-fab ui-fab-pressed" : "ui-fab"}>
            <PlusIcon />
          </span>
        </Link>
        <Link
          to={`/review${search}`}
          className={slot}
          aria-current={section === "review" ? "page" : undefined}
          aria-label={reviewCount > 0 ? reviewAwaitingLabel(reviewCount) : undefined}
        >
          <span className="ui-tab-icon">
            <ReviewIcon />
            {reviewCount > 0 ? (
              <span className="ui-count-badge">
                <bdi dir="ltr">{badge}</bdi>
              </span>
            ) : null}
          </span>
          <span className="ui-tab-label">לאישור</span>
        </Link>
        <Link to={`/settings${search}`} className={slot} aria-current={section === "settings" ? "page" : undefined}>
          <span className="ui-tab-icon">
            <SettingsIcon />
          </span>
          <span className="ui-tab-label">הגדרות</span>
        </Link>
      </div>
    </nav>
  );
}

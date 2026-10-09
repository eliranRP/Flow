import { Link, useLocation } from "react-router-dom";
import { addTriggerRef } from "../add-trigger";
import { usePreviewSearch } from "../preview";
import { withSheetBackground } from "../sheet-background";
import { useGoBack } from "./back";
import { HomeIcon, PlusIcon, ProjectsIcon, ReviewIcon, SettingsIcon } from "./icons";

const slot = "ui-tab-slot";

export function reviewAwaitingLabel(count: number): string {
  if (count === 1) return "לאישור, פריט אחד ממתין לאישור";
  const shown = count > 99 ? "99+" : String(count);
  return `לאישור, ${shown} פריטים ממתינים לאישור`;
}

type TabBarProps = {
  label?: string;
  /** Names the current tab where the path can't: the dev fixtures under /e2e/ (FLOW-334). */
  section?: TabSection | null;
  reviewCount?: number;
  fabPressed?: boolean;
  /** A viewer has no add. The empty slot keeps the five-column rhythm. */
  allowAdd?: boolean;
};

export type TabSection = "home" | "projects" | "review" | "settings";
type Section = TabSection;

/** Pushed screens keep the tab of the section they belong to. /add highlights none. */
export function tabSection(pathname: string): Section | null {
  if (pathname === "/" || pathname.startsWith("/unpaid") || pathname.startsWith("/flow/")) return "home";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/review")) return "review";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

export function TabBar({ label = "ניווט ראשי", section: pinned, reviewCount = 0, fabPressed = false, allowAdd = true }: TabBarProps) {
  const search = usePreviewSearch();
  const location = useLocation();
  const goBack = useGoBack();
  const section = pinned === undefined ? tabSection(location.pathname) : pinned;
  const onAdd = location.pathname === "/add";
  const badge = reviewCount > 99 ? "99+" : String(reviewCount);
  const fab = (
    <span className={fabPressed ? "ui-fab ui-fab-pressed" : "ui-fab"}>
      <PlusIcon />
    </span>
  );
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
        {onAdd ? (
          <button
            ref={(node) => {
              addTriggerRef.current = node;
            }}
            type="button"
            aria-label="הוספה"
            className={`${slot} ui-tab-slot-fab`}
            onClick={() => {
              goBack(`/${search}`);
            }}
          >
            {fab}
          </button>
        ) : allowAdd ? (
          <Link
            ref={(node) => {
              addTriggerRef.current = node;
            }}
            to={`/add${search}`}
            state={withSheetBackground(location)}
            aria-label="הוספה"
            className={`${slot} ui-tab-slot-fab`}
          >
            {fab}
          </Link>
        ) : (
          <span className={`${slot} ui-tab-slot-fab`} aria-hidden="true" />
        )}
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

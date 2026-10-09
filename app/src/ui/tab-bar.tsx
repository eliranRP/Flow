import type { ReactNode } from "react";
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

/** A slot's icon, its count badge, and its label: the same in the live bar and its picture. */
function TabFace({ icon, label, badge }: { icon: ReactNode; label: string; badge?: string | null }) {
  return (
    <>
      <span className="ui-tab-icon">
        {icon}
        {badge != null ? (
          <span className="ui-count-badge">
            <bdi dir="ltr">{badge}</bdi>
          </span>
        ) : null}
      </span>
      <span className="ui-tab-label">{label}</span>
    </>
  );
}

function countBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/**
 * The tab bar as a picture (FLOW-506): the same slots, icons and badge, with no links, no router
 * and no add trigger. It sits in the flow, not fixed, and is hidden from assistive tech.
 */
export function TabBarPicture({ section = null, reviewCount = 0 }: { section?: TabSection | null; reviewCount?: number }) {
  const current = (name: TabSection) => (section === name ? "page" : undefined);
  return (
    <div className="ui-tabbar-picture" aria-hidden="true">
      <div className="ui-tabbar-slots">
        <span className={slot} aria-current={current("home")}><TabFace icon={<HomeIcon />} label="בית" /></span>
        <span className={slot} aria-current={current("projects")}><TabFace icon={<ProjectsIcon />} label="פרויקטים" /></span>
        <span className={`${slot} ui-tab-slot-fab`}>
          <span className="ui-fab">
            <PlusIcon />
          </span>
        </span>
        <span className={slot} aria-current={current("review")}><TabFace icon={<ReviewIcon />} label="לאישור" badge={countBadge(reviewCount)} /></span>
        <span className={slot} aria-current={current("settings")}><TabFace icon={<SettingsIcon />} label="הגדרות" /></span>
      </div>
    </div>
  );
}

export function TabBar({ label = "ניווט ראשי", section: pinned, reviewCount = 0, fabPressed = false, allowAdd = true }: TabBarProps) {
  const search = usePreviewSearch();
  const location = useLocation();
  const goBack = useGoBack();
  const section = pinned === undefined ? tabSection(location.pathname) : pinned;
  const onAdd = location.pathname === "/add";
  const fab = (
    <span className={fabPressed ? "ui-fab ui-fab-pressed" : "ui-fab"}>
      <PlusIcon />
    </span>
  );
  return (
    <nav className="ui-tabbar" aria-label={label}>
      <div className="ui-tabbar-slots">
        <Link to={`/${search}`} className={slot} aria-current={section === "home" ? "page" : undefined}>
          <TabFace icon={<HomeIcon />} label="בית" />
        </Link>
        <Link to={`/projects${search}`} className={slot} aria-current={section === "projects" ? "page" : undefined}>
          <TabFace icon={<ProjectsIcon />} label="פרויקטים" />
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
          <TabFace icon={<ReviewIcon />} label="לאישור" badge={countBadge(reviewCount)} />
        </Link>
        <Link to={`/settings${search}`} className={slot} aria-current={section === "settings" ? "page" : undefined}>
          <TabFace icon={<SettingsIcon />} label="הגדרות" />
        </Link>
      </div>
    </nav>
  );
}

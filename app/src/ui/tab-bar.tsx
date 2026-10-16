import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePreviewSearch } from "../preview";
import { reducedMotion } from "./period-swipe";
import { BankColumnsIcon, HomeIcon, ProjectsIcon, RepeatIcon } from "./icons";

const slot = "ui-tab-slot";

type TabBarProps = {
  label?: string;
  /** Names the current tab where the path can't: the dev fixtures under /e2e/ (FLOW-334). */
  section?: TabSection | null;
};

export type TabSection = "home" | "projects" | "loans" | "recurring";

/**
 * The tab a path belongs to. Settings is behind the avatar on Home, so no tab is current there,
 * except the loans page, which the loans tab opens (FLOW-364).
 */
export function tabSection(pathname: string): TabSection | null {
  if (pathname === "/" || pathname.startsWith("/unpaid") || pathname.startsWith("/flow/")) return "home";
  // The profit view and the cash months open from Home; the review queue opens from Home's box.
  if (pathname === "/profit" || pathname.startsWith("/cash/") || pathname.startsWith("/review")) return "home";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/settings/loans") || pathname.startsWith("/loans")) return "loans";
  if (pathname.startsWith("/missing-bills") || pathname.startsWith("/recurring")) return "recurring";
  return null;
}

/** A slot's icon and its label: the same in the live bar and its picture. */
function TabFace({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <>
      <span className="ui-tab-icon">{icon}</span>
      <span className="ui-tab-label">{label}</span>
    </>
  );
}

const tabs: { section: TabSection; label: string; path: string; icon: ReactNode }[] = [
  { section: "home", label: "בית", path: "/", icon: <HomeIcon size={24} stroke={2} /> },
  { section: "projects", label: "פרויקטים", path: "/projects", icon: <ProjectsIcon size={24} stroke={2} /> },
  { section: "loans", label: "הלוואות", path: "/settings/loans", icon: <BankColumnsIcon size={24} stroke={2} /> },
  { section: "recurring", label: "קבועים", path: "/missing-bills", icon: <RepeatIcon size={24} stroke={2} /> },
];

/**
 * The tab bar as a picture (FLOW-506): the same slots and icons, with no links, no router.
 * It sits in the flow, not fixed, and is hidden from assistive tech.
 */
export function TabBarPicture({ section = null }: { section?: TabSection | null }) {
  return (
    <div className="ui-tabbar-picture" aria-hidden="true">
      <div className="ui-tabbar-slots">
        {tabs.map((tab) => (
          <span key={tab.section} className={slot} aria-current={section === tab.section ? "page" : undefined}>
            <TabFace icon={tab.icon} label={tab.label} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function TabBar({ label = "ניווט ראשי", section: pinned }: TabBarProps) {
  const search = usePreviewSearch();
  const location = useLocation();
  const current = pinned === undefined ? tabSection(location.pathname) : pinned;
  // FLOW-364: tapping the active tab scrolls the page to the top, and does not move.
  const onActive = (section: TabSection) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (section !== current) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  return (
    <nav className="ui-tabbar" aria-label={label}>
      <div className="ui-tabbar-slots">
        {tabs.map((tab) => (
          <Link
            key={tab.section}
            to={`${tab.path}${search}`}
            className={slot}
            aria-current={current === tab.section ? "page" : undefined}
            onClick={onActive(tab.section)}
          >
            <TabFace icon={tab.icon} label={tab.label} />
          </Link>
        ))}
      </div>
    </nav>
  );
}

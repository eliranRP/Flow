import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
 * The tab a path belongs to. Settings is behind the avatar on Home, so Home stays current there, as
 * on the board; the loans page is the loans tab's (FLOW-364).
 */
export function tabSection(pathname: string): TabSection | null {
  if (pathname === "/" || pathname.startsWith("/unpaid") || pathname === "/transfers") return "home";
  // The profit view and the cash months open from Home; the review queue opens from Home's box.
  if (pathname === "/profit" || pathname.startsWith("/cash/") || pathname.startsWith("/review") || pathname.startsWith("/settings")) return "home";
  // A project's profit pages open from Home's profit view, so the board lights Home there too.
  if (/^\/projects\/[^/]+\/profit(\/|$)/.test(pathname)) return "home";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/loans")) return "loans";
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
  { section: "loans", label: "הלוואות", path: "/loans", icon: <BankColumnsIcon size={24} stroke={2} /> },
  { section: "recurring", label: "קבועים", path: "/recurring", icon: <RepeatIcon size={24} stroke={2} /> },
];

export function TabBar({ label = "ניווט ראשי", section: pinned }: TabBarProps) {
  const search = usePreviewSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const current = pinned === undefined ? tabSection(location.pathname) : pinned;
  // FLOW-364: tapping the active tab on its own main screen scrolls that screen to the top. From a page
  // inside the tab (a project, a loan, Settings under Home) the tap goes to the tab's main screen.
  // Home on an older month (`?month=`) goes back to this month too, as "חזרה ל…" does.
  const onActive = (section: TabSection, path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (section !== current || location.pathname !== path) return;
    event.preventDefault();
    if (section === "home" && new URLSearchParams(location.search).has("month")) void navigate(`/${search}`, { replace: true });
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
            onClick={onActive(tab.section, tab.path)}
          >
            <TabFace icon={tab.icon} label={tab.label} />
          </Link>
        ))}
      </div>
    </nav>
  );
}

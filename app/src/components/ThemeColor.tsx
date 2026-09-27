import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const BAND = "#7B3FE4";
const BG_LIGHT = "#FFFFFF";
const BG_DARK = "#15111E";

function isBandRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  return /^\/projects\/[^/]+$/.test(pathname);
}

function pageBackground(): string {
  const root = document.documentElement;
  const forced = root.dataset.theme;
  const dark =
    forced === "dark" ||
    (forced !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return dark ? BG_DARK : BG_LIGHT;
}

/** Home and Project keep the violet status bar. Every other route uses the page background. */
export function ThemeColor() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute("content", isBandRoute(pathname) ? BAND : pageBackground());
  }, [pathname]);
  return null;
}

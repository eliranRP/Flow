import { useEffect } from "react";
import { useLocation } from "react-router-dom";

function isBandRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  return /^\/projects\/[^/]+$/.test(pathname);
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Home and Project keep the band colour in the status bar. Every other route uses the page background. */
export function ThemeColor() {
  const { pathname } = useLocation();
  useEffect(() => {
    const apply = () => {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) return;
      const value = isBandRoute(pathname)
        ? readToken("--color-band")
        : readToken("--color-bg");
      if (value) meta.setAttribute("content", value);
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    const root = document.documentElement;
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", apply);
      observer.disconnect();
    };
  }, [pathname]);
  return null;
}

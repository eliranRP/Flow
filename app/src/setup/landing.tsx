import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/** First route on load. Survives Shell remounts after full-screen routes. Lives in the entry, so the setup chunk can read it. */
let landingPath: string | null = null;

/** Tests reset landing capture between cases. */
export function resetSetupLandingForTests(): void {
  landingPath = null;
}

const AUTH_ENTRY = new Set(["/sign-in", "/auth/callback"]);

/** Records the first app route once. Mounted for every route, so a full-screen deep link counts. */
export function noteSetupLanding(pathname: string): void {
  if (landingPath === null && !AUTH_ENTRY.has(pathname)) landingPath = pathname;
}

/** The first app route of this page load, or null before one was recorded. */
export function setupLandingPath(): string | null {
  return landingPath;
}

export function SetupLanding(): null {
  const { pathname } = useLocation();
  // A layout effect, not render: a render React throws away must not record the landing.
  useLayoutEffect(() => { noteSetupLanding(pathname); }, [pathname]);
  return null;
}

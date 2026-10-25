import type { Decorator } from "@storybook/react-vite";
import { useLayoutEffect, type ReactNode } from "react";

function reducedMotionList(query: string): MediaQueryList {
  return {
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- MediaQueryList still declares it
    addListener: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- MediaQueryList still declares it
    removeListener: () => undefined,
  };
}

let originalMatchMedia: typeof window.matchMedia | null = null;

function installReducedMotion() {
  if (originalMatchMedia) return;
  originalMatchMedia = window.matchMedia.bind(window);
  const previous = originalMatchMedia;
  window.matchMedia = (query: string) => {
    if (query.includes("prefers-reduced-motion")) return reducedMotionList(query);
    return previous(query);
  };
}

function uninstallReducedMotion() {
  if (!originalMatchMedia) return;
  window.matchMedia = originalMatchMedia;
  originalMatchMedia = null;
}

export function ReducedMotionFrame({ children }: { children: ReactNode }) {
  installReducedMotion();
  useLayoutEffect(() => {
    return () => {
      uninstallReducedMotion();
    };
  }, []);
  return children;
}

export const forceReducedMotion: Decorator = (Story) => (
  <ReducedMotionFrame>
    <Story />
  </ReducedMotionFrame>
);

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { periodFromSearch } from "./period";
import { useHomePreview } from "./preview";
import { projectQueryOptions, useBooks, useDashboardQuery } from "./use-books";

/** A prefetched project counts as fresh this long, so Home and Projects do not read it again. */
const FRESH_MS = 60_000;
/** The first projects on the list, read while the phone is idle. */
const IDLE_PROJECTS = 3;

/** The project id and search of a project page link, or null for any other link. */
export function projectLink(href: string): { projectId: string; search: string } | null {
  const url = new URL(href, "https://flow.invalid");
  const match = /^\/projects\/([^/]+)$/.exec(url.pathname);
  return match?.[1] ? { projectId: decodeURIComponent(match[1]), search: url.search } : null;
}

/**
 * FLOW-804: a project page opens with its figures already read. The first projects on the list
 * are read once the phone is idle, and any other one the moment a finger (or the keyboard) lands
 * on its row, which is about a tenth of a second before the tap opens it.
 */
export function PrefetchProjects() {
  const client = useQueryClient();
  const preview = useHomePreview();
  const { period } = useBooks();
  // Reads Home's list from the cache; it never fetches the dashboard itself.
  const projects = useDashboardQuery(false).data?.projects;

  useEffect(() => {
    if (preview !== "off") return;
    function prefetch(projectId: string, search: string) {
      // The page starts on the link's period, else Home's (useProjectPeriod).
      const linkPeriod = periodFromSearch(new URLSearchParams(search)) ?? period;
      client.query({ ...projectQueryOptions(preview, projectId, linkPeriod), staleTime: FRESH_MS }).catch(() => undefined);
    }
    function onPress(event: Event) {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const link = anchor ? projectLink(anchor.getAttribute("href") ?? "") : null;
      if (link) prefetch(link.projectId, link.search);
    }
    document.addEventListener("pointerdown", onPress, { passive: true });
    document.addEventListener("focusin", onPress);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("focusin", onPress);
    };
  }, [client, preview, period]);

  const first = projects?.slice(0, IDLE_PROJECTS).map((project) => project.id).join(",") ?? "";
  useEffect(() => {
    if (preview !== "off" || first === "") return;
    const ids = first.split(",");
    const run = () => {
      for (const id of ids) {
        client.query({ ...projectQueryOptions(preview, id, period), staleTime: FRESH_MS }).catch(() => undefined);
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(run, { timeout: 4000 });
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const handle = window.setTimeout(run, 1500);
    return () => {
      window.clearTimeout(handle);
    };
  }, [client, preview, period, first]);

  return null;
}

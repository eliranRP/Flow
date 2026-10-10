import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { periodFromSearch } from "./period";
import { useHomePreview } from "./preview";
import { projectQueryOptions, useBooks } from "./use-books";
import { cashYearMonthsQueryOptions, cashYearsQueryOptions } from "./use-cash";

/** A prefetched project counts as fresh this long, so Home and Projects do not read it again. */
const FRESH_MS = 60_000;

/** The project id and search of a project page link, or null for any other link. */
export function projectLink(href: string): { projectId: string; search: string } | null {
  const url = new URL(href, "https://flow.invalid");
  const match = /^\/projects\/([^/]+)$/.exec(url.pathname);
  return match?.[1] ? { projectId: decodeURIComponent(match[1]), search: url.search } : null;
}

/** FLOW-417: the history or a year's page behind a link, or null for any other link. */
export function cashHistoryLink(href: string): { year: number | null } | null {
  const path = new URL(href, "https://flow.invalid").pathname;
  if (path === "/cash/history") return { year: null };
  const match = /^\/cash\/year\/(\d{4})$/.exec(path);
  return match?.[1] ? { year: Number(match[1]) } : null;
}

/**
 * FLOW-804: a project page opens with its figures already read: a project is read the moment a
 * finger (or the keyboard) lands on its row, which is about a tenth of a second before the tap
 * opens it, once and without retries. Home no longer reads projects while the phone is idle: three
 * project reads at once ran past the server's statement timeout and slowed every other read.
 */
export function PrefetchProjects() {
  const client = useQueryClient();
  const preview = useHomePreview();
  const { period } = useBooks();

  useEffect(() => {
    if (preview !== "off") return;
    function prefetch(projectId: string, search: string) {
      // The page starts on the link's period, else Home's (useProjectPeriod).
      const linkPeriod = periodFromSearch(new URLSearchParams(search)) ?? period;
      client.query({ ...projectQueryOptions(preview, projectId, linkPeriod), staleTime: FRESH_MS, retry: false }).catch(() => undefined);
    }
    function onPress(event: Event) {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = anchor?.getAttribute("href") ?? "";
      const link = anchor ? projectLink(href) : null;
      if (link) prefetch(link.projectId, link.search);
      // FLOW-417: the cash history and a year's months are read on touch too, toward the 0.7 s open.
      const cash = anchor ? cashHistoryLink(href) : null;
      if (cash) {
        const read =
          cash.year == null
            ? client.query({ ...cashYearsQueryOptions(preview), staleTime: FRESH_MS, retry: false })
            : client.query({ ...cashYearMonthsQueryOptions(preview, cash.year), staleTime: FRESH_MS, retry: false });
        read.catch(() => undefined);
      }
    }
    document.addEventListener("pointerdown", onPress, { passive: true });
    document.addEventListener("focusin", onPress);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("focusin", onPress);
    };
  }, [client, preview, period]);

  return null;
}

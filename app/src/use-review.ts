import type { ReviewCursor, ReviewRow } from "@flow/shared";
import { skipToken, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "./lib/supabase";
import { loadReadSchemas } from "./load-read-schemas";
import { waitForAccessToken } from "./wait-for-session";
import { useHomePreview } from "./preview";
import {
  JEV_CONNECTOR_STALE_MS,
  beginJevScopeLookup,
  companyIdFromReviewPayload,
  completeJevScopeLookup,
  dropLegacyJevConnectorKey,
  jevConnectorQueryKey,
  jevQueueKey,
  jevQueueQueryKey,
  seedJevConnectorFromLive,
  jevScopeFollowsLive,
  type JevScopeLookup,
} from "./screens/jev-connector-scope";
import { withJevDeadline } from "./screens/jev-deadline";

/**
 * FLOW-984: the review queue is read in pages. `["review", preview]` (or `["review", preview, "project", id]`
 * for one project) stays a flat ReviewRow[] of the pages loaded so far, so the optimistic updates that filter
 * or map that array keep working. What the pages leave out lives beside it, under `["review-meta", ...]`:
 * the server's open count, the cursor of the next page and the state of the load that is under way.
 */

/** Items in the first page and in every page after it. */
export const REVIEW_PAGE_SIZE = 50;
/** The next page starts loading when this many cards are left ahead of the card on screen. */
export const REVIEW_AHEAD = 15;
/** The most items one read asks for (the server caps it at 200 too). */
const REVIEW_READ_MAX = 200;

type ReviewMeta = {
  /** Open items on the server when the last page landed. */
  total: number;
  /** Items in the list when that page landed. The list shrinks as cards are approved, the total does not until a read. */
  loaded: number;
  next: ReviewCursor | null;
  failed: boolean;
  loading: boolean;
};

type ScopeClient = NonNullable<ReturnType<typeof getSupabase>>;

export function reviewListKey(preview: string, project: string | null) {
  return project == null ? (["review", preview] as const) : (["review", preview, "project", project] as const);
}

function reviewMetaKey(preview: string, project: string | null) {
  return ["review-meta", preview, project ?? ""] as const;
}

/**
 * The cache entries an optimistic update to the queue touches: the whole queue, and the one project's
 * queue when the screen is filtered to it. An entry that was never read is left as it is.
 */
export function reviewCacheUpdates(
  preview: string,
  project: string | null,
  update: (old: unknown) => unknown,
): Array<{ key: readonly unknown[]; update: (old: unknown) => unknown }> {
  return [
    { key: reviewListKey(preview, null), update },
    ...(project == null ? [] : [{ key: reviewListKey(preview, project), update }]),
  ];
}

function companyIdFromRow(company: { data: { id?: unknown } | null; error: unknown }): string | null {
  if (company.error != null || company.data == null || typeof company.data.id !== "string" || company.data.id === "") return null;
  return company.data.id;
}

function readSessionUserId(supabase: ScopeClient): PromiseLike<string | null> {
  if (typeof supabase.auth.getSession !== "function") return Promise.resolve(null);
  return supabase.auth.getSession().then(
    ({ data }) => {
      const id = data.session?.user.id;
      return id != null && id !== "" ? id : null;
    },
    () => null,
  );
}

function readCompanyId(supabase: ScopeClient): PromiseLike<string | null> {
  if (typeof supabase.from !== "function") return Promise.resolve(null);
  return supabase.from("companies").select("id").limit(1).maybeSingle().then(companyIdFromRow, () => null);
}

/** Session and company share one deadline. A row that arrives later may still bind. */
async function settleReviewJevScope(
  supabase: ScopeClient,
  listed: PromiseLike<{ data: unknown; error: unknown }>,
  lookup: JevScopeLookup,
  client: QueryClient,
): Promise<void> {
  const found: { userId: string | null; companyId: string | null } = { userId: null, companyId: null };
  const userTask = Promise.resolve(readSessionUserId(supabase)).then((id) => {
    found.userId = id;
  });
  const companyTask = Promise.resolve(readCompanyId(supabase)).then((id) => {
    found.companyId = id;
  });
  await withJevDeadline(undefined, async () => {
    await Promise.all([userTask, companyTask]);
    return true;
  }, false);
  let payloadCompany: string | null = null;
  let ids: string[] = [];
  try {
    const result = await listed;
    if (result.error == null) {
      payloadCompany = companyIdFromReviewPayload(result.data);
      ids = (await loadReadSchemas()).reviewRowSchema.array().parse(result.data).map((row) => row.transaction_id);
    }
  } catch {
    payloadCompany = null;
  }
  const publish = () => {
    const resolvedCompany = payloadCompany ?? found.companyId;
    const scope = found.userId != null && resolvedCompany != null
      ? { userId: found.userId, companyId: resolvedCompany }
      : null;
    if (!completeJevScopeLookup(lookup, scope) || scope == null || jevScopeFollowsLive()) return;
    if (jevQueueKey(ids) === "" || typeof supabase.from !== "function") return;
    seedJevConnectorFromLive(client, scope);
    void client.query({
      queryKey: jevConnectorQueryKey(scope),
      retry: false,
      staleTime: JEV_CONNECTOR_STALE_MS,
      // The Jev queue code loads with the review screens, not with Home.
      queryFn: ({ signal }) => import("./screens/jev-review").then((jev) => jev.fetchJevConnector(signal)),
    }).then((on) => {
      if (!on) return undefined;
      return client.query({
        queryKey: jevQueueQueryKey(ids),
        retry: false,
        queryFn: ({ signal }) => import("./screens/jev-review").then((jev) => withJevDeadline(
          signal,
          (linked) => jev.loadJevSuggestions(ids, linked),
          jev.JEV_QUEUE_STALLED,
        )),
      });
    }).catch(() => undefined);
  };
  publish();
  void Promise.all([userTask, companyTask]).then(publish);
}

type ReviewArgs = {
  p_limit: number;
  p_after_date?: string;
  p_after_created?: string;
  p_after_id?: string;
  p_project?: string;
  p_item?: string;
};

/**
 * One list_review_page read, parsed. Each page also starts Jev's scope prefetch for its own cards, so the
 * suggestions of a page are on their way as it lands.
 */
async function readReviewPage(
  client: QueryClient,
  supabase: ScopeClient,
  args: ReviewArgs,
) {
  const listed = supabase.rpc("list_review_page", args);
  if (typeof supabase.from === "function") {
    const lookup = beginJevScopeLookup();
    const items = Promise.resolve(listed).then((result) => ({
      data: result.error == null ? (result.data as { items?: unknown } | null)?.items : null,
      error: result.error,
    }));
    void settleReviewJevScope(supabase, items, lookup, client);
  }
  const { data, error } = await listed;
  if (error) throw error;
  return (await loadReadSchemas()).reviewPageSchema.parse(data);
}

function cursorArgs(after: ReviewCursor | null): Pick<ReviewArgs, "p_after_date" | "p_after_created" | "p_after_id"> {
  return after == null ? {} : { p_after_date: after.doc_date, p_after_created: after.created_at, p_after_id: after.id };
}

function metaOf(client: QueryClient, preview: string, project: string | null): ReviewMeta | undefined {
  return client.getQueryData<ReviewMeta>(reviewMetaKey(preview, project));
}

function putMeta(client: QueryClient, preview: string, project: string | null, meta: ReviewMeta): void {
  client.setQueryData(reviewMetaKey(preview, project), meta);
}

/** The page's items replace any copy already loaded (a link's single read), and come after the rest. */
function mergePage(old: ReviewRow[], page: readonly ReviewRow[]): ReviewRow[] {
  const incoming = new Set(page.map((row) => row.id));
  return [...old.filter((row) => !incoming.has(row.id)), ...page];
}

export function useReviewQuery(active = true, project: string | null = null) {
  const preview = useHomePreview();
  const key = reviewListKey(preview, project);
  return useQuery({
    queryKey: key,
    enabled: active && preview === "off",
    queryFn: async ({ client }): Promise<ReviewRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      dropLegacyJevConnectorKey();
      // After an invalidation the list is read again up to the rows it held (the approved ones are gone from
      // the server, so the same cards come back); a first read is one page.
      const want = Math.max(REVIEW_PAGE_SIZE, client.getQueryData<ReviewRow[]>(key)?.length ?? 0);
      let rows: ReviewRow[] = [];
      let next: ReviewCursor | null = null;
      let total = 0;
      do {
        const page: Awaited<ReturnType<typeof readReviewPage>> = await readReviewPage(client, supabase, {
          p_limit: Math.min(REVIEW_READ_MAX, Math.max(REVIEW_PAGE_SIZE, want - rows.length)),
          ...cursorArgs(next),
          ...(project == null ? {} : { p_project: project }),
        });
        rows = mergePage(rows, page.items);
        next = page.next;
        total = page.total;
      } while (rows.length < want && next != null);
      putMeta(client, preview, project, { total, loaded: rows.length, next, failed: false, loading: false });
      return rows;
    },
  });
}

/** Reads the page after the loaded ones and appends it. A failure leaves the list as it is and says so in the meta. */
async function loadMoreReview(client: QueryClient, preview: string, project: string | null): Promise<void> {
  const listKey = reviewListKey(preview, project);
  const meta = metaOf(client, preview, project);
  const supabase = getSupabase();
  if (meta == null || meta.next == null || meta.loading || supabase == null) return;
  // A read of the whole list is under way: it brings these rows itself.
  if (client.isFetching({ queryKey: listKey }) > 0) return;
  const startedAt = client.getQueryState(listKey)?.dataUpdatedAt;
  putMeta(client, preview, project, { ...meta, loading: true, failed: false });
  try {
    const page = await readReviewPage(client, supabase, {
      p_limit: REVIEW_PAGE_SIZE,
      ...cursorArgs(meta.next),
      ...(project == null ? {} : { p_project: project }),
    });
    // The list was read again while this page was on the way: its cursor is stale.
    if (client.getQueryState(listKey)?.dataUpdatedAt !== startedAt || client.isFetching({ queryKey: listKey }) > 0) {
      const now = metaOf(client, preview, project);
      if (now != null && now.loading) putMeta(client, preview, project, { ...now, loading: false });
      return;
    }
    client.setQueryData<ReviewRow[]>(listKey, (old) => mergePage(old ?? [], page.items));
    putMeta(client, preview, project, {
      total: page.total,
      loaded: client.getQueryData<ReviewRow[]>(listKey)?.length ?? 0,
      next: page.next,
      failed: false,
      loading: false,
    });
  } catch {
    const now = metaOf(client, preview, project) ?? meta;
    putMeta(client, preview, project, { ...now, loading: false, failed: true });
  }
}

export type ReviewPaging = {
  /** Every open item, as the server counts them (less the ones approved here and not read back yet). */
  total: number;
  /** Pages remain on the server. */
  more: boolean;
  loading: boolean;
  /** The last page failed to load. */
  failed: boolean;
  /** Starts the next page; nothing while one is loading or the last one failed (retry does that). */
  loadMore: () => void;
  retry: () => void;
};

/**
 * The paging state of the queue read by useReviewQuery. `rows` is how many cards the screen holds now: an
 * approval takes one off the list and off the count at once, before the server is read again.
 */
export function useReviewPaging(rows: number, project: string | null = null): ReviewPaging {
  const preview = useHomePreview();
  const client = useQueryClient();
  const meta = useQuery<ReviewMeta>({
    queryKey: reviewMetaKey(preview, project),
    queryFn: skipToken,
    enabled: false,
    staleTime: Infinity,
  }).data;
  const loadMore = useCallback(() => {
    const current = metaOf(client, preview, project);
    if (current == null || current.next == null || current.loading || current.failed) return;
    void loadMoreReview(client, preview, project);
  }, [client, preview, project]);
  const retry = useCallback(() => {
    const current = metaOf(client, preview, project);
    if (current == null) return;
    putMeta(client, preview, project, { ...current, failed: false });
    void loadMoreReview(client, preview, project);
  }, [client, preview, project]);
  if (meta == null || preview !== "off") {
    return { total: rows, more: false, loading: false, failed: false, loadMore, retry };
  }
  const removed = Math.max(0, meta.loaded - rows);
  return {
    total: Math.max(rows, meta.total - removed),
    more: meta.next != null,
    loading: meta.loading,
    failed: meta.failed,
    loadMore,
    retry,
  };
}

/**
 * A link to a card the pages have not reached (`?item=`) reads that one row and adds it to the list.
 * `reading` is true until that read has answered, so the screen does not take the card for gone.
 */
export function useReviewDeepLink(item: string | null, rows: readonly ReviewRow[], ready: boolean, project: string | null = null): { reading: boolean } {
  const preview = useHomePreview();
  const client = useQueryClient();
  const [answered, setAnswered] = useState<string | null>(null);
  const started = useRef<string | null>(null);
  const meta = useQuery<ReviewMeta>({
    queryKey: reviewMetaKey(preview, project),
    queryFn: skipToken,
    enabled: false,
    staleTime: Infinity,
  }).data;
  // With every page loaded the card is simply not in the queue; with pages left it may be on one of them.
  const unloaded = ready && preview === "off" && item != null && item !== "" && meta?.next != null && !rows.some((row) => row.id === item);
  useEffect(() => {
    if (!unloaded || started.current === item) return;
    started.current = item;
    const supabase = getSupabase();
    if (supabase == null) {
      setAnswered(item);
      return;
    }
    void readReviewPage(client, supabase, { p_limit: 1, p_item: item }).then((page) => {
      const row = page.items[0];
      if (row == null) return;
      const listKey = reviewListKey(preview, project);
      const before = client.getQueryData<ReviewRow[]>(listKey) ?? [];
      if (before.some((entry) => entry.id === row.id)) return;
      client.setQueryData<ReviewRow[]>(listKey, [...before, row]);
      const now = metaOf(client, preview, project);
      if (now != null) putMeta(client, preview, project, { ...now, loaded: now.loaded + 1 });
    }).catch(() => undefined).finally(() => { setAnswered(item); });
  }, [unloaded, item, client, preview, project]);
  return { reading: unloaded && answered !== item };
}

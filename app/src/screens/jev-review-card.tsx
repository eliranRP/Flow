import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useHomePreview } from "../preview";
import { ActionBar } from "../ui/action-bar";
import { Button } from "../ui/button";
import { CheckIcon } from "../ui/icons";
import { ReviewCard } from "../ui/review-card";
import { useOptionalBooks } from "../use-books";
import { getSupabase } from "../lib/supabase";
import {
  JEV_CONNECTOR_STALE_MS,
  JEV_REVIEW_OFF,
  bindJevConnectorScope,
  boundJevConnectorScope,
  fetchJevConnector,
  jevConnectorLiveKey,
  jevLiveOn,
  jevConnectorQueryKey,
  jevQueueQueryKey,
  jevReadable,
  jevScopeFollowsLive,
  jevScopePhase,
  loadJevReview,
  jevQueueKey,
  loadJevFills,
  loadJevSuggestions,
  loadReviewFlags,
  reviewFlagsQueryKey,
  notedJevAuthUser,
  readJevConnectorFlag,
  subscribeJevScope,
  userRememberedJevOn,
  withJevDeadline,
  type JevConnectorScope,
  type JevPrefill,
  JEV_QUEUE_STALLED,
  type JevQueueData,
  type JevReviewState,
} from "./jev-review";
import type { ReviewFlag } from "../review-copy";

export const JEV_REVIEW_SAMPLE: JevPrefill = {
  suggestionId: "s1",
  transactionId: "t1",
  project: { id: "p-villa", name: "וילה רעננה" },
  category: { id: "c-materials", name: "חומרים" },
};

export function useJevReview(transactionId: string | null, live: boolean): JevReviewState & { loading: boolean } {
  const query = useQuery({
    queryKey: ["jev-review", transactionId],
    enabled: live && transactionId != null && transactionId !== "",
    retry: false,
    queryFn: ({ signal }) => withJevDeadline(signal, (linked) => loadJevReview(transactionId ?? "", linked), JEV_REVIEW_OFF),
  });
  const loading = live && transactionId != null && transactionId !== "" && query.isPending;
  if (!live || query.isError || !query.data) return { ...JEV_REVIEW_OFF, loading };
  return { ...query.data, loading };
}

function companyIdFrom(data: unknown): string | null {
  if (data == null || typeof data !== "object" || !("company_id" in data)) return null;
  const id = data.company_id;
  return typeof id === "string" && id !== "" ? id : null;
}

/** A cached dashboard is already a scope. Otherwise the card follows the review lookup. */
function useJevConnectorScope(): {
  scope: JevConnectorScope | null;
  pending: boolean;
  followsLive: boolean;
  sessionUserId: string | null;
} {
  const phase = useSyncExternalStore(subscribeJevScope, jevScopePhase, jevScopePhase);
  const followsLive = useSyncExternalStore(subscribeJevScope, jevScopeFollowsLive, jevScopeFollowsLive);
  const { session } = useAuth();
  const books = useOptionalBooks();
  const preview = useHomePreview();
  const client = useQueryClient();
  const noted = notedJevAuthUser();
  const sessionUserId = session?.user.id ?? (typeof noted === "string" ? noted : null);
  const cached = books == null ? undefined : client.getQueryData(["dashboard", preview, books.period]);
  const companyId = companyIdFrom(cached);
  const hooked = sessionUserId != null && companyId != null ? { userId: sessionUserId, companyId } : null;
  // FLOW-704: bound after commit, not during render. This render's key already uses `hooked`, and a
  // layout effect lands before any query in this component fetches.
  const hookedUser = hooked?.userId;
  const hookedCompany = hooked?.companyId;
  // Every commit, as the render-time bind did: a lookup or auth drop elsewhere may have moved it.
  useLayoutEffect(() => {
    if (hookedUser == null || hookedCompany == null) return;
    const bound = boundJevConnectorScope();
    if (bound?.userId !== hookedUser || bound.companyId !== hookedCompany) {
      bindJevConnectorScope({ userId: hookedUser, companyId: hookedCompany });
    }
  });
  const nothingRemembered = sessionUserId != null && !userRememberedJevOn(sessionUserId);
  const pending = hooked == null && phase === "pending" && !nothingRemembered;
  const scope = pending ? null : (hooked ?? boundJevConnectorScope());
  return { scope, pending, followsLive, sessionUserId };
}

/**
 * FLOW-706: the queue read while Jev is off. Only the fills that still stand, so the card keeps
 * ביטול (decision 0145); no suggestion and no Jev value. A failed read throws: the card shows no label.
 */
export async function loadJevFillsOff(transactionIds: readonly string[], signal?: AbortSignal): Promise<JevQueueData> {
  const ids = [...new Set(transactionIds.filter((id) => id !== ""))];
  const fills = await loadJevFills(ids, signal);
  const byId: Record<string, JevPrefill | null> = {};
  for (const [id, fill] of fills) {
    if (fill.state === "filled") byId[id] = { suggestionId: "", transactionId: id, project: null, category: null, auto: fill };
  }
  return { connectorOn: false, byId };
}

/** Under the queue's key prefix, so an undo's refetch reaches it too. */
export function jevFillsOffQueryKey(transactionIds: readonly string[]) {
  return ["jev-review-queue", "off", jevQueueKey(transactionIds)] as const;
}

/**
 * One read for every open line. A remembered on only waits. The prefill applies
 * after a connector read from this session, and a failed read is off.
 */
export function useJevQueue(transactionIds: readonly string[], live: boolean) {
  const readable = live && jevReadable() && transactionIds.some((id) => id !== "");
  const { scope, pending, followsLive, sessionUserId } = useJevConnectorScope();
  const scopePending = readable && pending;
  const nothingRemembered = sessionUserId != null && !userRememberedJevOn(sessionUserId);
  const remembered = readable && !followsLive && !pending && scope != null && readJevConnectorFlag(scope) === true;
  const client = useQueryClient();
  const liveKey = jevConnectorLiveKey(sessionUserId);
  const scoped = !followsLive && scope != null;
  const connector = useQuery({
    queryKey: scoped ? jevConnectorQueryKey(scope) : liveKey,
    // FLOW-704: a scope that appears after mount takes this session's live answer, so the card
    // does not read the connector a second time.
    initialData: scoped && jevLiveOn(client, sessionUserId) != null ? true : undefined,
    initialDataUpdatedAt: scoped ? () => jevLiveOn(client, sessionUserId) ?? undefined : undefined,
    enabled: readable && !scopePending && (scope != null || followsLive || nothingRemembered),
    retry: false,
    staleTime: JEV_CONNECTOR_STALE_MS,
    queryFn: ({ signal }) => fetchJevConnector(signal),
  });
  const confirmed = connector.isSuccess && connector.dataUpdatedAt > 0;
  const knownOn = confirmed && connector.data;
  const waiting = remembered && !confirmed && !connector.isError;
  const awaitingLive = readable && followsLive && !nothingRemembered && !connector.isSuccess && !connector.isError;
  const suggestions = useQuery({
    queryKey: jevQueueQueryKey(transactionIds),
    enabled: readable && knownOn,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => withJevDeadline(
      signal,
      (linked) => loadJevSuggestions(transactionIds, linked),
      JEV_QUEUE_STALLED,
    ),
  });
  // FLOW-706: with Jev off, a fill that still stands keeps its label and ביטול.
  const knownOff = confirmed && !connector.data;
  const offFills = useQuery({
    queryKey: jevFillsOffQueryKey(transactionIds),
    enabled: readable && knownOff,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => withJevDeadline(
      signal,
      (linked) => loadJevFillsOff(transactionIds, linked),
      JEV_QUEUE_STALLED,
    ),
  });
  function loadingFor(transactionId: string | null): boolean {
    if (scopePending || awaitingLive) return true;
    if (waiting) return true;
    if (connector.isError || !knownOn || suggestions.isError) return false;
    if (suggestions.isPending || transactionId == null) return suggestions.isPending;
    // FLOW-704: the last read stalled, so this one likely will too. The card shows without Jev
    // rather than wait out the deadline again; an answer that lands later still fills it.
    if (suggestions.data === JEV_QUEUE_STALLED) return false;
    return suggestions.isFetching
      && !Object.prototype.hasOwnProperty.call(suggestions.data.byId, transactionId);
  }
  function stateFor(transactionId: string | null): JevReviewState {
    // knownOff already means a settled connector read from this session (no live wait, no remembered on).
    if (knownOff && !scopePending && transactionId != null && offFills.data != null && !offFills.isError) {
      const prefill = offFills.data.byId[transactionId] ?? null;
      return prefill == null ? JEV_REVIEW_OFF : { connectorOn: false, prefill };
    }
    if (scopePending || awaitingLive || waiting || connector.isError || !knownOn || suggestions.isError || suggestions.data == null || loadingFor(transactionId)) {
      return JEV_REVIEW_OFF;
    }
    return {
      connectorOn: suggestions.data.connectorOn,
      prefill: transactionId == null ? null : (suggestions.data.byId[transactionId] ?? null),
    };
  }
  return { loadingFor, stateFor };
}

const NO_LINE_FLAGS: ReviewFlag[] = [];

/**
 * FLOW-327. One `review_anomalies` read for the queue. The flags are SQL (decision 0131), so they
 * read with Jev off too, unscored. A failed read shows no flag and no error; a slow one shows
 * when it lands.
 */
export function useReviewFlags(transactionIds: readonly string[], live: boolean) {
  const supabase = live ? getSupabase() : null;
  const readable = supabase != null && typeof supabase.rpc === "function" && transactionIds.some((id) => id !== "");
  const query = useQuery({
    queryKey: reviewFlagsQueryKey(transactionIds),
    enabled: readable,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => loadReviewFlags(transactionIds, signal),
  });
  return function flagsFor(transactionId: string | null): ReviewFlag[] {
    // Not readable (a preview or a story) reads only what is already cached under the key.
    if (transactionId == null || query.isError || query.data == null) return NO_LINE_FLAGS;
    return query.data[transactionId] ?? NO_LINE_FLAGS;
  };
}

export function JevReviewCard({
  connectorOn,
  prefill,
  supplier = "חומרי בניין לדוגמה בע״מ",
}: {
  connectorOn: boolean;
  prefill: JevPrefill | null;
  supplier?: string;
}) {
  const project = connectorOn ? prefill?.project ?? null : null;
  const category = connectorOn ? prefill?.category ?? null : null;
  const canApprove = project != null && category != null;

  return (
    <div>
      <ReviewCard
        supplier={supplier}
        sourceLine="הוצאה · 12/04/2026"
        netAgorot={-2_200_000n}
        vatLine="לפני מע״מ · מע״מ ₪3,960"
        suggestion={project || category ? {
          ...(project ? { project: project.name, projectSuggested: true, projectJev: true } : {}),
          ...(category ? { category: category.name, categorySuggested: true, categoryJev: true } : {}),
        } : undefined}
        onProject={() => undefined}
        onCategory={() => undefined}
      />
      <ActionBar>
        <Button full disabled={!canApprove} icon={<CheckIcon />}>
          אישור
        </Button>
      </ActionBar>
    </div>
  );
}

const LONG_PROJECT = "וילה רעננה — שיפוץ מלא של הקומה העליונה והחצר האחורית";
const LONG_CATEGORY = "חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי והסביבה הקרובה";
const LONG_SUPPLIER = "ספק חומרי בניין והובלה כללית בע״מ סניף רעננה המרכזי";

const LAYOUT_CASES = [
  {
    id: "filled",
    suggestion: {
      project: "וילה רעננה",
      projectSuggested: true,
      category: "חומרים",
      categorySuggested: true,
    },
  },
  {
    id: "note",
    suggestion: { project: "פרויקט שמור" },
  },
  {
    id: "sumit",
    suggestion: { project: "פרויקט שמור", category: "קטגוריה שמורה" },
  },
] as const;

function LayoutCard({
  suggestion,
  pending,
}: {
  suggestion: { project?: string; projectSuggested?: boolean; category?: string; categorySuggested?: boolean };
  pending: boolean;
}) {
  return (
    <ReviewCard
      supplier="חומרי בניין לדוגמה בע״מ"
      sourceLine="הוצאה · 12/04/2026"
      netAgorot={-2_200_000n}
      vatLine="לפני מע״מ · מע״מ ₪3,960"
      suggestion={suggestion}
      pending={pending}
      onProject={() => undefined}
      onCategory={() => undefined}
    />
  );
}

/** Waiting and settled pairs for the three note layouts. */
export function JevReviewLayout() {
  return (
    <div>
      {LAYOUT_CASES.map((item) => (
        <div key={item.id} data-layout={item.id}>
          <div data-phase="waiting"><LayoutCard suggestion={item.suggestion} pending /></div>
          <div data-phase="settled"><LayoutCard suggestion={item.suggestion} pending={false} /></div>
        </div>
      ))}
    </div>
  );
}

export function JevReviewE2e() {
  const [params] = useSearchParams();
  if (params.get("layout") === "1") return <JevReviewLayout />;
  const on = params.get("on") === "1";
  const long = params.get("long") === "1";
  const project = JEV_REVIEW_SAMPLE.project ?? { id: "p-villa", name: "וילה רעננה" };
  const category = JEV_REVIEW_SAMPLE.category ?? { id: "c-materials", name: "חומרים" };
  return (
    <JevReviewCard
      connectorOn={on || long}
      supplier={long ? LONG_SUPPLIER : undefined}
      prefill={{
        ...JEV_REVIEW_SAMPLE,
        project: { ...project, name: long ? LONG_PROJECT : project.name },
        category: { ...category, name: long ? LONG_CATEGORY : category.name },
      }}
    />
  );
}

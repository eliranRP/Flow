import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useHomePreview } from "../preview";
import { Button } from "../ui/button";
import { CheckIcon } from "../ui/icons";
import { ReviewCard } from "../ui/review-card";
import { useOptionalBooks } from "../use-books";
import {
  JEV_CONNECTOR_STALE_MS,
  JEV_REVIEW_OFF,
  bindJevConnectorScope,
  boundJevConnectorScope,
  fetchJevConnector,
  jevConnectorQueryKey,
  jevQueueQueryKey,
  jevReadable,
  loadJevReview,
  loadJevSuggestions,
  readJevConnectorFlag,
  withJevDeadline,
  type JevConnectorScope,
  type JevPrefill,
  type JevQueueData,
  type JevReviewState,
} from "./jev-review";

export const JEV_REVIEW_SAMPLE: JevPrefill = {
  suggestionId: "s1",
  transactionId: "t1",
  project: { id: "p-villa", name: "וילה רעננה" },
  category: { id: "c-materials", name: "חומרים" },
};

const JEV_QUEUE_OFF: JevQueueData = { connectorOn: false, byId: {} };

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

/** Session plus a cached dashboard, or a scope bound by the caller. The read does not subscribe. */
function useJevConnectorScope(): JevConnectorScope | null {
  const { session } = useAuth();
  const books = useOptionalBooks();
  const preview = useHomePreview();
  const client = useQueryClient();
  const userId = session?.user.id ?? null;
  const cached = books == null ? undefined : client.getQueryData(["dashboard", preview, books.period]);
  const companyId = companyIdFrom(cached);
  const hooked = userId != null && companyId != null ? { userId, companyId } : null;
  if (hooked) bindJevConnectorScope(hooked);
  return hooked ?? boundJevConnectorScope();
}

/**
 * One read for every open line. A remembered on only waits. The prefill applies
 * after a connector read from this session, and a failed read is off.
 */
export function useJevQueue(transactionIds: readonly string[], live: boolean) {
  const readable = live && jevReadable() && transactionIds.some((id) => id !== "");
  const scope = useJevConnectorScope();
  const remembered = readable && scope != null && readJevConnectorFlag(scope) === true;
  const connector = useQuery({
    queryKey: jevConnectorQueryKey(scope),
    enabled: readable,
    retry: false,
    staleTime: JEV_CONNECTOR_STALE_MS,
    queryFn: ({ signal }) => fetchJevConnector(signal),
  });
  const confirmed = connector.isSuccess && connector.dataUpdatedAt > 0;
  const knownOn = confirmed && connector.data;
  const waiting = remembered && !confirmed && !connector.isError;
  const suggestions = useQuery({
    queryKey: jevQueueQueryKey(transactionIds),
    enabled: readable && knownOn,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => withJevDeadline(
      signal,
      (linked) => loadJevSuggestions(transactionIds, linked),
      JEV_QUEUE_OFF,
    ),
  });
  function loadingFor(transactionId: string | null): boolean {
    if (waiting) return true;
    if (connector.isError || !knownOn || suggestions.isError) return false;
    if (suggestions.isPending || transactionId == null) return suggestions.isPending;
    return suggestions.isFetching
      && !Object.prototype.hasOwnProperty.call(suggestions.data.byId, transactionId);
  }
  function stateFor(transactionId: string | null): JevReviewState {
    if (waiting || connector.isError || !knownOn || suggestions.isError || suggestions.data == null || loadingFor(transactionId)) {
      return JEV_REVIEW_OFF;
    }
    return {
      connectorOn: suggestions.data.connectorOn,
      prefill: transactionId == null ? null : (suggestions.data.byId[transactionId] ?? null),
    };
  }
  return { loadingFor, stateFor };
}

export function JevReviewCard({
  connectorOn,
  prefill,
  supplier = "חומרי בניין השרון בע״מ",
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
          ...(project ? { project: project.name, projectSuggested: true } : {}),
          ...(category ? { category: category.name, categorySuggested: true } : {}),
        } : undefined}
        onProject={() => undefined}
        onCategory={() => undefined}
      />
      <div className="ui-review-actions">
        <Button full disabled={!canApprove} icon={<CheckIcon />}>
          אישור
        </Button>
      </div>
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
      supplier="חומרי בניין השרון בע״מ"
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

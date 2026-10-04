import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "../ui/button";
import { CheckIcon } from "../ui/icons";
import { ReviewCard } from "../ui/review-card";
import {
  JEV_CONNECTOR_STALE_MS,
  JEV_REVIEW_OFF,
  jevConnectorQueryKey,
  jevQueueQueryKey,
  jevReadable,
  loadJevConnector,
  loadJevReview,
  loadJevSuggestions,
  withJevDeadline,
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

/** One read for every open line. Pending only after the connector is already known on. */
export function useJevQueue(transactionIds: readonly string[], live: boolean) {
  const readable = live && jevReadable() && transactionIds.some((id) => id !== "");
  const connector = useQuery({
    queryKey: jevConnectorQueryKey,
    enabled: readable,
    retry: false,
    staleTime: JEV_CONNECTOR_STALE_MS,
    queryFn: ({ signal }) => withJevDeadline(signal, loadJevConnector, false),
  });
  const knownOn = connector.data === true;
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
    if (!knownOn || suggestions.isError) return false;
    if (suggestions.isPending || transactionId == null) return suggestions.isPending;
    return suggestions.isFetching && !Object.prototype.hasOwnProperty.call(suggestions.data.byId, transactionId);
  }
  function stateFor(transactionId: string | null): JevReviewState {
    if (!knownOn || suggestions.isError || suggestions.data == null || loadingFor(transactionId)) return JEV_REVIEW_OFF;
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

export function JevReviewE2e() {
  const [params] = useSearchParams();
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

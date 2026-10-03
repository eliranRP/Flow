import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "../ui/button";
import { CheckIcon } from "../ui/icons";
import { ReviewCard } from "../ui/review-card";
import {
  JEV_REVIEW_OFF,
  loadJevReview,
  type JevPrefill,
  type JevReviewState,
} from "./jev-review";

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
    queryFn: () => loadJevReview(transactionId ?? ""),
  });
  const loading = live && transactionId != null && transactionId !== "" && query.isPending;
  if (!live || query.isError || !query.data) return { ...JEV_REVIEW_OFF, loading };
  return { ...query.data, loading };
}

export function JevReviewCard({
  connectorOn,
  prefill,
}: {
  connectorOn: boolean;
  prefill: JevPrefill | null;
}) {
  const project = connectorOn ? prefill?.project ?? null : null;
  const category = connectorOn ? prefill?.category ?? null : null;
  const canApprove = project != null && category != null;

  return (
    <div>
      <ReviewCard
        supplier="חומרי בניין השרון בע״מ"
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

export function JevReviewE2e() {
  const [params] = useSearchParams();
  const on = params.get("on") === "1";
  return <JevReviewCard connectorOn={on} prefill={JEV_REVIEW_SAMPLE} />;
}

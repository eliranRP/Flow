import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../ui/button";
import { ChangeAssignment, type ChangeChoice } from "../ui/change-sheet";
import { CheckIcon } from "../ui/icons";
import { ReviewCard } from "../ui/review-card";
import {
  JEV_REVIEW_OFF,
  jevCorrectionFor,
  loadJevReview,
  withJev,
  type JevCorrection,
  type JevPrefill,
  type JevReviewState,
} from "./jev-review";

const EMPTY = {
  transaction_id: "t1",
  direction: "expense" as const,
  project_id: null,
  category_id: null,
  project_name: null,
  category_name: null,
  reason: null,
};

export const JEV_REVIEW_SAMPLE: JevPrefill = {
  suggestionId: "s1",
  transactionId: "t1",
  project: { id: "p-villa", name: "וילה רעננה" },
  category: { id: "c-materials", name: "חומרים" },
};

const PROJECTS: ChangeChoice[] = [
  { id: "p-villa", name: "וילה רעננה", status: "active" },
  { id: "p-other", name: "שיפוץ הרצל 12", status: "active" },
];

const CATEGORIES: ChangeChoice[] = [
  { id: "c-materials", name: "חומרים" },
  { id: "c-haul", name: "הובלה" },
];

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
  onCorrection,
}: {
  connectorOn: boolean;
  prefill: JevPrefill | null;
  onCorrection?: (correction: JevCorrection) => void;
}) {
  const state: JevReviewState = { connectorOn, prefill };
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [corrections, setCorrections] = useState<JevCorrection[]>([]);
  const base = { ...EMPTY, transaction_id: prefill?.transactionId ?? EMPTY.transaction_id };
  const filled = withJev(base, state);
  const projectName = pickedProject == null
    ? filled.project_name
    : (PROJECTS.find((item) => item.id === pickedProject)?.name ?? pickedProject);
  const categoryName = pickedCategory == null
    ? filled.category_name
    : (CATEGORIES.find((item) => item.id === pickedCategory)?.name ?? pickedCategory);
  const view = {
    project_id: pickedProject ?? filled.project_id,
    category_id: pickedCategory ?? filled.category_id,
    project_name: projectName,
    category_name: categoryName,
    project_suggested: pickedProject == null && filled.project_suggested === true,
    category_suggested: pickedCategory == null && filled.category_suggested === true,
  };
  const project = view.project_name ?? undefined;
  const category = view.category_name ?? undefined;
  const canApprove = view.project_id != null && view.category_id != null;

  function record(chosen: { projectId: string | null; categoryId: string | null }) {
    const correction = jevCorrectionFor(base, state, chosen);
    if (!correction) return;
    setCorrections((list) => [...list, correction]);
    onCorrection?.(correction);
  }

  return (
    <div>
      <ReviewCard
        supplier="חומרי בניין השרון בע״מ"
        sourceLine="הוצאה · 12/04/2026"
        netAgorot={-2_200_000n}
        vatLine="לפני מע״מ · מע״מ ₪3,960"
        suggestion={project || category ? {
          ...(project ? { project } : {}),
          ...(category ? { category } : {}),
          ...(view.project_suggested ? { projectSuggested: true } : {}),
          ...(view.category_suggested ? { categorySuggested: true } : {}),
        } : undefined}
        onProject={() => { setSheet(true); }}
        onCategory={() => { setSheet(true); }}
      />
      <div className="ui-review-actions">
        <Button
          full
          disabled={!canApprove}
          icon={<CheckIcon />}
          onClick={() => {
            record({ projectId: view.project_id, categoryId: view.category_id });
          }}
        >
          אישור
        </Button>
      </div>
      <ChangeAssignment
        host="overlay"
        open={sheet}
        onOpenChange={setSheet}
        contained
        supplier="חומרי בניין השרון בע״מ"
        amount="₪22,000"
        direction="expense"
        projects={PROJECTS}
        categories={CATEGORIES}
        projectId={view.project_id ?? ""}
        categoryId={view.category_id ?? ""}
        suggestionProjectId={view.project_suggested ? (view.project_id ?? "") : ""}
        suggestionCategoryId={view.category_suggested ? (view.category_id ?? "") : ""}
        onProjectId={setPickedProject}
        onCategoryId={setPickedCategory}
        categorySuggested={view.category_suggested}
        onCommitPick={(kind, id) => {
          const projectId = kind === "project" ? id : view.project_id;
          const categoryId = kind === "category" ? id : view.category_id;
          if (kind === "project") setPickedProject(id);
          else setPickedCategory(id);
          record({ projectId, categoryId });
          return Promise.resolve(undefined);
        }}
        onSplit={() => undefined}
        onCreateProject={(name) => Promise.resolve({ id: "p-new", name })}
      />
      <pre hidden id="jev-corrections">{JSON.stringify(corrections)}</pre>
    </div>
  );
}

export function JevReviewE2e() {
  const [params] = useSearchParams();
  const on = params.get("on") === "1";
  return <JevReviewCard connectorOn={on} prefill={JEV_REVIEW_SAMPLE} />;
}

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { getSupabase } from "../lib/supabase";
import { useHomePreview } from "../preview";
import { useHoldWrites } from "../use-is-viewer";
import { useInvalidateBooks } from "../use-books";
import { assertNoError } from "../use-write";
import { waitForAccessToken } from "../wait-for-session";
import { ReviewSkippedList, SKIPPED_SECTION_ID, type SkippedRowView } from "../ui/review-skipped-list";
import { statementMethodOf } from "../ui/statement";
import { useToast } from "../ui/toast";

const minorSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform((value) => BigInt(value));

/** One row of rpc `list_skipped_review` (20261009234000_skipped_review_list.sql). */
export const skippedReviewRowSchema = z.object({
  id: z.string(),
  transaction_id: z.string(),
  description: z.string(),
  doc_date: z.string(),
  doc_kind: z.string().nullable().optional(),
  amount_net: minorSchema,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  direction: z.enum(["income", "expense"]),
  line_status: z.enum(["pending", "posted", "void"]).nullable().optional().catch(undefined),
  source: z.enum(["sumit", "mercury", "manual", "photo"]).nullable().optional().catch(undefined),
  project_name: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  supplier_name: z.string().nullable().optional(),
  skipped_at: z.string().nullable().optional(),
});

export type SkippedReviewRow = z.infer<typeof skippedReviewRowSchema>;

export const SKIPPED_REVIEW_KEY = "review-skipped";

export function skippedReviewQueryKey(preview: string) {
  return [SKIPPED_REVIEW_KEY, preview] as const;
}

/** The skipped cards, newest skip first. Preview and sample screens do not read it. */
export function useSkippedReviewQuery(active = true) {
  const preview = useHomePreview();
  return useQuery({
    queryKey: skippedReviewQueryKey(preview),
    enabled: active && preview === "off",
    retry: false,
    // A seeded list (stories, a just-written reopen) is not read again on every mount.
    staleTime: 30_000,
    queryFn: async (): Promise<SkippedReviewRow[]> => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      await waitForAccessToken(supabase);
      const { data, error } = await supabase.rpc("list_skipped_review");
      if (error) throw error;
      return skippedReviewRowSchema.array().parse(data);
    },
  });
}

/** "project · category" for the statement row's ✦ line, the same as the pending rows. */
function skippedSuggestion(row: SkippedReviewRow): string | null {
  const parts = [row.project_name, row.category_name].filter((part): part is string => part != null && part !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

export function skippedRowView(row: SkippedReviewRow, search: string): SkippedRowView {
  return {
    id: row.id,
    title: row.supplier_name ?? row.description,
    fallback: row.source === "mercury" ? "bank" : "invoice",
    method: statementMethodOf(row.source ?? undefined, row.doc_kind ?? undefined),
    suggestion: skippedSuggestion(row),
    pending: row.line_status === "pending",
    agorot: row.amount_net,
    currency: row.currency ?? undefined,
    sign: row.direction === "income" ? "in" : "out",
    href: `/transactions/${row.transaction_id}${search}`,
  };
}

/** What a reopen refreshes: the queue, this list, and a project's waiting list. */
export const SKIPPED_REOPEN_KEYS = ["review", SKIPPED_REVIEW_KEY, "project-waiting"];
export const SKIPPED_REOPEN_DONE = "הפריט חזר לתור.";
export const SKIPPED_REOPEN_TO_CARD = "לכרטיס";
export const SKIPPED_REOPEN_FAILED = "לא הצלחנו להחזיר לתור.";

/**
 * FLOW-309, option A: the last block of הצג הכול. Loading and an empty list render nothing, so
 * nothing above it moves. החזרה לתור calls `reopen_review`, which only reopens a skipped row.
 */
export function ReviewSkippedSection({
  search,
  cardPath,
}: {
  search: string;
  /** The card of a reopened row in the queue. */
  cardPath: (id: string) => string;
}) {
  const skipped = useSkippedReviewQuery();
  const holdWrites = useHoldWrites();
  const invalidate = useInvalidateBooks();
  const toast = useToast();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { hash } = useLocation();
  const shown = skipped.isError || (skipped.data?.length ?? 0) > 0;
  // The empty queue's "N פריטים דולגו" opens here: bring the heading into view and focus it.
  useEffect(() => {
    if (hash !== `#${SKIPPED_SECTION_ID}` || !shown) return;
    const section = document.getElementById(SKIPPED_SECTION_ID);
    // jsdom has no scrollIntoView.
    if (section && "scrollIntoView" in section) section.scrollIntoView({ block: "start" });
    section?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [hash, shown]);
  if (skipped.isError) {
    return (
      <ReviewSkippedList
        state="error"
        rows={[]}
        retrying={skipped.isFetching}
        onRetry={() => { void skipped.refetch(); }}
      />
    );
  }
  const rows = skipped.data ?? [];
  if (rows.length === 0) return null;
  async function reopen(id: string) {
    setBusyId(id);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("reopen_review", { p_id: id }));
      await invalidate(SKIPPED_REOPEN_KEYS);
      toast.show({
        message: SKIPPED_REOPEN_DONE,
        action: SKIPPED_REOPEN_TO_CARD,
        onAction: () => { void navigate(cardPath(id)); },
      });
    } catch {
      toast.show({
        tone: "bad",
        message: SKIPPED_REOPEN_FAILED,
        action: "ניסיון חוזר",
        onAction: () => { void reopen(id); },
      });
    } finally {
      setBusyId(null);
    }
  }
  return (
    <ReviewSkippedList
      state="rows"
      rows={rows.map((row) => skippedRowView(row, search))}
      busyId={busyId}
      onReopen={holdWrites ? undefined : (id) => { void reopen(id); }}
    />
  );
}

/** The link to the skipped cards in הצג הכול. */
export function skippedListPath(listPath: string): string {
  return `${listPath}#${SKIPPED_SECTION_ID}`;
}

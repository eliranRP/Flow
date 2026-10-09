import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

/**
 * What a reopen refreshes: the queue, this list, and every count of what waits for review
 * (home, a project and its categories, a project's waiting list, the transaction).
 */
export const SKIPPED_REOPEN_KEYS = ["review", SKIPPED_REVIEW_KEY, "dashboard", "project", "project-category", "project-waiting", "txn"];
export const SKIPPED_REOPEN_DONE = "הפריט חזר לתור.";
export const SKIPPED_REOPEN_TO_CARD = "לכרטיס";
export const SKIPPED_REOPEN_FAILED = "לא הצלחנו להחזיר לתור.";

/**
 * FLOW-309, option A: the last block of הצגת הכול. Loading and an empty list render nothing, so
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
  // After a reopen the row leaves the list: focus moves to the row that takes its place.
  const focusAfter = useRef<{ gone: string; next: string | null } | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (target == null || skipped.data == null) return;
    if (skipped.data.some((row) => row.id === target.gone)) return;
    focusAfter.current = null;
    focusAfterReopen(target.next);
  }, [skipped.data]);
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
    const at = rows.findIndex((row) => row.id === id);
    const next = rows[at + 1] ?? rows[at - 1] ?? null;
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("reopen_review", { p_id: id }));
      focusAfter.current = { gone: id, next: next?.id ?? null };
      await invalidate(SKIPPED_REOPEN_KEYS);
      toast.show({
        message: SKIPPED_REOPEN_DONE,
        action: SKIPPED_REOPEN_TO_CARD,
        onAction: () => { void navigate(cardPath(id)); },
      });
    } catch {
      // The row may have left the list on another device: read it again.
      void invalidate([SKIPPED_REVIEW_KEY]);
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

/**
 * Focus after a reopen: the next row's החזרה לתור, else the section heading, else the page
 * heading, so focus never falls back to the body.
 */
function focusAfterReopen(nextId: string | null) {
  const section = document.getElementById(SKIPPED_SECTION_ID);
  const button = nextId == null
    ? null
    : section?.querySelector<HTMLElement>(`[data-skipped-id="${CSS.escape(nextId)}"] .ui-review-skipped-action button`);
  const target = button
    ?? section?.querySelector<HTMLElement>("h2")
    ?? document.querySelector<HTMLElement>("main .ui-focus-title, .ui-page .ui-focus-title");
  target?.focus({ preventScroll: true });
}

/** The link to the skipped cards in הצגת הכול. */
export function skippedListPath(listPath: string): string {
  return `${listPath}#${SKIPPED_SECTION_ID}`;
}

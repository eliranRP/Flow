/** A list_review_page answer for the tests: the rows as one page that holds them all. */
export function reviewPage<T>(items: readonly T[], extra: { total?: number; next?: { doc_date: string; created_at: string; id: string } | null } = {}) {
  return { items, total: extra.total ?? items.length, next: extra.next ?? null };
}

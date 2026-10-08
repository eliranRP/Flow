/** One review card opened from הצג הכול: Back returns to the list. */
export function reviewFocusPath(search: string, id: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("pick");
  params.delete("list");
  params.set("item", id);
  params.set("from", "all");
  return `/review?${params.toString()}`;
}

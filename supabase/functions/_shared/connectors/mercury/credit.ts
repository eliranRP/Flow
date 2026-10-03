/**
 * GET /credit, observed 2026-10-03. Not in the three generated reference
 * pages, so openapi-typescript does not emit it. Ids only: the card payload
 * can carry numbers and emails, and those fields are not in this type.
 */
export interface MercuryCreditAccount {
  id: string;
  status?: string;
}

export interface MercuryCreditResponse {
  accounts: MercuryCreditAccount[];
}

export const CSP_PLACEHOLDER: string;
export function inlineScripts(html: string): string[];
export function scriptHash(source: string): string;
export function supabaseOrigin(url: string | undefined): string | null;
export function buildCsp(input: { html: string; supabaseUrl?: string }): string;
export function fillCsp(headers: string, csp: string): string;
export function parseHeaders(text: string): Map<string, Map<string, string>>;

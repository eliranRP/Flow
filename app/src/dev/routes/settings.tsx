import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SAMPLE_ASSISTANT_SECRET as assistantSampleSecret } from "../../assistant-sample";
import { AiConnectionPage } from "../../screens/assistant-settings";
import { BusinessScreen } from "../../screens/business-screen";
import { MercuryConnectionRoute, SumitConnectionRoute } from "../../screens/connection-pages";
import { CategoriesScreen, ConnectionsScreen, SettingsScreen } from "../../screens/flow-screens";
import { NotificationsScreen } from "../../screens/notifications-screen";
import { writeThemeChoice } from "../../theme-store";
import type { DevRoute } from "./types";

/** Dev-only. A production build drops the sample secret with this flag. */
const devAssistantSecret = import.meta.env.DEV ? assistantSampleSecret : undefined;

/**
 * FLOW-512 proof: `?sheet=rename` (on the business page) or `?sheet=theme` (on Settings) taps the
 * row that opens the sheet, once it has drawn. `rename` also types an invented name, as the board's frame has.
 */
function OpenSettingsSheet() {
  const [params] = useSearchParams();
  useEffect(() => {
    const sheet = params.get("sheet");
    if (sheet !== "rename" && sheet !== "theme") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const row = document.querySelector<HTMLButtonElement>(sheet === "rename" ? 'button[aria-label^="שם העסק:"]' : 'button[aria-label^="מראה:"]');
      if (row) {
        row.click();
        window.clearInterval(timer);
        if (sheet === "rename") fillRenameDraft();
      } else if (Date.now() - started > 4000) {
        window.clearInterval(timer);
      }
    }, 100);
  }, [params]);
  return null;
}

function fillRenameDraft() {
  const started = Date.now();
  const timer = window.setInterval(() => {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input');
    if (field) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "Cedar Lane Homes LLC");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      window.clearInterval(timer);
    } else if (Date.now() - started > 4000) {
      window.clearInterval(timer);
    }
  }, 100);
}

/** The notifications page on the board's preset: one switch on, one off, one on (no push support needed to draw it). */
export function DevNotifications() {
  return (
    <NotificationsScreen
      sample={{ new_transaction: true, evening_reminder: false, weekly_summary: true, prompt_answered: true, has_subscription: true }}
      support="ok"
    />
  );
}

export function DevSettings() {
  // The board's theme frame has its own mode selected: כהה in the dark frame, בהיר in the light one.
  useState(() => {
    if (new URLSearchParams(window.location.search).get("sheet") === "theme") {
      writeThemeChoice(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
    return null;
  });
  return (
    <>
      <OpenSettingsSheet />
      <SettingsScreen sample={useDevSettingsSample()} />
    </>
  );
}

export function DevConnections() {
  return <ConnectionsScreen sample={useDevSettingsSample()} sampleSecret={devAssistantSecret} />;
}

/** The SUMIT page on the dev fixture: connected, `?state=problem` for a key that stopped working, or `?state=new`. */
export function DevSumitConnection() {
  const [params] = useSearchParams();
  const state = params.get("state");
  if (state === "new") return <SumitConnectionRoute sample={{ state: "new" }} />;
  return <SumitConnectionRoute sample={state === "problem" ? { state: "problem", companyId: "1234567890" } : { state: "connected", companyId: "1234567890", lastSync: "היום, 06:05", imported: "312 מסמכים" }} />;
}

/** The Mercury page on the dev fixture: connected, or `?state=new` for a page with no key yet. */
export function DevMercuryConnection() {
  const [params] = useSearchParams();
  if (params.get("state") === "new") return <MercuryConnectionRoute sample={{ state: "new" }} />;
  return <MercuryConnectionRoute sample={{ state: "connected", accounts: "Checking ••4821 · Savings ••1093", cards: "IO Credit ••7710", lastSync: "לפני 5 דקות", imported: "1,284 תנועות" }} />;
}

/** The business page on the dev settings fixture: its name is the fixture's, and its rename sheet opens from it. */
export function DevBusiness() {
  return (
    <>
      <OpenSettingsSheet />
      <BusinessScreen sample={useDevSettingsSample()} />
    </>
  );
}

/** The AI connection page on the dev settings fixture (`?assistant=…`), so a mint shows its code without the server. `?mint=1` opens the code step. */
export function DevAiConnection() {
  const [params] = useSearchParams();
  const initialSecret = params.get("mint") === "1" && devAssistantSecret != null
    ? { id: "mcp-sample", secret: devAssistantSecret, scope: ["read", "write"] }
    : undefined;
  return <AiConnectionPage sample={useDevSettingsSample()?.assistant} sampleSecret={devAssistantSecret} initialSecret={initialSecret} />;
}

/** The dev Settings fixture. `?connected=1|auth`, `?assistant=…`, `?nocompany=1`, `?email=none|long`, `?loans=none`. */
export function useDevSettingsSample(): NonNullable<Parameters<typeof SettingsScreen>[0]>["sample"] {
  const [params] = useSearchParams();
  const mode = params.get("connected");
  const connected = mode === "1" || mode === "auth";
  const assistant = params.get("assistant");
  const noCompany = params.get("nocompany") === "1";
  const emailParam = params.get("email");
  // FLOW-601 (mockup a-1-settings): ?team=3 shows the owner's צוות row with that count.
  const teamParam = params.get("team");
  const email = emailParam === "none"
    ? ""
    : emailParam === "long"
      ? "owner.with.a.very.long.mailbox.name@example.com"
      : "owner@example.com";
  // FLOW-512 proof: ?board=1 gives the Settings board's own numbers (an invented business name).
  const board = params.get("board") === "1" && !noCompany;
  return {
        name: noCompany ? null : board ? "Cedar Lane Homes" : "בדיקה",
        connected: noCompany ? false : connected,
        companyId: connected ? 1001 : null,
        lastError: board ? "sumit_auth" : mode === "auth" ? "sumit_auth" : null,
        email,
        noCompany,
        teamCount: board ? 2 : teamParam == null || noCompany ? undefined : Number(teamParam),
        companyCount: board ? 2 : undefined,
        categoryCount: board ? 12 : undefined,
        notifications: board
          ? { new_transaction: true, evening_reminder: false, weekly_summary: true, prompt_answered: true, has_subscription: true }
          : undefined,
        assistant: noCompany
          ? { state: "no-company" }
          : assistant === "connected"
          ? { state: "connected", scope: "read_write", lastUsedAt: "2026-09-30T11:05:00.000Z", expiresAt: "2027-01-09T00:00:00.000Z", id: "mcp-1" }
          : assistant === "expired"
            ? { state: "expired", scope: "read", id: "mcp-1" }
            : assistant === "loading"
              ? { state: "loading" }
              : assistant === "error"
                ? { state: "error" }
                : assistant === "nocompany"
                  ? { state: "no-company" }
                  : { state: "empty" },
  };
}

export function DevCategories() {
  // FLOW-513 fixture: the board's Settings › קטגוריות frame (SettingsCategories), same names, counts and order.
  // `hidden=1` (the e2e flow only) adds one hidden category, so the hidden footer and its un-hide step run.
  const [params] = useSearchParams();
  const hidden = params.get("hidden") === "1";
  return (
    <CategoriesScreen
      listPath="/e2e/categories"
      sample={[
        { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false, count: 142, in_rehab: true, rehab: true },
        { id: "c2", name: "עבודה", kind: "expense", hidden: false, is_default: false, count: 61, rollup_lines: 61, children_count: 3, in_rehab: true, rehab: true },
        { id: "c3", name: "קבלנים", kind: "expense", hidden: false, is_default: false, count: 0, parent_id: "c2", in_rehab: true, rehab: true },
        { id: "c4", name: "חשמלאי", kind: "expense", hidden: false, is_default: false, count: 0, parent_id: "c2", in_rehab: true, rehab: true },
        { id: "c5", name: "שרברבות", kind: "expense", hidden: false, is_default: false, count: 0, parent_id: "c2", in_rehab: true, rehab: true },
        { id: "c6", name: "תיקונים ותחזוקה", kind: "expense", hidden: false, is_default: false, count: 38, in_rehab: false },
        { id: "c7", name: "חשמל ומים", kind: "expense", hidden: false, is_default: false, count: 27, in_rehab: false },
        { id: "c8", name: "מסים וביטוח", kind: "expense", hidden: false, is_default: false, count: 24, in_rehab: false },
        { id: "c9", name: "שכר", kind: "expense", hidden: false, is_default: false, count: 20, in_rehab: false },
        { id: "c10", name: "משיכות בעלים", kind: "expense", hidden: false, is_default: false, count: 6, excluded_from_pnl: true, in_rehab: false },
        { id: "c11", name: "העברות בין חשבונות", kind: "expense", hidden: false, is_default: false, count: 9, excluded_from_pnl: true, in_rehab: false },
        { id: "c13", name: "הכנסות משכירות", kind: "income", hidden: false, is_default: false, count: 1 },
        ...(hidden ? [{ id: "c14", name: "ישנה", kind: "expense" as const, hidden: true, is_default: false, count: 0 }] : []),
      ]}
    />
  );
}

export const settingsRoutes: DevRoute[] = [
  { path: "settings", element: <DevSettings /> },
  { path: "connections", element: <DevConnections /> },
  { path: "connections/ai", element: <DevAiConnection /> },
  { path: "business", element: <DevBusiness /> },
  { path: "connections/sumit", element: <DevSumitConnection /> },
  { path: "connections/mercury", element: <DevMercuryConnection /> },
  { path: "categories", element: <DevCategories /> },
  { path: "categories/:parentId", element: <DevCategories /> },
  { path: "notifications", element: <DevNotifications /> },
];

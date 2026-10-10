import type { Dashboard } from "@flow/shared";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { defaultPeriod } from "../period";
import { attentionRows, CashHome, HomeBooks } from "../screens/HomeScreen";
import { CompanySwitcher } from "../screens/company-switcher";
import { InvitesScreen } from "../screens/invites-screen";
import { TeamScreen } from "../screens/team-screen";
import { TeamApiProvider } from "../team-api";
import { sampleCashMonths } from "./cash-sample";
import { createSampleTeamApi, type SampleTeamOptions } from "./team-sample";

/**
 * Dev-only fixtures for FLOW-601 (the design review opens these): the team page, the invites
 * list and Home's חברה sheet, on an in-memory team. Invented names and example.com only.
 */

function SampleTeam({ options, children }: { options: SampleTeamOptions; children: ReactNode }) {
  const [api] = useState(() => createSampleTeamApi({ delayMs: 400, ...options }));
  return (
    <TeamApiProvider api={api}>{children}</TeamApiProvider>
  );
}

/** `/e2e/team?team=` pending (invite-2), alone, editor, loading, error, or nothing for a-1. */
export function DevTeam() {
  const [params] = useSearchParams();
  const state = params.get("team");
  const options: SampleTeamOptions = {
    pendingInvite: state === "pending",
    alone: state === "alone",
    role: state === "editor" ? "editor" : "owner",
    hold: state === "loading" ? ["listTeam"] : undefined,
    fail: state === "error" ? { listTeam: "Failed to fetch" } : state === "full" ? { inviteMember: "too many invites" } : undefined,
  };
  return (
    <SampleTeam key={state} options={options}>
      <TeamScreen />
    </SampleTeam>
  );
}

/** `/e2e/invites?inbox=` 1, empty, loading, error, late (ביטול after ten minutes), or nothing for two (invite-3). */
export function DevInvites() {
  const [params] = useSearchParams();
  const state = params.get("inbox");
  const options: SampleTeamOptions = {
    noCompany: true,
    inbox: state === "1" ? 1 : state === "empty" ? 0 : 2,
    hold: state === "loading" ? ["myInvites"] : undefined,
    fail: state === "error" ? { myInvites: "Failed to fetch" } : state === "late" ? { reopenInvite: "invite is not declined" } : undefined,
  };
  return (
    <SampleTeam key={state} options={options}>
      <InvitesScreen />
    </SampleTeam>
  );
}

const devDashboard: Dashboard = {
  company_id: "dev-company",
  name: "חברה לדוגמה",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-08-01",
  to: "2026-10-09",
  income_agorot: 131_000_000n,
  direct_agorot: 90_000_000n,
  shared_agorot: 0n,
  overhead_agorot: 21_000_000n,
  expense_agorot: 111_000_000n,
  net_profit_agorot: 20_000_000n,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 1,
  review_count: 0,
  by_currency: [],
  projects: [
    { id: "dev-a", name: "פרויקט לדוגמה", status: "active", income_agorot: 30_000_000n, direct_agorot: 22_000_000n, shared_agorot: 0n, profit_before_shared_agorot: 8_000_000n, profit_agorot: 8_000_000n, by_currency: [] },
  ],
};

/**
 * `/e2e/company?company=` invite (invite-4), viewer, error, or nothing for two companies (a-3). Tap the name.
 * `&home=cash` draws the name on Home's cash band (FLOW-413).
 */
export function DevCompany() {
  const [params] = useSearchParams();
  const state = params.get("company");
  const [period, setPeriod] = useState(defaultPeriod());
  const options: SampleTeamOptions = {
    twoCompanies: state !== "invite",
    inbox: state === "invite" ? 1 : 0,
    role: state === "viewer" ? "viewer" : "owner",
    fail: state === "error" ? { switchCompany: "Failed to fetch" } : undefined,
  };
  if (params.get("home") === "cash") {
    return (
      <SampleTeam key={state} options={options}>
        <CashHome
          data={sampleCashMonths()}
          previewing={false}
          search=""
          attention={attentionRows({ pending: 7, unpaidCount: 3, unpaidGross: 460_000n, missingCount: 0, search: "" })}
          company={<CompanySwitcher />}
        />
      </SampleTeam>
    );
  }
  return (
    <SampleTeam key={state} options={options}>
      <HomeBooks
        data={devDashboard}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={period}
        onPeriod={setPeriod}
        company={<CompanySwitcher />}
      />
    </SampleTeam>
  );
}

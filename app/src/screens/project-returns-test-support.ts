import { STATEMENT_LINES, type PropertyReturns } from "./project-returns-data";

/** Tests: a typed returns read written back as get_property_returns sends it (snake_case, numbers). */
export function toReturnsJson(r: PropertyReturns): Record<string, unknown> {
  const n = (value: bigint | null) => (value == null ? null : Number(value));
  const at = (value: { minor: bigint; date: string } | null) => (value == null ? null : { value_minor: Number(value.minor), value_date: value.date });
  const lines: Record<string, unknown> = {};
  const byCategory: Record<string, unknown> = {};
  const st = r.statement;
  const sums = { income: st.incomeMinor, opex: st.opexMinor, debt_service: st.debtServiceMinor, capex: st.capexMinor, before_rent: st.beforeRentMinor, not_counted: st.notCountedMinor };
  // The two lines shown apart go back under one of their server lines each (0245).
  const server = { income: "income", opex: "opex", debt_service: "debt_service", capex: "capex", before_rent: "holding", not_counted: "acquisition" } as const;
  for (const line of STATEMENT_LINES) {
    if (st.counts[line] > 0) lines[server[line]] = { amount_minor: Number(sums[line]), lines: st.counts[line] };
    if (st.byCategory[line].length > 0) {
      byCategory[server[line]] = st.byCategory[line].map((item) => ({ category_id: item.id, name: item.name, amount_minor: Number(item.minor), lines: item.count }));
    }
  }
  return {
    currency: r.currency,
    from: r.from,
    to: r.to,
    first_rent: r.firstRent,
    other_currencies: r.otherCurrencies,
    missing: r.missing,
    inputs: {
      purchase_minor: n(r.inputs.purchaseMinor),
      purchase_source: r.inputs.purchaseSource,
      purchase_typed_minor: n(r.inputs.purchaseTypedMinor),
      arv_minor: n(r.inputs.arvMinor),
      value_minor: n(r.inputs.valueMinor),
      value_date: r.inputs.valueDate,
      units: r.inputs.units,
      units_default: r.inputs.unitsDefault,
      taken_over_minor: Number(r.inputs.takenOverMinor),
      taken_over_loans: r.inputs.takenOverLoans.map((loan) => ({ loan_id: loan.id, name: loan.name, principal_minor: Number(loan.minor) })),
      land_minor: n(r.inputs.landMinor),
      land_source: r.inputs.landSource,
      land_typed_minor: n(r.inputs.landTypedMinor),
      land_account: r.inputs.landAccount == null ? null : { account_id: r.inputs.landAccount.id, name: r.inputs.landAccount.name },
      land_suggestion: r.inputs.landSuggestion == null ? null : { account_id: r.inputs.landSuggestion.accountId, name: r.inputs.landSuggestion.name, amount_minor: Number(r.inputs.landSuggestion.minor) },
      tax_bracket_bp: r.inputs.taxBracketBp,
      rehab_minor: n(r.inputs.rehabMinor),
      loan_balance_minor: n(r.inputs.loanBalanceMinor),
      value_start: at(r.inputs.valueStart),
      value_end: at(r.inputs.valueEnd),
    },
    statement: {
      income_minor: Number(st.incomeMinor),
      opex_minor: Number(st.opexMinor),
      noi_minor: Number(st.noiMinor),
      debt_service_minor: Number(st.debtServiceMinor),
      capex_minor: Number(st.capexMinor),
      cash_flow_minor: Number(st.cashFlowMinor),
      before_rent_minor: Number(st.beforeRentMinor),
      not_counted_minor: Number(st.notCountedMinor),
      lines,
      by_category: byCategory,
    },
    sources: {
      cash_flow_minor: Number(r.sources.cashFlowMinor),
      principal_minor: Number(r.sources.principalMinor),
      appreciation_minor: n(r.sources.appreciationMinor),
      tax_savings_minor: n(r.sources.taxSavingsMinor),
      depreciation_year_minor: n(r.sources.depreciationYearMinor),
      building_minor: n(r.sources.buildingMinor),
      total_minor: Number(r.sources.totalMinor),
      total_bp: r.sources.totalBp,
    },
    equity: {
      equity_today_minor: n(r.equity.todayMinor),
      forced_equity_minor: n(r.equity.forcedMinor),
      money_in_minor: n(r.equity.moneyInMinor),
      money_in_parts: {
        acquisition_minor: n(r.equity.moneyInParts.acquisitionMinor),
        renovation_minor: Number(r.equity.moneyInParts.renovationMinor),
        holding_minor: Number(r.equity.moneyInParts.holdingMinor),
        financing_minor: Number(r.equity.moneyInParts.financingMinor),
      },
      all_cash_out: r.equity.allCashOut,
    },
    metrics: {
      cash_on_cash_bp: r.metrics.cashOnCashBp,
      cap_rate_bp: r.metrics.capRateBp,
      dscr_milli: r.metrics.dscrMilli,
      cash_flow_per_unit_month_minor: Number(r.metrics.perUnitMonthMinor),
    },
  };
}

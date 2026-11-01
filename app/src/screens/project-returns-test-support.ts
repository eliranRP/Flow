import { STATEMENT_LINES, type PropertyReturns } from "./project-returns-data";

/** Tests: a typed returns read written back as get_property_returns sends it (snake_case, numbers). */
export function toReturnsJson(r: PropertyReturns): Record<string, unknown> {
  const n = (value: bigint | null) => (value == null ? null : Number(value));
  const at = (value: { minor: bigint; date: string } | null) => (value == null ? null : { value_minor: Number(value.minor), value_date: value.date });
  const lines: Record<string, unknown> = {};
  const byCategory: Record<string, unknown> = {};
  const st = r.statement;
  const sums = { income: st.incomeMinor, opex: st.opexMinor, debt_service: st.debtServiceMinor, capex: st.capexMinor, not_counted: st.notCountedMinor };
  for (const line of STATEMENT_LINES) {
    if (st.counts[line] > 0) lines[line] = { amount_minor: Number(sums[line]), lines: st.counts[line] };
    if (st.byCategory[line].length > 0) {
      byCategory[line] = st.byCategory[line].map((item) => ({ category_id: item.id, name: item.name, amount_minor: Number(item.minor), lines: item.count }));
    }
  }
  return {
    currency: r.currency,
    from: r.from,
    to: r.to,
    days: r.days,
    other_currencies: r.otherCurrencies,
    missing: r.missing,
    inputs: {
      purchase_minor: n(r.inputs.purchaseMinor),
      arv_minor: n(r.inputs.arvMinor),
      value_minor: n(r.inputs.valueMinor),
      value_date: r.inputs.valueDate,
      units: r.inputs.units,
      land_minor: n(r.inputs.landMinor),
      tax_bracket_bp: r.inputs.taxBracketBp,
      rehab_minor: n(r.inputs.rehabMinor),
      borrowed_minor: n(r.inputs.borrowedMinor),
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
    equity: { equity_today_minor: n(r.equity.todayMinor), forced_equity_minor: n(r.equity.forcedMinor), money_in_minor: n(r.equity.moneyInMinor) },
    metrics: {
      cash_on_cash_bp: r.metrics.cashOnCashBp,
      cap_rate_bp: r.metrics.capRateBp,
      dscr_milli: r.metrics.dscrMilli,
      cash_flow_per_unit_month_minor: n(r.metrics.perUnitMonthMinor),
    },
  };
}

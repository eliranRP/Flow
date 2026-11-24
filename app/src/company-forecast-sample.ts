import { cardOfForecast, restOfForecast, type NextMonthCard, type RestOfYearTotals } from "./company-forecast-map";
import { companyCashForecast, companyNextMonthForecast } from "./company-next-month";
import type { CompanyNextMonthSample } from "./company-next-month-query";
import { companyMonthForecast, companyMonthInput, companyRestOfYear } from "./company-year-forecast";
import { incomeFactsOf } from "./next-month-chart";
import { nextMonthKey } from "./project-next-month";
import type { CompanyCashNextMonth } from "./screens/company-cash-next-month";

/**
 * FLOW-1308: what a story, a test or the dev fixture hands the screens (a CompanyNextMonthSample: the reads the screens made before
 * company_forecast) built by the TypeScript builders, as the screens drew it. The live screens read company_forecast instead;
 * the builders stay for these, and company-forecast-map.test.ts holds the two equal.
 */

const inputOf = (sample: CompanyNextMonthSample, currency: string, today: string) => ({ currency, today, recurring: sample.recurring, loans: sample.loans, categories: sample.categories, inputs: sample.inputs });

/** A month's page from a sample: the forecast in cash and in profit terms. */
export function sampleCashNextMonth(sample: CompanyNextMonthSample, currency: string, today: string, month: string): CompanyCashNextMonth {
  const profit = companyMonthForecast(inputOf(sample, currency, today), month);
  return {
    forecast: companyCashForecast(profit),
    profit,
    loading: false,
    failed: false,
    paused: false,
    refetch: () => Promise.resolve(),
    incomeFacts: incomeFactsOf(profit.rows, sample.categories),
    overrides: null,
    profitMinor: profit.netMinor,
  };
}

/** Profit's next-month card from a sample. */
export function sampleCard(sample: CompanyNextMonthSample, currency: string, today: string): NextMonthCard {
  return cardOfForecast(companyNextMonthForecast(companyMonthInput(inputOf(sample, currency, today), nextMonthKey(today))), sample.categories);
}

/** The year view's card from a sample; null in December. */
export function sampleRest(sample: CompanyNextMonthSample, currency: string, today: string): RestOfYearTotals | null {
  const rest = companyRestOfYear(inputOf(sample, currency, today));
  return rest == null ? null : restOfForecast(rest, sample.categories);
}

import { describe, expect, it } from "vitest";
import { FORECAST_HORIZON_MONTHS, forecastLastMonth, forecastMonths, inForecastHorizon } from "./forecast-horizon.ts";

describe("the forecast horizon", () => {
  it("runs from next month through the same month next year", () => {
    expect(FORECAST_HORIZON_MONTHS).toBe(12);
    expect(forecastLastMonth("2026-11-06")).toBe("2027-11");
    expect(forecastLastMonth("2026-12")).toBe("2027-12");
    const months = forecastMonths("2026-11-06");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-12");
    expect(months.at(-1)).toBe("2027-11");
    expect(forecastMonths("2026-01-31")[11]).toBe("2027-01");
  });

  it("holds only the months after this one, up to the last", () => {
    expect(inForecastHorizon("2026-12", "2026-11-06")).toBe(true);
    expect(inForecastHorizon("2027-11", "2026-11-06")).toBe(true);
    expect(inForecastHorizon("2027-12", "2026-11-06")).toBe(false);
    expect(inForecastHorizon("2026-11", "2026-11-06")).toBe(false);
    expect(inForecastHorizon("2026-13", "2026-11-06")).toBe(false);
    expect(inForecastHorizon("soon", "2026-11-06")).toBe(false);
  });
});

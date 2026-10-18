import { useSearchParams } from "react-router-dom";
import { ForecastScreen } from "../../screens/forecast-screen";
import { monthForecastBoardSample, monthForecastSample } from "../../forecast-sample";
import type { DevRoute } from "./types";

/**
 * FLOW-141: the forecast on invented fixture data; `?kind=positive|negative|moved` picks the state.
 * `/e2e/forecast/item/<key>` opens a row's page, as the app's `/forecast/item/<key>` does; `?when=1` opens its When sheet.
 */
export function DevForecast() {
  const [params] = useSearchParams();
  // `board` is the USD company that matches the MonthForecast board frame; `state=changed|empty|category` the others.
  if (params.get("kind") === "board") {
    const state = params.get("state");
    const variant = state === "changed" || state === "empty" || state === "category" ? state : "board";
    return <ForecastScreen sample={monthForecastBoardSample(variant)} openWhen={params.get("when") === "1"} />;
  }
  const kind = (["positive", "negative", "moved"] as const).find((k) => k === params.get("kind")) ?? "positive";
  return <ForecastScreen sample={monthForecastSample(kind)} />;
}

export const forecastRoutes: DevRoute[] = [{ path: "forecast/*", element: <DevForecast /> }];

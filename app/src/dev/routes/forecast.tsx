import { useSearchParams } from "react-router-dom";
import { ForecastScreen } from "../../screens/forecast-screen";
import { monthForecastBoardSample, monthForecastSample } from "../../forecast-sample";
import type { DevRoute } from "./types";

/** FLOW-141: the forecast on invented fixture data; `?kind=positive|negative|moved` picks the state. */
export function DevForecast() {
  const [params] = useSearchParams();
  // `board` is the USD company that matches the MonthForecast board frame.
  if (params.get("kind") === "board") return <ForecastScreen sample={monthForecastBoardSample()} openFirst={params.get("sheet") === "1"} />;
  const kind = (["positive", "negative", "moved"] as const).find((k) => k === params.get("kind")) ?? "positive";
  return <ForecastScreen sample={monthForecastSample(kind)} />;
}

export const forecastRoutes: DevRoute[] = [{ path: "forecast", element: <DevForecast /> }];

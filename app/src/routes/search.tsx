import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const SearchScreen = lazy(() => screenLoaders.search().then((m) => ({ default: m.SearchScreen })));

/** Search across the books. Sits under the full-screen layout. */
export function SearchRoute() {
  return <Route path="search" element={<SearchScreen />} />;
}

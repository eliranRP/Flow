import { lazy } from "react";
import { Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

/** The add sheet. It opens over Home, and also as a sheet over other screens (App.tsx's background block). */
export const AddForm = lazy(() => screenLoaders.addForm().then((m) => ({ default: m.AddForm })));

export function AddRoute() {
  return <Route path="add" element={<AddForm />} />;
}

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { startHomeReads } from "./home-early-reads";
import { createQueryClient } from "./query-client";
import { applyThemeChoice, readThemeChoice } from "./theme-store";
import "./styles/app.css";

applyThemeChoice(readThemeChoice());

// FLOW-843: the deploy watch starts at launch, so a page found behind reloads before the first tap.
// Its own chunk keeps it out of Home's entry; a tap while it loads still counts.
let touched = false;
const onFirstTouch = () => {
  touched = true;
};
window.addEventListener("pointerdown", onFirstTouch, { capture: true, once: true });
window.addEventListener("keydown", onFirstTouch, { capture: true, once: true });
void import("./sw-reload").then(({ watchServiceWorker }) => {
  watchServiceWorker(window, Date.now, () => touched);
}, () => undefined);

const queryClient = createQueryClient();
startHomeReads(queryClient, window.location);

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

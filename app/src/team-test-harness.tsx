import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SessionProviders } from "./session-providers";
import { BooksProvider } from "./use-books";

export * from "./team-test-client";

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

/** Renders `node` at `path` with the app's providers; `data-testid="where"` shows the current path. */
export function renderTeam(node: ReactNode, path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProviders>
          <BooksProvider>
            {node}
            <Where />
          </BooksProvider>
        </SessionProviders>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

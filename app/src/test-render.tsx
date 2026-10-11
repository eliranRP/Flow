import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { BooksProvider } from "./use-books";
import { ToastProvider } from "./ui/toast";

/**
 * Test support: renders `ui` with the providers a screen test needs (a QueryClient that does not
 * retry, the toast and books providers, and a memory router at `route`). `ui` may be a `<Routes>`
 * tree. Pass `client` to reuse one, for example to seed its cache. A data router (`RouterProvider`)
 * brings its own router, so pass `memoryRouter: false`. Returns the render result, the client, and
 * a `rerender` that keeps the providers.
 */
export function renderWithProviders(
  ui: ReactNode,
  options: { route?: string; client?: QueryClient; memoryRouter?: boolean } = {},
) {
  const client = options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          {options.memoryRouter === false ? node : <MemoryRouter initialEntries={[options.route ?? "/"]}>{node}</MemoryRouter>}
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  return {
    ...view,
    client,
    rerender: (next: ReactNode) => {
      view.rerender(wrap(next));
    },
  };
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { renderWithProviders } from "../test-render";
import { ToastProvider } from "../ui/toast";
import { BooksProvider } from "../use-books";
import { ConnectionDetailPage, type Provider } from "./connection-pages";

/** Renders the live connection page with the app's providers; `wrap` puts something beside it. */
export function renderPage(provider: Provider, options: { wrap?: (page: ReactNode) => ReactNode; route?: string; client?: QueryClient } = {}) {
  const page = <ConnectionDetailPage provider={provider} />;
  return renderWithProviders(options.wrap ? options.wrap(page) : page, { route: options.route ?? `/settings/connections/${provider}`, client: options.client });
}


/** The providers a connect hook needs (queries, toasts, books), for `renderHook`. */
export function HookProviders({ children }: { children: ReactNode }) {
  const client = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), []);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>{children}</BooksProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

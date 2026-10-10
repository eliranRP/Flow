import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter, parsePath } from "react-router-dom";
import { SessionProviders } from "../session-providers";
import { ViewerPreview } from "../use-is-viewer";
import { BooksProvider } from "../use-books";
import { TabBar } from "./tab-bar";

export function StoryRoute({
  entry,
  tabs = false,
  reviewCount = 0,
  viewer = false,
  state,
  children,
}: {
  entry: string;
  /** Location state, such as the list a transaction card was opened from. */
  state?: unknown;
  tabs?: boolean;
  reviewCount?: number;
  /** Hides write controls the way a viewer session does. */
  viewer?: boolean;
  children: ReactNode;
}) {
  const [client] = useState(() => {
    const next = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A story never reads the server: the company currency is the shekel a failed read falls back to.
    // A story for a USD company sets this key itself.
    next.setQueryData(["company-currency", "off"], "ILS");
    return next;
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[state === undefined ? entry : { ...parsePath(entry), state }]}>
        <SessionProviders>
          <BooksProvider>
            <div className="flex min-h-dvh w-full min-w-0 flex-col">
              <div className={tabs ? "below-tabbar flex min-h-0 min-w-0 flex-1 flex-col" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
                {viewer ? <ViewerPreview>{children}</ViewerPreview> : children}
              </div>
              {tabs ? <TabBar reviewCount={reviewCount} allowAdd={!viewer} /> : null}
            </div>
          </BooksProvider>
        </SessionProviders>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { TabBar } from "./tab-bar";
import { ToastProvider } from "./toast";

export function StoryRoute({
  entry,
  tabs = false,
  reviewCount = 0,
  children,
}: {
  entry: string;
  tabs?: boolean;
  reviewCount?: number;
  children: ReactNode;
}) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <AuthProvider>
          <BooksProvider>
            <div className="flex min-h-dvh w-full min-w-0 flex-col">
              <div className={tabs ? "below-tabbar flex min-h-0 min-w-0 flex-1 flex-col" : "flex min-h-0 min-w-0 flex-1 flex-col"}>{children}</div>
              {tabs ? <TabBar reviewCount={reviewCount} /> : null}
            </div>
          </BooksProvider>
        </AuthProvider>
      </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

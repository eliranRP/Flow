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
            {children}
            {tabs ? <TabBar reviewCount={reviewCount} /> : null}
          </BooksProvider>
        </AuthProvider>
      </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

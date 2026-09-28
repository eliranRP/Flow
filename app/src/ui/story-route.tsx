import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";

export function StoryRoute({ entry, children }: { entry: string; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <AuthProvider>
          <BooksProvider>{children}</BooksProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

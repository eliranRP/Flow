import type { ReactNode } from "react";
import { AuthProvider } from "./auth";
import { ToastProvider } from "./ui/toast";

/**
 * The toast sits inside the auth provider, so a user switch remounts it with
 * the rest of the app and no toast (or its retry or undo) outlives its user.
 */
export function SessionProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>{children}</ToastProvider>
    </AuthProvider>
  );
}

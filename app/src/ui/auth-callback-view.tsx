/** The line shown while the sign-in callback finishes and moves on (FLOW-308). */
export function AuthCallbackView({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-side">
      <p className="t-btn" role="status">{message}</p>
    </main>
  );
}

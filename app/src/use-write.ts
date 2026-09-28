import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { useInvalidateBooks } from "./use-books";
import { useToast } from "./ui/toast";

export function assertNoError(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

/** A write that checks the PostgREST error, stays busy, and toasts a retry. */
export function useWrite(options: {
  run: () => Promise<void>;
  keys: string[];
  success?: string;
  failure: string | ((error: Error) => string);
  onSuccess?: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const retry = useRef<() => void>(() => undefined);
  const mutation = useMutation({
    mutationFn: options.run,
    onSuccess: async () => {
      await invalidate(options.keys);
      if (options.success) toast.show({ message: options.success });
      options.onSuccess?.();
    },
    onError: (error) => {
      const failure = error instanceof Error ? error : new Error("failed");
      toast.show({
        tone: "bad",
        message: typeof options.failure === "function" ? options.failure(failure) : options.failure,
        action: "ניסיון חוזר",
        onAction: () => {
          retry.current();
        },
      });
    },
  });
  retry.current = () => {
    mutation.mutate();
  };
  return mutation;
}

import { useState } from "react";
import { ConvexError } from "convex/values";

export function useManagementOperation() {
  const [isPending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function run(operation: () => Promise<unknown>, success: string) {
    setPending(true);
    setMessage("");
    try {
      await operation();
      setMessage(success);
    } catch (cause) {
      const data: unknown = cause instanceof ConvexError ? cause.data : null;
      setMessage(
        typeof data === "string"
          ? data
          : data &&
              typeof data === "object" &&
              "message" in data &&
              typeof data.message === "string"
            ? data.message
            : "This change could not be saved. Refresh your household and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return { isPending, message, run };
}

export const managementInputClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

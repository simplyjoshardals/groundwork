"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { StreamUsage } from "@/types/ask-stream";

interface UsageValue {
  /** Today's question budget, or null when the server lookup failed. */
  usage: StreamUsage | null;
  /** The ask panel calls this with the usage that arrives on each answer. */
  publish: (usage: StreamUsage) => void;
}

const UsageContext = createContext<UsageValue | null>(null);

/**
 * Holds the question budget for the header counter. It starts from the
 * server's lookup (so there is a number before the first answer) and is
 * replaced by the fresher value on every answer.
 */
export function UsageProvider({
  initial,
  children,
}: {
  initial: StreamUsage | null;
  children: ReactNode;
}) {
  const [usage, setUsage] = useState<StreamUsage | null>(initial);
  const value = useMemo<UsageValue>(
    () => ({ usage, publish: setUsage }),
    [usage],
  );
  return <UsageContext value={value}>{children}</UsageContext>;
}

export function useUsage(): UsageValue {
  const value = useContext(UsageContext);
  if (value === null) throw new Error("useUsage needs a UsageProvider");
  return value;
}

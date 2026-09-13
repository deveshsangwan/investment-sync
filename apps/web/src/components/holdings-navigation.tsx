"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export type PositionStatus = "current" | "exited" | "all";
export type SortKey = "value" | "pnl" | "return" | "name";

export interface HoldingsView {
  search: string;
  assetClass: string;
  account: string;
  currency: string;
  status: PositionStatus;
  sort: SortKey;
  scrollY: number;
}

interface HoldingsNavigation {
  savedView: HoldingsView | null;
  saveView: (view: HoldingsView) => void;
  isReturningToHoldings: boolean;
}

const HoldingsNavigationContext = createContext<HoldingsNavigation | null>(
  null,
);

export function HoldingsNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [savedView, saveView] = useState<HoldingsView | null>(null);
  const [route, setRoute] = useState<{
    current: string;
    previous: string | null;
  }>({
    current: pathname,
    previous: null,
  });

  // Returning list components need the origin before initializing their filters.
  if (route.current !== pathname) {
    setRoute({ current: pathname, previous: route.current });

    if (
      pathname !== "/holdings" &&
      !pathname.startsWith("/dashboard/holdings/")
    ) {
      saveView(null);
    }
  }

  return (
    <HoldingsNavigationContext.Provider
      value={{
        savedView,
        saveView,
        isReturningToHoldings:
          pathname === "/holdings" &&
          route.previous?.startsWith("/dashboard/holdings/") === true,
      }}
    >
      {children}
    </HoldingsNavigationContext.Provider>
  );
}

export function useHoldingsNavigation() {
  const navigation = useContext(HoldingsNavigationContext);

  if (!navigation) throw new Error("Holdings navigation provider is missing");

  return navigation;
}

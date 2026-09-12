import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const storageKey = "investment-sync.amounts-hidden";
const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const AmountsContext = createContext({
  isHidden: true,
  isReady: false,
  toggle: () => {},
});

export function AmountsProvider({ children }: { children: ReactNode }) {
  const [isHidden, setIsHidden] = useState(true);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (isMounted) setIsHidden(value === "true");
      })
      .catch(() => {
        // Keep amounts masked when the saved preference cannot be read.
      })
      .finally(() => {
        if (isMounted) setIsReady(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function toggle() {
    if (!isReady) return;

    const next = !isHidden;
    setIsHidden(next);
    void AsyncStorage.setItem(storageKey, String(next)).catch(() => {
      // The in-memory preference still applies for this session.
    });
  }

  return (
    <AmountsContext.Provider value={{ isHidden, isReady, toggle }}>
      {children}
    </AmountsContext.Provider>
  );
}

export function useAmounts() {
  const visibility = useContext(AmountsContext);

  return {
    ...visibility,
    formatAmount: (value: number) =>
      visibility.isHidden ? "••••••" : currency.format(value),
  };
}

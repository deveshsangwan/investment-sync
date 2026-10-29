import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { MobilePortfolioProvider } from "../src/convex-provider";

export function renderScreen(screen: ReactElement) {
  return render(
    <MobilePortfolioProvider convexUrl="https://fake-native-test.convex.cloud">
      {screen}
    </MobilePortfolioProvider>,
  );
}

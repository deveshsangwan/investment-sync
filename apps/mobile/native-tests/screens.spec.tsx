/// <reference types="jest" />
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import {
  buildPortfolioPublication,
  valuePortfolioPublication,
} from "../../../packages/portfolio-domain/src/index";
import DashboardScreen from "../app/index";
import HoldingsScreen from "../app/holdings";
import { renderScreen } from "./render-screen";
import { mockPush } from "./setup";
import { testTransport } from "./transport";

function portfolioViews() {
  const publication = buildPortfolioPublication({
    existingFacts: [],
    batch: {
      id: "fake-native-batch",
      parserVersion: "fake-native-v1",
      sequence: 1,
      fallbackDate: "2026-05-16",
      rows: ["Broker one", "Broker two"].map((accountName, index) => ({
        kind: "holding",
        sourceType: "manual_snapshot",
        sourceDate: "2026-05-16",
        accountName,
        provider: "Fake broker",
        instrumentName: "Fake Company",
        symbol: index === 0 ? "FAKECO" : "FAKECO_SECOND_ACCOUNT",
        assetClass: "indian_stock",
        currency: "INR",
        investedAmount: index === 0 ? "200.25" : "150.5",
        currentValue: index === 0 ? "250.25" : "125.5",
        pnlAmount: index === 0 ? "50" : "-25",
        pnlPercent: index === 0 ? 25 : -16.61,
        source: {
          group: "Fake",
          completeness: "complete",
          granularity: "instrument",
          priority: 0,
        },
        numericProvenance: {},
        metadata: {},
      })),
    },
  });

  const valued = valuePortfolioPublication(publication.projection, {
    status: "stale",
    rate: "1",
    fetchedAt: "2026-05-16T00:00:00Z",
    provider: "frankfurter",
  });

  // Exercise a valid multi-account screen response independently of the
  // backend's cross-account source selection, which is covered in #15.
  return {
    ...valued,
    positions: {
      ...valued.positions,
      current: valued.positions.current.map((position) => ({
        ...position,
        symbol: "FAKECO",
      })),
    },
  };
}

test("overview renders a loading state until a subscription returns, then navigates to holdings", async () => {
  const screen = renderScreen(<DashboardScreen />);
  await screen.findByLabelText("Loading portfolio");
  expect(screen.queryByText("Current value")).toBeNull();

  act(() =>
    testTransport.publish("portfolio:overview", portfolioViews().overview),
  );
  await screen.findByText("Current value");
  expect(screen.getAllByText("₹376").length).toBeGreaterThan(0);
  fireEvent.press(screen.getByRole("button", { name: "Browse holdings" }));
  expect(mockPush).toHaveBeenCalledWith("/holdings");
  expect(testTransport.queries.has("portfolio:overview")).toBe(true);
});

test("the real provider's error boundary retries a failed overview subscription", async () => {
  testTransport.publish("portfolio:overview", new Error("Fake query outage"));
  const errorLog = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    const screen = renderScreen(<DashboardScreen />);
    await screen.findByText("Portfolio unavailable");
    const clientsBeforeRetry = testTransport.createdClients;
    testTransport.publish("portfolio:overview", portfolioViews().overview);
    fireEvent.press(
      screen.getByRole("button", { name: "Try connecting again" }),
    );

    await screen.findByText("Current value");
    await waitFor(() =>
      expect(testTransport.createdClients).toBeGreaterThan(clientsBeforeRetry),
    );
    expect(screen.queryByText("Portfolio unavailable")).toBeNull();
    expect(errorLog).toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
  }
});

test("an empty allocation explains how to import", async () => {
  const { overview } = portfolioViews();
  testTransport.publish("portfolio:overview", {
    ...overview,
    summary: { ...overview.summary, allocationByAssetClass: [] },
  });
  const screen = renderScreen(<DashboardScreen />);

  await screen.findByText(
    "Import data on the web app to build your allocation.",
  );
});

test("holdings keeps the same instrument in two accounts as separate positions", async () => {
  testTransport.publish("portfolio:positions", portfolioViews().positions);
  const screen = renderScreen(<HoldingsScreen />);

  await screen.findByText("Broker one · Indian Stock");
  expect(screen.getByText("Broker two · Indian Stock")).toBeTruthy();
  expect(screen.getAllByText("FAKECO")).toHaveLength(2);
  expect(screen.getByLabelText("FAKECO, ₹250, return 25%")).toBeTruthy();
  expect(screen.getByLabelText("FAKECO, ₹126, return -16.61%")).toBeTruthy();
});

test("holdings shows loading, failure, retry and the empty state through the provider", async () => {
  const screen = renderScreen(<HoldingsScreen />);
  await screen.findByLabelText("Loading holdings");
  const errorLog = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    act(() =>
      testTransport.publish("portfolio:positions", new Error("Fake outage")),
    );
    await screen.findByText("Portfolio unavailable");
    testTransport.publish("portfolio:positions", { current: [], exited: [] });
    fireEvent.press(
      screen.getByRole("button", { name: "Try connecting again" }),
    );

    await screen.findByText("No committed holdings");
    expect(errorLog).toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
  }
});

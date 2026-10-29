/// <reference types="jest" />
import { fireEvent, waitFor } from "@testing-library/react-native";
import DashboardScreen from "../app/index";
import HoldingsScreen from "../app/holdings";
import { renderScreen } from "./render-screen";
import { mockPush } from "./setup";

const summary = {
  currentValue: 375.75,
  investedAmount: 300.5,
  pnlAmount: 75.25,
  pnlPercent: 25.04,
  asOfDate: "2026-05-16",
  allocationByAssetClass: [
    { assetClass: "indian_stock", currentValue: 375.75, weight: 100 },
  ],
};

const holdings = ["Broker one", "Broker two"].map((accountName, index) => ({
  id: `fake-position-${index}`,
  instrumentName: "Fake Company",
  symbol: "FAKECO",
  accountName,
  assetClass: "indian_stock",
  snapshotDate: "2026-05-16",
  currentValueInInr: index === 0 ? 250.25 : 125.5,
  pnlAmountInInr: index === 0 ? 50 : -25,
  pnlPercent: index === 0 ? 25 : -16.61,
}));

test("overview renders a loading state until the provider returns, then navigates to holdings", async () => {
  let resolveSummary: (value: unknown) => void = () => undefined;
  const response = new Promise((resolve) => {
    resolveSummary = resolve;
  });
  const screen = renderScreen(<DashboardScreen />, () => response);

  expect(screen.getByLabelText("Loading portfolio")).toBeTruthy();
  expect(screen.queryByText("Current value")).toBeNull();

  resolveSummary(summary);
  expect(await screen.findAllByText("₹376")).toHaveLength(2);
  expect(screen.getByText("25.04%")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Browse holdings" }));
  expect(mockPush).toHaveBeenCalledWith("/holdings");
});

test("overview retries a failed request and recovers through the query provider", async () => {
  const respond = jest
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(summary);
  const screen = renderScreen(<DashboardScreen />, respond);

  await screen.findByText("Portfolio unavailable");
  fireEvent.press(
    screen.getByRole("button", { name: "Try loading the portfolio again" }),
  );

  await screen.findByText("Current value");
  expect(respond).toHaveBeenCalledTimes(2);
  expect(respond).toHaveBeenLastCalledWith("portfolio.summary");
  expect(screen.queryByText("Portfolio unavailable")).toBeNull();
});

test("an empty portfolio explains how to import", async () => {
  const screen = renderScreen(<DashboardScreen />, () =>
    Promise.resolve({ ...summary, allocationByAssetClass: [] }),
  );

  await screen.findByText(
    "Import data on the web app to build your allocation.",
  );
});

test("holdings keeps the same instrument in two accounts as separate positions", async () => {
  const screen = renderScreen(<HoldingsScreen />, () =>
    Promise.resolve(holdings),
  );

  await screen.findByText("Broker one · Indian Stock");
  expect(screen.getByText("Broker two · Indian Stock")).toBeTruthy();
  expect(screen.getAllByText("FAKECO")).toHaveLength(2);
  expect(screen.getByLabelText("FAKECO, ₹250, return 25%")).toBeTruthy();
  expect(screen.getByLabelText("FAKECO, ₹126, return -16.61%")).toBeTruthy();
});

test("holdings shows loading, failure, retry, and the empty state", async () => {
  let rejectHoldings: (error: Error) => void = () => undefined;
  const response = new Promise((_, reject) => {
    rejectHoldings = reject;
  });
  const respond = jest.fn().mockReturnValueOnce(response).mockResolvedValue([]);
  const screen = renderScreen(<HoldingsScreen />, respond);

  expect(screen.getByLabelText("Loading holdings")).toBeTruthy();
  rejectHoldings(new Error("temporarily unavailable"));
  await screen.findByText("Holdings unavailable");
  fireEvent.press(
    screen.getByRole("button", { name: "Try loading holdings again" }),
  );

  await screen.findByText("No committed holdings");
  await waitFor(() => expect(respond).toHaveBeenCalledTimes(2));
});

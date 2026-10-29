import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { api } from "@investment-sync/backend/api";
import {
  buildPortfolioPublication,
  valuePortfolioPublication,
} from "../../../packages/portfolio-domain/src/index";
import DashboardScreen from "../app/index";
import HoldingsScreen from "../app/holdings";

const query = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useQuery: query }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("./theme", () => ({ useTheme: () => ({}) }));
vi.mock("./mobile-ui", () => ({
  AppButton: ({ children }: { children: ReactNode }) =>
    createElement("Button", {}, children),
  PageHeader: (props: { title: string }) => createElement("Header", props),
  StatePanel: (props: { title: string }) => createElement("Panel", props),
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
  Text: "Text",
  ScrollView: "ScrollView",
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListEmptyComponent,
  }: {
    data: FunctionReturnType<typeof api.portfolio.positions>["current"];
    renderItem: (item: {
      item: FunctionReturnType<
        typeof api.portfolio.positions
      >["current"][number];
      index: number;
    }) => ReactNode;
    ListHeaderComponent: ReactNode;
    ListEmptyComponent: ReactNode;
  }) =>
    createElement(
      "List",
      {},
      ListHeaderComponent,
      data.length
        ? data.map((item, index) =>
            createElement("li", { key: item.id }, renderItem({ item, index })),
          )
        : ListEmptyComponent,
    ),
}));

function views() {
  const publication = buildPortfolioPublication({
    existingFacts: [],
    batch: {
      id: "fake-batch",
      parserVersion: "fake-v1",
      sequence: 1,
      fallbackDate: "2026-10-01",
      rows: ["Account A", "Account B"].map((accountName) => ({
        kind: "holding",
        sourceType: "vested_drivewealth_xlsx",
        sourceDate: "2026-10-01",
        accountName,
        provider: "Fake broker",
        instrumentName: "Fake share",
        symbol: accountName === "Account A" ? "FAKE" : "OTHER",
        assetClass: "us_stock",
        currency: "USD",
        investedAmount: "10.25",
        currentValue: "12.75",
        pnlAmount: "2.5",
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

  return valuePortfolioPublication(publication.projection, {
    status: "stale",
    rate: "80",
    fetchedAt: "2026-10-01T00:00:00Z",
    provider: "frankfurter",
  });
}

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  query.mockReset();
  vi.unstubAllGlobals();
});

describe("native portfolio view contracts", () => {
  it("reads the overview summary and displays server-valued INR totals and allocation", async () => {
    const portfolio = views();
    query.mockReturnValue(portfolio.overview);
    await act(async () => {
      renderer = create(<DashboardScreen />);
    });
    expect(getFunctionName(query.mock.calls[0]?.[0])).toBe(
      "portfolio:overview",
    );
    const text = JSON.stringify(renderer?.toJSON());
    expect(text).toContain("2,040");
    expect(text).toContain("1,640");
    expect(text).toContain("Us Stock");
  });

  it("reads current positions, preserves distinct accounts and uses INR conversion instead of raw USD", async () => {
    const portfolio = views();
    query.mockReturnValue({
      current: portfolio.positions.current,
      exited: [portfolio.positions.current[0]],
    });
    await act(async () => {
      renderer = create(<HoldingsScreen />);
    });
    expect(getFunctionName(query.mock.calls[0]?.[0])).toBe(
      "portfolio:positions",
    );
    expect(renderer?.root.findAllByType("li")).toHaveLength(2);
    const text = JSON.stringify(renderer?.toJSON());
    expect(text).toContain("Account A");
    expect(text).toContain("Account B");
    expect(text).toContain("1,020");
    expect(text).toContain("Unavailable");
    expect(portfolio.positions.current[0]?.currentValue).toBe("12.75");
  });

  it("distinguishes loading from an empty portfolio", async () => {
    query.mockReturnValue(undefined);
    await act(async () => {
      renderer = create(<HoldingsScreen />);
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain("Loading holdings");
    query.mockReturnValue({ current: [], exited: [] });
    await act(async () => renderer?.update(<HoldingsScreen />));
    expect(
      renderer?.root.findByProps({ title: "No committed holdings" }),
    ).toBeDefined();
  });
});

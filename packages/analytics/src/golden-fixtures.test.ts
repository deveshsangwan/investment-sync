import { describe, expect, it } from "vitest";
import {
  performanceGoldenFixtures,
  portfolioGoldenFixtures,
} from "./golden-fixtures";
import { summarizePerformance } from "./performance";
import { summarizePortfolio } from "./portfolio";

describe("synthetic portfolio golden fixtures", () => {
  it.each(portfolioGoldenFixtures())(
    "captures $name",
    ({ holdings, expected }) => {
      expect(summarizePortfolio(holdings)).toEqual(expected);
    },
  );
});

describe("synthetic performance golden fixtures", () => {
  it.each(performanceGoldenFixtures())(
    "captures $name",
    ({ input, expected }) => {
      expect(summarizePerformance(input)).toEqual(expected);
    },
  );
});

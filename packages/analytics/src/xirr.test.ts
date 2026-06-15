import { describe, expect, it } from "vitest";
import { xirr } from "./xirr";

describe("xirr", () => {
  it("solves valid flows that need a non-default seed or fallback", () => {
    const rate = xirr(
      [
        { date: new Date("2020-01-01"), amount: -1000 },
        { date: new Date("2020-06-01"), amount: 2500 },
        { date: new Date("2021-01-01"), amount: -1600 },
        { date: new Date("2022-01-01"), amount: 450 },
      ],
      10,
    );

    expect(rate).toBeDefined();
    expect(rate ?? 0).toBeGreaterThan(-1);
  });

  it("returns undefined for cash flows without both signs", () => {
    expect(
      xirr([
        { date: new Date("2026-01-01"), amount: 100 },
        { date: new Date("2026-02-01"), amount: 200 },
      ]),
    ).toBeUndefined();
    expect(
      xirr([
        { date: new Date("2026-01-01"), amount: -100 },
        { date: new Date("2026-02-01"), amount: -200 },
      ]),
    ).toBeUndefined();
  });
});

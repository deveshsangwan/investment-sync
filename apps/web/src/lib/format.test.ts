import { describe, expect, it } from "vitest";
import {
  formatPercent,
  formatQuantity,
  npsSchemeLabel,
  sourceLabel,
} from "./format";

describe("portfolio formatting", () => {
  it("formats financial precision without source-data noise", () => {
    expect(formatPercent(48.81)).toBe("48.81%");
    expect(formatQuantity("1233.9500000000")).toBe("1,233.95");
  });

  it("uses human labels for import sources", () => {
    expect(sourceLabel("tickertape_stock_csv")).toBe("Tickertape stocks");
    expect(sourceLabel("nps_csv")).toBe("NPS statement");
    expect(sourceLabel("unknown_source")).toBe("Unknown Source");
  });

  it("labels known and unknown NPS schemes", () => {
    expect(npsSchemeLabel("E")).toBe("Scheme E · Equity");
    expect(npsSchemeLabel("X")).toBe("Scheme X");
  });
});

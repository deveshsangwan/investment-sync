import { describe, expect, it } from "vitest";
import {
  canRequestLogo,
  instrumentLogoUrls,
  recordLogoFailure,
} from "./instrument-logo";

const key = "pk_test";
const paths = (input: Parameters<typeof instrumentLogoUrls>[0]) =>
  instrumentLogoUrls(input, key).map((url) => new URL(url).pathname);

describe("instrument logo identifiers", () => {
  it("prefers an exact ISIN before an exchange-qualified Indian ticker", () => {
    expect(
      paths({
        assetClass: "indian_stock",
        symbol: "hdfcbank-EQ",
        exchange: "NSE",
        isin: "INE040A01034",
      }),
    ).toEqual(["/isin/INE040A01034", "/ticker/HDFCBANK.NS"]);
  });

  it("does not send ambiguous Indian symbols to the default US market", () => {
    expect(paths({ assetClass: "indian_stock", symbol: "ITC" })).toEqual([]);
    expect(
      paths({ assetClass: "indian_stock", symbol: "ITC", exchange: "unknown" }),
    ).toEqual([]);
    expect(
      paths({ assetClass: "indian_stock", symbol: "500180", exchange: "BSE" }),
    ).toEqual(["/ticker/500180.BO"]);
  });

  it("preserves a supplied Indian exchange suffix and US share classes", () => {
    expect(paths({ assetClass: "indian_stock", symbol: "INFY.NS" })).toEqual([
      "/ticker/INFY.NS",
    ]);
    expect(
      paths({ assetClass: "us_stock", symbol: "BRK.B", exchange: "NYSE" }),
    ).toEqual(["/ticker/BRK.B"]);
    expect(paths({ assetClass: "us_stock", symbol: "INFY.NS" })).toEqual([]);
    expect(
      paths({ assetClass: "us_stock", symbol: "ABC", exchange: "LSE" }),
    ).toEqual([]);
  });

  it("skips unsupported assets, malformed identifiers, and missing or secret keys", () => {
    expect(paths({ assetClass: "mutual_fund", symbol: "MSFT" })).toEqual([]);
    expect(
      paths({ assetClass: "us_stock", symbol: "../MSFT", isin: "invalid" }),
    ).toEqual([]);
    expect(
      instrumentLogoUrls({ assetClass: "us_stock", symbol: "MSFT" }, undefined),
    ).toEqual([]);
    expect(
      instrumentLogoUrls(
        { assetClass: "us_stock", symbol: "MSFT" },
        "sk_secret",
      ),
    ).toEqual([]);
  });

  it("asks for a real failure instead of the provider's generated placeholder", () => {
    const [url] = instrumentLogoUrls(
      { assetClass: "us_stock", symbol: "MSFT" },
      key,
    );
    expect(new URL(url ?? "").searchParams.get("fallback")).toBe("404");
  });
});

describe("failed logo retries", () => {
  it("suppresses repeat requests across mounts and allows a later retry", () => {
    const url = "https://img.logo.dev/ticker/MISSING?token=pk_test";
    expect(canRequestLogo(url, 100)).toBe(true);
    recordLogoFailure(url, 100);
    expect(canRequestLogo(url, 299_999)).toBe(false);
    expect(canRequestLogo(url, 300_100)).toBe(true);
  });
});

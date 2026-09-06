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
    expect(
      paths({ assetClass: "indian_stock", symbol: "UNKNOWN-SECURITY" }),
    ).toEqual([]);
    expect(
      paths({ assetClass: "indian_stock", symbol: "ITC", exchange: "unknown" }),
    ).toEqual([]);
    expect(
      paths({ assetClass: "indian_stock", symbol: "500180", exchange: "BSE" }),
    ).toEqual(["/ticker/500180.BO"]);
  });

  it("resolves existing Indian symbols and ETFs without mutating their records", () => {
    const input = Object.freeze({
      assetClass: "indian_stock",
      symbol: "HDFCBANK",
    });
    expect(paths(input)).toEqual(["/isin/INE040A01034", "/ticker/HDFCBANK.NS"]);
    expect(paths({ assetClass: "indian_stock", symbol: "NIFTYBEES" })).toEqual([
      "/isin/INF204KB14I2",
      "/ticker/NIFTYBEES.NS",
    ]);
    expect(input).toEqual({ assetClass: "indian_stock", symbol: "HDFCBANK" });
    expect(paths({ assetClass: "indian_stock", symbol: "__proto__" })).toEqual(
      [],
    );
  });

  it("uses issuer domains only within the matching asset class", () => {
    expect(
      paths({ assetClass: "mutual_fund", name: "HDFC Small Cap Fund" }),
    ).toEqual(["/hdfcfund.com"]);
    expect(
      paths({
        assetClass: "mutual_fund",
        name: "Parag Parikh ELSS Tax Saver Fund",
      }),
    ).toEqual(["/ppfas.com"]);
    expect(paths({ assetClass: "ulip", name: "HDFC Click2 Invest" })).toEqual([
      "/hdfclife.com",
    ]);
    expect(
      paths({ assetClass: "ulip", name: "Bajaj Alliance Goal Assure" }),
    ).toEqual(["/bajajlifeinsurance.com"]);
    expect(
      paths({ assetClass: "us_stock", name: "HDFC Small Cap Fund" }),
    ).toEqual([]);
    expect(
      paths({ assetClass: "mutual_fund", name: "Quantitative Small Cap Fund" }),
    ).toEqual([]);
  });

  it("resolves known crypto names and leaves aggregate and unknown rows alone", () => {
    expect(paths({ assetClass: "crypto", name: " Bitcoin " })).toEqual([
      "/crypto/BTC",
    ]);
    expect(paths({ assetClass: "crypto", name: "Solana" })).toEqual([
      "/crypto/SOL",
    ]);
    expect(paths({ assetClass: "crypto", name: "REI network" })).toEqual([
      "/rei.network",
    ]);
    for (const name of [
      "Mutual Funds Summary",
      "HDFC Summary",
      "Invested Today",
      "Unknown Fund",
    ]) {
      expect(paths({ assetClass: "mutual_fund", name })).toEqual([]);
    }
    expect(paths({ assetClass: "nps", name: "NPS" })).toEqual([]);
    expect(paths({ assetClass: "crypto", name: "Crypto Summary" })).toEqual([]);
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

  it("requests transparent PNGs adjusted to the selected theme", () => {
    for (const theme of ["light", "dark"] as const) {
      const urls = instrumentLogoUrls(
        { assetClass: "us_stock", symbol: "UBER" },
        key,
        theme,
      );
      const params = new URL(urls[0] ?? "").searchParams;
      expect(params.get("theme")).toBe(theme);
      expect(params.get("format")).toBe("png");
    }
    const dark = instrumentLogoUrls(
      { assetClass: "us_stock", symbol: "UBER" },
      key,
      "dark",
    );
    const light = instrumentLogoUrls(
      { assetClass: "us_stock", symbol: "UBER" },
      key,
      "light",
    );
    expect(dark).not.toEqual(light);
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

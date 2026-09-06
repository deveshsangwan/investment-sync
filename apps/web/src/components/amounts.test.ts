import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DisplayAmount, Money } from "./amounts";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

describe("amount privacy before hydration", () => {
  it("does not expose a transaction amount before reading the saved preference", () => {
    const html = renderToStaticMarkup(
      React.createElement(Money, { value: 123456, currency: "INR" }),
    );

    expect(html).toContain("••••••");
    expect(html).not.toContain("1,23,456");
  });

  it("does not expose the portfolio headline before reading the saved preference", () => {
    const html = renderToStaticMarkup(
      React.createElement(DisplayAmount, { value: 1939000, currency: "INR" }),
    );

    expect(html).toContain("••••••");
    expect(html).not.toContain("19,39,000");
  });
});

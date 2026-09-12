import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./api-url";

describe("Expo Go API address", () => {
  it("connects an iPhone to the development computer rather than itself", () => {
    expect(resolveApiUrl("http://localhost:3000", "192.168.1.8:8081")).toBe(
      "http://192.168.1.8:3000",
    );
  });

  it("keeps explicitly configured remote APIs", () => {
    expect(
      resolveApiUrl("https://portfolio.example.com/", "192.168.1.8:8081"),
    ).toBe("https://portfolio.example.com");
  });

  it("supports a simulator without an advertised host", () => {
    expect(resolveApiUrl(undefined)).toBe("http://localhost:3000");
  });

  it("preserves the API port and path when replacing a loopback IP", () => {
    expect(
      resolveApiUrl("http://127.0.0.1:4000/backend/", "192.168.1.8:8081"),
    ).toBe("http://192.168.1.8:4000/backend");
  });

  it("rejects non-HTTP addresses", () => {
    expect(() => resolveApiUrl("file:///tmp/api")).toThrow("HTTP or HTTPS");
  });
});

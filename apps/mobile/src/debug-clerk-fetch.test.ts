import { afterEach, expect, it, vi } from "vitest";
import { traceClerkRequests } from "./debug-clerk-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reports an HTML challenge without leaking credentials or consuming the response", async () => {
  const body = "<html>Just a moment <script>private-response</script></html>";
  const response = new Response(body, {
    status: 403,
    headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
  });
  const originalFetch = vi.fn().mockResolvedValue(response);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", originalFetch);
  const restore = traceClerkRequests();

  const result = await fetch(
    "https://example.clerk.accounts.dev/v1/client/sign_ins?token=private-query",
    {
      method: "POST",
      headers: { authorization: "private-token" },
      body: "private-request",
    },
  );

  expect(result).toBe(response);
  expect(await result.text()).toBe(body);
  expect(log).toHaveBeenCalledWith(
    "[DEBUG-clerk-http]",
    expect.stringContaining('"status":403'),
  );
  expect(log).toHaveBeenCalledWith(
    "[DEBUG-clerk-http]",
    expect.stringContaining('"isChallenge":true'),
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-");

  restore();
  expect(globalThis.fetch).toBe(originalFetch);
});

it("does not inspect unrelated requests", async () => {
  const response = new Response("private-response");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const restore = traceClerkRequests();

  expect(await fetch("https://example.com/api/trpc")).toBe(response);
  expect(log).not.toHaveBeenCalled();
  expect(response.bodyUsed).toBe(false);

  restore();
});

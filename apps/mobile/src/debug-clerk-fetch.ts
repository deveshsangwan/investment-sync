// Temporary diagnostics for the on-device SSO failure. Never log request headers,
// query strings, bodies, or raw response text: these can contain credentials.
export function traceClerkRequests() {
  const originalFetch = globalThis.fetch;

  const tracedFetch: typeof fetch = async (input, init) => {
    const response = await originalFetch(input, init);

    try {
      const requestUrl = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );

      if (!requestUrl.pathname.startsWith("/v1/client/sign_ins"))
        return response;

      const contentType = response.headers.get("content-type");
      const body = contentType?.includes("json")
        ? ""
        : await response.clone().text();
      const responseUrl = response.url ? new URL(response.url) : requestUrl;

      console.info(
        "[DEBUG-clerk-http]",
        JSON.stringify({
          status: response.status,
          contentType,
          requestHost: requestUrl.host,
          responseHost: responseUrl.host,
          isRedirected: response.redirected,
          server: response.headers.get("server"),
          rayId: response.headers.get("cf-ray"),
          responseDate: response.headers.get("date"),
          isChallenge:
            response.headers.get("cf-mitigated") === "challenge" ||
            /challenge-platform|just a moment|verify you are human/i.test(body),
          isNotFound: /404|page not found|cannot post/i.test(body),
          isProxyPage: /ngrok|captive portal|proxy error|access denied/i.test(
            body,
          ),
          isHtml: /^\s*</.test(body),
        }),
      );
    } catch {
      // Diagnostics must not change the original response or interrupt sign-in.
    }

    return response;
  };

  globalThis.fetch = tracedFetch;

  return () => {
    if (globalThis.fetch === tracedFetch) globalThis.fetch = originalFetch;
  };
}

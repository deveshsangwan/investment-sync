export function readMobileConfiguration(environment: {
  convexUrl: string | undefined;
  clerkPublishableKey: string | undefined;
}): { error: string } | { convexUrl: string; clerkPublishableKey: string } {
  const { convexUrl, clerkPublishableKey } = environment;

  if (!convexUrl) {
    return {
      error: "Set EXPO_PUBLIC_CONVEX_URL to the same deployment used by web.",
    };
  }

  try {
    const url = new URL(convexUrl);
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if (
      (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.hostname.endsWith(".convex.site")
    ) {
      return {
        error:
          "EXPO_PUBLIC_CONVEX_URL must be a Convex deployment URL (HTTPS, or local HTTP).",
      };
    }
  } catch {
    return { error: "EXPO_PUBLIC_CONVEX_URL must be a valid deployment URL." };
  }

  if (
    !clerkPublishableKey ||
    !/^pk_(test|live)_\S+$/.test(clerkPublishableKey)
  ) {
    return {
      error:
        "Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY for the same Clerk instance used by web.",
    };
  }

  return { convexUrl, clerkPublishableKey };
}

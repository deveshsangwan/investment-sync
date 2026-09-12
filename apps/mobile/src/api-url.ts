function isLoopback(hostname: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function resolveApiUrl(
  configuredUrl: string | undefined,
  hostUri?: string | null,
) {
  const url = new URL(configuredUrl || "http://localhost:3000");

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The API address must use HTTP or HTTPS.");
  }

  // In Expo Go, localhost is the phone. Metro advertises the development computer.
  if (isLoopback(url.hostname) && hostUri) {
    const metroUrl = new URL(`http://${hostUri}`);
    url.hostname = metroUrl.hostname;
  }

  return url.toString().replace(/\/$/, "");
}

const holdingRoutePrefix = "/dashboard/holdings/";

export function positionKeyFromHoldingPathname(pathname: string) {
  if (!pathname.startsWith(holdingRoutePrefix)) return null;

  const encodedPositionKey = pathname.slice(holdingRoutePrefix.length);
  if (!encodedPositionKey || encodedPositionKey.includes("/")) return null;

  try {
    return decodeURIComponent(encodedPositionKey);
  } catch {
    return null;
  }
}

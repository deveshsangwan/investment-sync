import { describe, expect, it } from "vitest";
import { readMobileConfiguration } from "./config";

const clerkPublishableKey = "pk_test_fake";

describe("mobile backend configuration", () => {
  it("requires an explicit Convex deployment without a legacy API fallback", () => {
    expect(
      readMobileConfiguration({ convexUrl: undefined, clerkPublishableKey }),
    ).toHaveProperty(
      "error",
      expect.stringContaining("EXPO_PUBLIC_CONVEX_URL"),
    );
  });

  it.each(["https://fake-deployment.convex.cloud", "http://localhost:3210"])(
    "accepts %s",
    (convexUrl) => {
      expect(
        readMobileConfiguration({ convexUrl, clerkPublishableKey }),
      ).toEqual({ convexUrl, clerkPublishableKey });
    },
  );

  it.each([
    "",
    "not a URL",
    "http://remote.example",
    "https://fake.convex.site",
    "https://fake.convex.cloud/api/trpc",
    "https://user:password@fake.convex.cloud",
    "https://fake.convex.cloud?token=fake",
  ])("rejects an unsafe or wrong endpoint: %s", (convexUrl) => {
    expect(
      readMobileConfiguration({ convexUrl, clerkPublishableKey }),
    ).toHaveProperty("error");
  });

  it.each([undefined, "", "sk_test_fake"])(
    "requires a public Clerk key: %s",
    (key) => {
      expect(
        readMobileConfiguration({
          convexUrl: "https://fake.convex.cloud",
          clerkPublishableKey: key,
        }),
      ).toHaveProperty(
        "error",
        expect.stringContaining("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"),
      );
    },
  );
});

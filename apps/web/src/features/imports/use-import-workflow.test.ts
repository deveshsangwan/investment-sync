import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { errorMessage, getPublicationOutcome } from "./use-import-workflow";

const expectation = { batchId: "selected", previousAttempt: 2 };

describe("import publication tracking", () => {
  it("ignores a stale failure until the selected batch attempt advances", () => {
    expect(
      getPublicationOutcome(expectation, {
        id: "selected",
        publicationAttempt: 2,
        status: "parsed",
        errorMessage: "Earlier publication failed",
      }),
    ).toBe("pending");
  });

  it("ignores updates from a different selected batch", () => {
    expect(
      getPublicationOutcome(expectation, {
        id: "different",
        publicationAttempt: 3,
        status: "committed",
        errorMessage: null,
      }),
    ).toBe("pending");
  });

  it("recognizes success and failure from the next publication attempt", () => {
    expect(
      getPublicationOutcome(expectation, {
        id: "selected",
        publicationAttempt: 3,
        status: "committed",
        errorMessage: null,
      }),
    ).toBe("complete");
    expect(
      getPublicationOutcome(expectation, {
        id: "selected",
        publicationAttempt: 3,
        status: "parsed",
        errorMessage: "Publication failed",
      }),
    ).toBe("failed");
  });
});

describe("import operation failures", () => {
  it("does not display network or provider messages", () => {
    expect(errorMessage(new Error("fake private storage URL"))).toBe(
      "The import could not be completed. Please try again.",
    );
    expect(
      errorMessage({ data: { message: "fake provider detail" } }),
    ).not.toContain("fake");
  });

  it("keeps recognized expected codes actionable without echoing server text", () => {
    expect(
      errorMessage(
        new ConvexError({
          code: "PUBLISHING_CONFLICT",
          message: "fake provider detail",
        }),
      ),
    ).toBe("Another import is publishing. Retry after it completes.");
  });
});

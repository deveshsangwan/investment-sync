import { describe, expect, it } from "vitest";
import { getPublicationOutcome } from "./use-import-workflow";

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

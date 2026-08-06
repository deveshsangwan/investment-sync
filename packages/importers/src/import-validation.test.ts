import { describe, expect, it } from "vitest";
import { getImportFileValidationError } from "./import-validation";

describe("getImportFileValidationError", () => {
  it("normalizes MIME type case and surrounding whitespace", () => {
    expect(
      getImportFileValidationError({
        fileName: "holdings.csv",
        mimeType: " TEXT/CSV ",
        sizeBytes: 1024,
      }),
    ).toBeNull();
  });

  it("rejects unsupported MIME types after normalization", () => {
    expect(
      getImportFileValidationError({
        fileName: "holdings.csv",
        mimeType: " application/json ",
        sizeBytes: 1024,
      }),
    ).toBe("Import file type is not supported");
  });

  it("caps imports at four megabytes", () => {
    expect(
      getImportFileValidationError({
        fileName: "holdings.csv",
        sizeBytes: 4 * 1024 * 1024,
      }),
    ).toBeNull();
    expect(
      getImportFileValidationError({
        fileName: "holdings.csv",
        sizeBytes: 4 * 1024 * 1024 + 1,
      }),
    ).toBe("Import files must be 4 MB or smaller");
  });
});

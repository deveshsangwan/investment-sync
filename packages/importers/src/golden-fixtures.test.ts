import { describe, expect, it } from "vitest";
import { parserGoldenFixtures } from "./golden-fixtures";
import { parseImportFile } from "./index";

describe("synthetic parser golden fixtures", () => {
  it.each(parserGoldenFixtures())(
    "captures the semantic output for $name",
    ({ file, expected }) => {
      expect(parseImportFile(file)).toEqual(expected);
    },
  );
});

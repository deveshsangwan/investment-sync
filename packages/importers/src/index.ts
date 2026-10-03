import type { ImportFile, ParseResult, PortfolioImporter } from "./types";
import { npsPortalCsvImporter } from "./nps";
import {
  tickertapeMutualFundImporter,
  tickertapeStockImporter,
} from "./tickertape";
import {
  investmentPortfolioWorkbookImporter,
  vestedDrivewealthImporter,
} from "./xlsx";

export * from "./types";
export * from "./utils";
export * from "./import-validation";
export * from "./nps-details";

export const importers: PortfolioImporter[] = [
  npsPortalCsvImporter,
  tickertapeStockImporter,
  tickertapeMutualFundImporter,
  vestedDrivewealthImporter,
  investmentPortfolioWorkbookImporter,
];

export function detectImporter(
  file: ImportFile,
): PortfolioImporter | undefined {
  const ranked = importers
    .map((importer) => ({ importer, detection: importer.detect(file) }))
    .sort((a, b) => b.detection.confidence - a.detection.confidence);

  return ranked[0]?.detection.confidence ? ranked[0].importer : undefined;
}

export function parseImportFile(file: ImportFile): ParseResult {
  const importer = detectImporter(file);
  if (!importer) {
    throw new Error("No importer could detect this file format yet");
  }

  return importer.parse(file);
}

export * from "./exact-types";
export * from "./exact-adapter";
export * from "./numeric";
export * from "./source";

import { preserveParsedDecimals } from "./exact";
import type { ExactParseResult } from "./exact-types";

export function parseExactImportFile(file: ImportFile): ExactParseResult {
  const importer = detectImporter(file);
  if (!importer) {
    throw new Error("No importer could detect this file format yet");
  }

  return preserveParsedDecimals(
    importer.parse(file, { preserveDecimalMeaning: true }),
  );
}

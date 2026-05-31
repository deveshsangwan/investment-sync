import type { ImportFile, ParseResult, PortfolioImporter } from "./types";
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

export const importers: PortfolioImporter[] = [
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

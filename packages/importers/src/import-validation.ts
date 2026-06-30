export const MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const ALLOWED_IMPORT_EXTENSIONS = [".csv", ".xlsx"] as const;
export const ALLOWED_IMPORT_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const allowedMimeTypes = new Set<string>(ALLOWED_IMPORT_MIME_TYPES);

export function getImportFileValidationError(input: {
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
}): string | null {
  if (input.sizeBytes > MAX_IMPORT_FILE_SIZE_BYTES) {
    return "Import files must be 50 MB or smaller";
  }

  const lowerName = input.fileName.toLowerCase();
  const hasAllowedExtension = ALLOWED_IMPORT_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension),
  );
  if (!hasAllowedExtension) {
    return "Import files must be CSV or XLSX files";
  }

  const normalizedMimeType = input.mimeType?.trim().toLowerCase();
  if (normalizedMimeType && !allowedMimeTypes.has(normalizedMimeType)) {
    return "Import file type is not supported";
  }

  return null;
}

export function validateImportFile(input: {
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
}) {
  const error = getImportFileValidationError(input);
  if (error) throw new Error(error);
}

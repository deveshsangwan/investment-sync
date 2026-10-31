/** Public messages are owned here, never copied from a caught exception. */
const publicErrors = {
  VALIDATION: {
    status: 400,
    message: "Check the file or entry values and try again.",
  },
  UNAUTHENTICATED: { status: 401, message: "Sign in to continue." },
  FORBIDDEN: { status: 403, message: "You do not have permission to do this." },
  NOT_FOUND: { status: 404, message: "The requested item is unavailable." },
  CONFLICT: {
    status: 409,
    message: "The data has changed. Reload and try again.",
  },
  CAPACITY: {
    status: 400,
    message:
      "This operation exceeds the supported limits. Use a smaller file or entry.",
  },
  PUBLISHING_CONFLICT: {
    status: 409,
    message: "Another import is publishing. Retry after it completes.",
  },
  PUBLICATION_EXPIRED: {
    status: 409,
    message:
      "Publication timed out. Wait for recovery, then retry this import.",
  },
  USER_NOT_PROVISIONED: {
    status: 403,
    message: "Your household is not ready. Reload and try again.",
  },
  INVALID_MEMBERSHIP: {
    status: 403,
    message: "Your household membership is unavailable.",
  },
  IDENTITY_CONFLICT: {
    status: 409,
    message: "Your sign-in information has changed. Sign in again.",
  },
  SOURCE_WRITES_PAUSED: { status: 409, message: "Source writes are paused" },
  DUPLICATE_IMPORT: { status: 409, message: "Duplicate Import" },
  PROVIDER_UNAVAILABLE: {
    status: 502,
    message: "The service is temporarily unavailable. Please try again.",
  },
  INTERNAL_FAILURE: {
    status: 500,
    message: "The operation could not be completed. Please try again.",
  },
} as const;

export type PublicErrorCode = keyof typeof publicErrors;
export type PublicError = ReturnType<typeof publicError>;

export function isPublicErrorCode(code: unknown): code is PublicErrorCode {
  return typeof code === "string" && Object.hasOwn(publicErrors, code);
}

export function publicError(code: PublicErrorCode) {
  return { code, ...publicErrors[code] };
}

export function narrowPublicError(data: unknown) {
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return publicError("INTERNAL_FAILURE");
  }

  return publicError(
    isPublicErrorCode(data.code) ? data.code : "INTERNAL_FAILURE",
  );
}

export function safePublicErrorMessage(message: unknown) {
  return (
    Object.values(publicErrors).find((error) => error.message === message)
      ?.message ?? publicErrors.INTERNAL_FAILURE.message
  );
}

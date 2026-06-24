export type Result<T, E = unknown> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: E };

export async function tryCatch<T>(promise: Promise<T>): Promise<Result<T>> {
  // eslint-disable-next-line no-restricted-syntax -- This is the shared primitive that converts thrown failures into Result values.
  try {
    return { ok: true, data: await promise, error: null };
  } catch (error) {
    return { ok: false, data: null, error };
  }
}

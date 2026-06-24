# Errors

- For expected recoverable async failures, use `await tryCatch(operation())` and branch on `result.ok`.
- Treat `result.error` as `unknown`; narrow it—never cast caught errors.
- New TypeScript `try/catch` requires an inline ESLint suppression explaining why. Allowed cases: `finally`, retry/fallback, logging/enrichment/rethrow, or an irreducible framework boundary.

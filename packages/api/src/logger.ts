type LogLevel = "debug" | "info" | "warn" | "error";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.toLowerCase();
  if (value === "debug" || value === "info" || value === "warn") return value;
  return "error";
}

function shouldLog(level: LogLevel) {
  return levelPriority[level] >= levelPriority[configuredLevel()];
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("debug")) console.debug(message, meta ?? "");
  },
  info(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("info")) console.info(message, meta ?? "");
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("warn")) console.warn(message, meta ?? "");
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("error")) console.error(message, meta ?? "");
  },
};

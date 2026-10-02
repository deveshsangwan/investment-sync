const nodeCrypto = require("node:crypto");

const TARGET_TABLES = [
  "users",
  "households",
  "householdMembers",
  "accounts",
  "instruments",
  "importBatches",
  "sourceFiles",
  "importRowChunks",
  "holdingSnapshots",
  "transactions",
  "portfolioValuations",
  "portfolioVersions",
  "publicationReceipts",
  "currencyRates",
];

class ReverseReplayError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReverseReplayError";
    this.code = code;
  }
}

function legacyNormalizedRow(row) {
  const result = { ...row };
  delete result.source;
  delete result.numericProvenance;

  for (const field of [
    "quantity",
    "price",
    "amount",
    "investedAmount",
    "currentValue",
    "pnlAmount",
  ]) {
    if (result[field] === undefined) continue;
    const number = Number(result[field]);
    if (
      !Number.isFinite(number) ||
      expandNumberExponent(number) !== result[field]
    )
      reject("normalized_row_not_losslessly_representable");
    result[field] = number;
  }

  return result;
}

function validateExactRow(row) {
  object(row);
  if (!["holding", "transaction", "valuation"].includes(row.kind))
    reject("invalid_normalized_row_kind");
  if (
    ![
      "investment_portfolio_xlsx",
      "nps_csv",
      "tickertape_stock_csv",
      "tickertape_mutual_fund_csv",
      "vested_drivewealth_xlsx",
      "manual_snapshot",
      "cas_pdf",
      "unknown",
    ].includes(row.sourceType)
  )
    reject("invalid_source_type");
  if (!["INR", "USD", "BTC", "ETH", "OTHER"].includes(row.currency))
    reject("invalid_currency");
  object(row.metadata);
  object(row.source);
  object(row.numericProvenance);
  if (
    typeof row.source.group !== "string" ||
    !["complete", "partial"].includes(row.source.completeness) ||
    !["instrument", "asset_class", "portfolio"].includes(
      row.source.granularity,
    ) ||
    !Number.isSafeInteger(row.source.priority)
  )
    reject("invalid_source_metadata");

  if (row.kind !== "valuation") {
    text(row.provider);
    text(row.accountName);
    text(row.instrumentName);
    if (
      ![
        "indian_stock",
        "mutual_fund",
        "us_stock",
        "nps",
        "ulip",
        "crypto",
        "cash",
        "other",
      ].includes(row.assetClass)
    )
      reject("invalid_asset_class");
  }

  const fields =
    row.kind === "transaction"
      ? ["amount", "quantity", "price"]
      : [
          "investedAmount",
          "currentValue",
          "pnlAmount",
          ...(row.kind === "holding" ? ["quantity"] : []),
        ];
  for (const field of fields) {
    if (
      row[field] === undefined &&
      ["quantity", "price", "pnlAmount"].includes(field)
    )
      continue;
    decimal(row[field]);
  }
  if (
    row.pnlPercent !== undefined &&
    (typeof row.pnlPercent !== "number" || !Number.isFinite(row.pnlPercent))
  )
    reject("invalid_percentage");
}

function assertLegacyHoldingSemantics(row) {
  if (row.kind !== "holding") return;

  const group =
    typeof row.metadata.sourceSheet === "string"
      ? row.metadata.sourceSheet
      : "";
  const aggregate =
    row.metadata.isAggregate === true ||
    (typeof row.metadata.isAggregate === "string" &&
      row.metadata.isAggregate.trim().toLowerCase() === "true") ||
    group === "Investment Portfolio" ||
    row.instrumentName.trimEnd().toLowerCase().endsWith(" summary");
  const isVested =
    row.sourceType === "vested_drivewealth_xlsx" &&
    row.accountName === "US Stocks" &&
    row.provider === "Vested / DriveWealth" &&
    row.assetClass === "us_stock" &&
    row.currency === "USD" &&
    group === "";
  const priorities =
    row.sourceType === "nps_csv" ? [100] : isVested ? [0, 1] : [0];

  if (
    row.source.group !== group ||
    row.source.completeness !== "complete" ||
    row.source.granularity !== (aggregate ? "asset_class" : "instrument") ||
    !priorities.includes(row.source.priority)
  )
    reject("source_metadata_not_reconstructible_in_postgres");
}

function expandNumberExponent(value) {
  const source = String(value);
  if (!source.includes("e")) return source;

  const [coefficient, exponent] = source.split("e");
  const negative = coefficient.startsWith("-");
  const [whole, fraction = ""] = (
    negative ? coefficient.slice(1) : coefficient
  ).split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + Number(exponent);
  const result =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? digits.padEnd(decimalIndex, "0")
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;

  return `${negative ? "-" : ""}${result}`;
}

function scaled(value, scale, precision = 28) {
  decimal(value);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  let integer = BigInt(
    `${whole}${fraction.slice(0, scale).padEnd(scale, "0")}`,
  );
  if ((fraction[scale] ?? "0") >= "5") integer += 1n;
  if (integer >= 10n ** BigInt(precision)) reject("numeric_capacity_exceeded");
  const digits = integer.toString().padStart(scale + 1, "0");
  const decimalPart = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return `${negative && integer !== 0n ? "-" : ""}${scale ? digits.slice(0, -scale) : digits}${decimalPart ? `.${decimalPart}` : ""}`;
}

function subtractScaled(left, right, scale) {
  const width = Math.max(
    (left.split(".")[1] ?? "").length,
    (right.split(".")[1] ?? "").length,
    scale,
  );
  const integer = (value) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(
      ".",
    );
    return (
      BigInt(`${whole}${fraction.padEnd(width, "0")}`) * (negative ? -1n : 1n)
    );
  };
  const result = integer(left) - integer(right);
  const digits = (result < 0n ? -result : result)
    .toString()
    .padStart(width + 1, "0");
  return scaled(
    `${result < 0n ? "-" : ""}${digits.slice(0, -width)}.${digits.slice(-width).replace(/0+$/, "") || "0"}`,
    scale,
  );
}

function optionalScaled(value, scale) {
  return value === undefined ? null : scaled(value, scale);
}
function decimal(value) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value) ||
    value === "-0"
  )
    reject("invalid_exact_decimal");
  return value;
}
function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    reject("invalid_financial_date");
  return value;
}
function timestamp(value) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(Math.trunc(value)) ||
    !Number.isFinite(new Date(value).getTime())
  )
    reject("invalid_target_timestamp");

  const [whole, fraction = ""] = expandNumberExponent(Math.abs(value)).split(
    ".",
  );
  let microseconds =
    BigInt(whole) * 1000n + BigInt(fraction.slice(0, 3).padEnd(3, "0"));
  if ((fraction[3] ?? "0") >= "5") microseconds += 1n;
  if (value < 0) microseconds = -microseconds;
  let milliseconds = microseconds / 1000n;
  let remainder = microseconds % 1000n;
  if (remainder < 0n) {
    milliseconds -= 1n;
    remainder += 1000n;
  }

  return new Date(Number(milliseconds))
    .toISOString()
    .replace(/Z$/, `${remainder.toString().padStart(3, "0")}Z`);
}
function optionalTimestamp(value) {
  return value === undefined ? null : timestamp(value);
}
function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    reject("invalid_publication_sequence");
  return value;
}
function text(value) {
  if (typeof value !== "string" || !value.trim()) reject("invalid_text");
  return value;
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject("invalid_object");
  return value;
}
function stringArray(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    reject("invalid_string_array");
  return value;
}
function mapped(map, value) {
  const result = map.get(value);
  if (!result) reject("missing_parent_mapping");
  return result;
}
function unique(rows, code) {
  if (rows.length > 1) reject(code);
  return rows[0];
}
function reject(code) {
  throw new ReverseReplayError(code);
}

function deterministicUuid(table, targetId) {
  const bytes = nodeCrypto
    .createHash("sha256")
    .update(`investment-sync-reverse-v1\0${table}\0${targetId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = {
  assertLegacyHoldingSemantics,
  ReverseReplayError,
  TARGET_TABLES,
  date,
  decimal,
  deterministicUuid,
  integer,
  legacyNormalizedRow,
  mapped,
  object,
  optionalScaled,
  optionalTimestamp,
  reject,
  scaled,
  stringArray,
  subtractScaled,
  text,
  timestamp,
  unique,
  validateExactRow,
};

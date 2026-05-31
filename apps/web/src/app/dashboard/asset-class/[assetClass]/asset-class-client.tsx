"use client";

import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { trpc } from "../../../providers";

const inrCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const usdCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function AssetClassClient({
  assetClass,
  isDataConfigured,
}: {
  assetClass: string;
  isDataConfigured: boolean;
}) {
  const detail = trpc.portfolio.assetClassDetail.useQuery(
    { assetClass },
    { enabled: isDataConfigured },
  );
  const summary = detail.data?.summary;
  const pnlClass = (summary?.pnlAmount ?? 0) >= 0 ? "positive" : "negative";

  return (
    <main className="page dashboard-page">
      <section className="page-header">
        <div>
          <Link className="back-link" href="/dashboard">
            <ArrowLeft size={16} />
            Dashboard
          </Link>
          <p className="eyebrow">Asset class</p>
          <h1>{labelize(assetClass)}</h1>
          <p className="muted">Holdings, contribution, and concentration.</p>
        </div>
      </section>

      {!isDataConfigured ? <SetupRequired /> : null}

      <section className="grid grid-4">
        <Metric
          label="Current value"
          value={inrCurrency.format(summary?.currentValue ?? 0)}
        />
        <Metric
          label="Invested"
          value={inrCurrency.format(summary?.investedAmount ?? 0)}
        />
        <Metric
          label="Gain/Loss"
          value={inrCurrency.format(summary?.pnlAmount ?? 0)}
          className={pnlClass}
        />
        <Metric
          label="Return"
          value={formatPercent(summary?.pnlPercent)}
          className={pnlClass}
        />
      </section>

      <section className="grid grid-4" style={{ marginTop: 16 }}>
        <Metric
          label="Portfolio weight"
          value={formatPercent(summary?.portfolioWeight)}
        />
        <Metric label="Holdings" value={`${summary?.holdingCount ?? 0}`} />
        <Metric
          label="Largest holding"
          value={formatPercent(detail.data?.holdings[0]?.weightInAssetClass)}
          detail={
            detail.data?.holdings[0]?.symbol ??
            detail.data?.holdings[0]?.instrumentName
          }
        />
        <Metric
          label="Source XIRR names"
          value={`${detail.data?.holdings.filter((holding) => holding.sourceXirr !== undefined).length ?? 0}`}
          detail="Imported XIRR"
        />
      </section>

      <section className="panel panel-tall" style={{ marginTop: 16 }}>
        <h2>Holdings</h2>
        {(detail.data?.holdings.length ?? 0) === 0 ? (
          <div className="quiet-empty">
            <BarChart3 size={24} />
            <p>No holdings found for this asset class.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
                <th>P&L</th>
                <th>Return</th>
                <th>Weight</th>
                <th>XIRR</th>
              </tr>
            </thead>
            <tbody>
              {detail.data?.holdings.map((holding) => {
                const rowPnlClass =
                  Number(holding.pnlAmountInInr ?? 0) >= 0
                    ? "positive"
                    : "negative";
                return (
                  <tr key={holding.id}>
                    <td>
                      <Link
                        className="table-link"
                        href={`/dashboard/holdings/${holding.id}`}
                      >
                        {holding.symbol ?? holding.instrumentName}
                      </Link>
                      <div className="table-subtext">{holding.accountName}</div>
                    </td>
                    <td>
                      {formatCurrency(
                        Number(holding.currentValue),
                        holding.currency,
                      )}
                    </td>
                    <td className={rowPnlClass}>
                      {formatCurrency(
                        Number(holding.pnlAmount ?? 0),
                        holding.currency,
                      )}
                    </td>
                    <td className={rowPnlClass}>
                      {formatPercent(numberOrUndefined(holding.pnlPercent))}
                    </td>
                    <td>{formatPercent(holding.weightInAssetClass)}</td>
                    <td>{formatPercent(holding.sourceXirr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel panel-tall" style={{ marginTop: 16 }}>
        <h2>Exited holdings</h2>
        {(detail.data?.exitedHoldings.length ?? 0) === 0 ? (
          <div className="quiet-empty">
            <BarChart3 size={24} />
            <p>No exited holdings found from historical snapshots.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Last seen</th>
                <th>Last value</th>
                <th>Last P&L</th>
                <th>Return</th>
              </tr>
            </thead>
            <tbody>
              {detail.data?.exitedHoldings.map((holding) => {
                const rowPnlClass =
                  Number(holding.pnlAmountInInr ?? 0) >= 0
                    ? "positive"
                    : "negative";
                return (
                  <tr key={holding.id}>
                    <td>
                      <Link
                        className="table-link"
                        href={`/dashboard/holdings/${holding.id}`}
                      >
                        {holding.symbol ?? holding.instrumentName}
                      </Link>
                      <div className="table-subtext">{holding.accountName}</div>
                    </td>
                    <td>{formatDate(holding.snapshotDate)}</td>
                    <td>
                      {formatCurrency(
                        Number(holding.currentValue),
                        holding.currency,
                      )}
                    </td>
                    <td className={rowPnlClass}>
                      {formatCurrency(
                        Number(holding.pnlAmount ?? 0),
                        holding.currency,
                      )}
                    </td>
                    <td className={rowPnlClass}>
                      {formatPercent(numberOrUndefined(holding.pnlPercent))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  className,
  detail,
}: {
  label: string;
  value: string;
  className?: string;
  detail?: string;
}) {
  return (
    <div className="panel metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${className ?? ""}`}>{value}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </div>
  );
}

function SetupRequired() {
  return (
    <section className="empty-portfolio setup-required">
      <div>
        <p className="eyebrow">Setup required</p>
        <h2>Connect Supabase before loading portfolio data</h2>
        <p>
          Add the database and Supabase environment variables, then restart.
        </p>
      </div>
    </section>
  );
}

function formatCurrency(value: number, currency: string) {
  if (currency === "USD") return usdCurrency.format(value);
  return inrCurrency.format(value);
}

function formatPercent(value: number | undefined | null) {
  return value === undefined || value === null ? "N/A" : `${value}%`;
}

function numberOrUndefined(value: string | number | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

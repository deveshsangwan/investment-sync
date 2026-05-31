"use client";

import Link from "next/link";
import { ArrowLeft, FileSpreadsheet, ReceiptText } from "lucide-react";
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

export function HoldingDetailClient({
  id,
  isDataConfigured,
}: {
  id: string;
  isDataConfigured: boolean;
}) {
  const detail = trpc.portfolio.holdingDetail.useQuery(
    { id },
    { enabled: isDataConfigured },
  );
  const data = detail.data;
  const holding = data?.holding;
  const pnlClass =
    (holding?.pnlAmountInInr ?? 0) >= 0 ? "positive" : "negative";
  const historyValues =
    data?.history.map((point) => point.currentValueInInr) ?? [];

  return (
    <main className="page dashboard-page">
      <section className="page-header">
        <div>
          <Link className="back-link" href="/dashboard">
            <ArrowLeft size={16} />
            Dashboard
          </Link>
          <p className="eyebrow">Holding</p>
          <h1>
            {holding ? (holding.symbol ?? holding.instrumentName) : "Holding"}
          </h1>
          <p className="muted">
            {holding
              ? `${labelize(holding.assetClass)} · ${holding.accountName} · ${holding.provider}`
              : "Loading holding analytics"}
          </p>
        </div>
        {holding ? (
          <Link
            className="button secondary"
            href={`/dashboard/asset-class/${encodeURIComponent(holding.assetClass)}`}
          >
            {labelize(holding.assetClass)}
          </Link>
        ) : null}
      </section>

      {!isDataConfigured ? <SetupRequired /> : null}
      {isDataConfigured && !detail.isLoading && !holding ? (
        <MissingHolding />
      ) : null}

      <section className="grid grid-4">
        <Metric
          label="Current value"
          value={formatCurrency(
            Number(holding?.currentValue ?? 0),
            holding?.currency ?? "INR",
          )}
        />
        <Metric
          label="Invested"
          value={formatCurrency(
            Number(holding?.investedAmount ?? 0),
            holding?.currency ?? "INR",
          )}
        />
        <Metric
          label="Gain/Loss"
          value={formatCurrency(
            Number(holding?.pnlAmount ?? 0),
            holding?.currency ?? "INR",
          )}
          className={pnlClass}
        />
        <Metric
          label="Return"
          value={formatPercent(numberOrUndefined(holding?.pnlPercent))}
          className={pnlClass}
        />
      </section>

      <section className="grid grid-4" style={{ marginTop: 16 }}>
        <Metric
          label="Source XIRR"
          value={formatPercent(holding?.sourceXirr)}
          detail={
            holding?.sourceXirr === undefined ? "Needs cash flows" : "Imported"
          }
        />
        <Metric
          label="Portfolio weight"
          value={
            holding?.isCurrent === false
              ? "Exited"
              : formatPercent(holding?.portfolioWeight)
          }
          detail={
            holding?.isCurrent === false
              ? "Absent from latest snapshot"
              : undefined
          }
        />
        <Metric
          label="P&L contribution"
          value={formatPercent(holding?.pnlContribution)}
          className={pnlClass}
        />
        <Metric label="Snapshots" value={`${data?.history.length ?? 0}`} />
      </section>

      <section className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="panel panel-tall">
          <h2>Value history</h2>
          {(data?.history.length ?? 0) < 2 ? (
            <div className="quiet-empty">
              <FileSpreadsheet size={24} />
              <p>More dated uploads will build this holding history.</p>
            </div>
          ) : (
            <div className="trend-list">
              {data?.history.slice(-10).map((point) => (
                <div className="trend-row" key={point.id}>
                  <div>
                    <strong>{formatDate(point.snapshotDate)}</strong>
                    <span>
                      {formatCurrency(
                        Number(point.investedAmount),
                        point.currency,
                      )}
                    </span>
                  </div>
                  <div className="trend-track">
                    <span
                      style={{
                        width: `${trendWidth(point.currentValueInInr, historyValues)}%`,
                      }}
                    />
                  </div>
                  <strong>
                    {formatCurrency(Number(point.currentValue), point.currency)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel panel-tall">
          <h2>Holding facts</h2>
          <dl className="detail-list">
            <div>
              <dt>Quantity</dt>
              <dd>{holding?.quantity ?? "N/A"}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{holding ? formatDate(holding.snapshotDate) : "N/A"}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{holding?.currency ?? "N/A"}</dd>
            </div>
            <div>
              <dt>ISIN</dt>
              <dd>{holding?.isin ?? "N/A"}</dd>
            </div>
            <div>
              <dt>Exchange</dt>
              <dd>{holding?.exchange ?? "N/A"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="panel panel-tall" style={{ marginTop: 16 }}>
        <h2>Transactions</h2>
        {(data?.transactions.length ?? 0) === 0 ? (
          <div className="quiet-empty">
            <ReceiptText size={24} />
            <p>
              Transaction imports will unlock exact XIRR and realized gains.
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data?.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.tradeDate)}</td>
                  <td>{labelize(transaction.type)}</td>
                  <td>{transaction.quantity ?? "N/A"}</td>
                  <td>
                    {transaction.price
                      ? formatCurrency(
                          Number(transaction.price),
                          transaction.currency,
                        )
                      : "N/A"}
                  </td>
                  <td>
                    {formatCurrency(
                      Number(transaction.amount),
                      transaction.currency,
                    )}
                  </td>
                </tr>
              ))}
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

function MissingHolding() {
  return (
    <section className="empty-portfolio">
      <div>
        <p className="eyebrow">Not found</p>
        <h2>This holding was not found</h2>
        <p>It may have been replaced by a newer import or removed.</p>
      </div>
      <Link className="button secondary" href="/dashboard">
        Back to dashboard
      </Link>
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

function trendWidth(value: number, values: number[]) {
  const max = Math.max(...values, 1);
  return Math.max(6, Math.round((value / max) * 100));
}

"use client";

import Link from "next/link";
import {
  ArrowRight,
  FileSpreadsheet,
  PieChart,
  UploadCloud,
} from "lucide-react";
import { trpc } from "../providers";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function DashboardClient() {
  const summary = trpc.portfolio.summary.useQuery();
  const holdings = trpc.portfolio.holdings.useQuery();
  const hasHoldings = (holdings.data?.length ?? 0) > 0;
  const pnlClass =
    (summary.data?.pnlAmount ?? 0) >= 0 ? "positive" : "negative";

  return (
    <main className="page dashboard-page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Portfolio overview</h1>
          <p className="muted">
            Latest committed holdings across every account in your household.
          </p>
        </div>
        <Link className="button" href="/uploads">
          <UploadCloud size={18} />
          Upload file
        </Link>
      </section>

      {!hasHoldings ? <EmptyPortfolio /> : null}

      <section className="grid grid-4">
        <Metric
          label="Current value"
          value={currency.format(summary.data?.currentValue ?? 0)}
        />
        <Metric
          label="Invested"
          value={currency.format(summary.data?.investedAmount ?? 0)}
        />
        <Metric
          label="Gain/Loss"
          value={currency.format(summary.data?.pnlAmount ?? 0)}
          className={pnlClass}
        />
        <Metric
          label="Return"
          value={`${summary.data?.pnlPercent ?? 0}%`}
          className={pnlClass}
        />
      </section>

      <section className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="panel panel-tall">
          <h2>Allocation</h2>
          {(summary.data?.allocationByAssetClass.length ?? 0) === 0 ? (
            <div className="quiet-empty">
              <PieChart size={24} />
              <p>Allocation will appear after your first committed import.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Asset class</th>
                  <th>Value</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {summary.data?.allocationByAssetClass.map((item) => (
                  <tr key={item.assetClass}>
                    <td>{labelize(item.assetClass)}</td>
                    <td>{currency.format(item.currentValue)}</td>
                    <td>{item.weight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel panel-tall">
          <h2>Top holdings</h2>
          {(holdings.data?.length ?? 0) === 0 ? (
            <div className="quiet-empty">
              <FileSpreadsheet size={24} />
              <p>
                Holdings will show here once an upload is parsed and committed.
              </p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Account</th>
                  <th>Value</th>
                  <th>P&L</th>
                </tr>
              </thead>
              <tbody>
                {holdings.data?.slice(0, 8).map((holding) => (
                  <tr key={holding.id}>
                    <td>{holding.symbol ?? holding.instrumentName}</td>
                    <td>{holding.accountName}</td>
                    <td>{currency.format(Number(holding.currentValue))}</td>
                    <td
                      className={
                        Number(holding.pnlAmount ?? 0) >= 0
                          ? "positive"
                          : "negative"
                      }
                    >
                      {currency.format(Number(holding.pnlAmount ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}

function EmptyPortfolio() {
  return (
    <section className="empty-portfolio">
      <div>
        <p className="eyebrow">Start here</p>
        <h2>Import your first portfolio file</h2>
        <p>
          Upload a Tickertape holdings CSV, mutual fund CSV, Vested P&L
          workbook, or your current investment workbook. The app will stage the
          parsed rows before committing them to your private portfolio.
        </p>
      </div>
      <Link className="button secondary" href="/uploads">
        Go to uploads
        <ArrowRight size={18} />
      </Link>
    </section>
  );
}

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="panel metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${className ?? ""}`}>{value}</div>
    </div>
  );
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

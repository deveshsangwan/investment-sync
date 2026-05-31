import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { BarChart3, LockKeyhole, UploadCloud } from "lucide-react";

export default async function HomePage() {
  const session = await auth();
  if (session.userId) redirect("/dashboard");

  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Private portfolio tracker</p>
          <h1>Investment Sync</h1>
          <p className="landing-lede">
            Upload Tickertape, Vested, and workbook exports, then track stocks,
            mutual funds, US holdings, NPS, ULIPs, and crypto from one private
            dashboard.
          </p>
          <div className="landing-actions">
            <SignInButton mode="modal">
              <button className="button landing-button">
                <LockKeyhole size={18} />
                Sign in
              </button>
            </SignInButton>
          </div>
          <div className="landing-points" aria-label="Core workflow">
            <span>
              <UploadCloud size={16} />
              Upload files
            </span>
            <span>
              <BarChart3 size={16} />
              Review allocation
            </span>
            <span>
              <LockKeyhole size={16} />
              Clerk protected
            </span>
          </div>
        </div>

        <div
          className="portfolio-preview"
          aria-label="Portfolio dashboard preview"
        >
          <div className="preview-header">
            <div>
              <p className="eyebrow">Total portfolio</p>
              <strong>₹12,84,630</strong>
            </div>
            <span className="preview-badge positive">+8.4%</span>
          </div>
          <div className="preview-grid">
            <div>
              <span>Invested</span>
              <strong>₹11,84,200</strong>
            </div>
            <div>
              <span>Gain/Loss</span>
              <strong className="positive">₹1,00,430</strong>
            </div>
          </div>
          <div className="allocation-bars">
            <div style={{ "--bar": "74%" } as React.CSSProperties}>
              <span>Indian equities</span>
              <strong>52%</strong>
            </div>
            <div style={{ "--bar": "58%" } as React.CSSProperties}>
              <span>Mutual funds</span>
              <strong>31%</strong>
            </div>
            <div style={{ "--bar": "36%" } as React.CSSProperties}>
              <span>US stocks</span>
              <strong>12%</strong>
            </div>
          </div>
          <table className="preview-table">
            <tbody>
              <tr>
                <td>RELIANCE</td>
                <td>Indian Stocks</td>
                <td>₹32,074</td>
              </tr>
              <tr>
                <td>Parag Parikh ELSS</td>
                <td>Mutual Funds</td>
                <td>₹60,002</td>
              </tr>
              <tr>
                <td>NVDA</td>
                <td>US Stocks</td>
                <td>$1,101</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

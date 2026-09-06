import { FileSpreadsheet, Layers, WalletCards } from "lucide-react";

/** Decorative statement-to-portfolio diagram; figures are illustrative. */
export function PortfolioIllustration() {
  return (
    <div className="portfolio-art" aria-hidden="true">
      <div className="portfolio-art-source portfolio-art-source-first">
        <FileSpreadsheet size={18} />
        <span>
          Stocks<span className="portfolio-art-sub">Statement.csv</span>
        </span>
      </div>
      <div className="portfolio-art-source portfolio-art-source-second">
        <Layers size={18} />
        <span>
          Funds<span className="portfolio-art-sub">Holdings.xlsx</span>
        </span>
      </div>
      <div className="portfolio-art-result">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <WalletCards size={15} /> One portfolio
        </div>
        <p className="number mt-4 text-2xl font-semibold tracking-tight">
          ₹19,39,000<span className="text-sm text-muted-foreground">.00</span>
        </p>
        <svg
          className="my-4 h-16 w-full text-positive"
          viewBox="0 0 200 64"
          fill="none"
        >
          <path d="M0 56H200M0 28H200" stroke="currentColor" opacity=".12" />
          <path
            className="portfolio-draw"
            pathLength="1"
            d="M0 55L23 47L44 49L67 34L89 38L112 25L135 30L157 15L178 19L200 5"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
        <div className="flex justify-between border-t pt-3 text-[10px] text-muted-foreground">
          <span>All your statements.</span>
          <span>One clear view.</span>
        </div>
      </div>
    </div>
  );
}

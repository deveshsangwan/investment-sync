# Mono

A portfolio workspace informed by the quiet T3 desktop shell and Fold's asset hierarchy. Groww and the stock-logo reference guide the identity column and aligned returns.

Palette: canvas #000000, grouped panel #141414, control #1D1D1D, boundary #303030, text #F5F5F5, supporting text #A3A3A3. Green and red communicate labelled financial outcomes. Light mode uses the same neutral hierarchy.

Public Sans throughout, self-hosted. Body 14px, page title 28px, portfolio value 40px. Amounts use tabular numerals. Labels and descriptions stay sentence case.

```
Navigation  Portfolio                         Import statement
            Total value          Invested       Gain / Return
            Holdings dated ...
            Value history                      Allocation list
            Asset category        Asset category
            Largest holdings with identity marks
            Return calculation details, collapsed
```

Left-align identity and content, right-align monetary comparisons. Desktop uses space for side-by-side comparisons. Mobile stacks meaningful sections and keeps compact holding rows. Borders separate categories and selected controls; open sections avoid redundant card frames. Actions respond within 180ms and respect reduced motion.

Before building: merely recolouring the original dashboard would leave its repeated card headings and explanations intact. Replace its competing panels with a clear summary and value history, consolidate data-quality details behind disclosure, and add company identification consistently. Keep the real import and filtering flows. Missing logos use neutral initials; illustrative marks are identified. History comes only from dated records.

## Implementation review

The dashboard now uses an open summary and history, ranked allocation, grouped asset cards, and a compact holdings list. Return/source explanations remain available in a disclosure. Holding and asset details use the same neutral system with compressed mobile metrics. Mobile holdings keeps search and sort visible and discloses the four remaining filters. Authentication copy stays compact so the form appears early.

Microsoft, HDFC Bank and ICICI Bank have illustrative recognition marks, identified by tooltips and the overview note. Other holdings use neutral initials or category symbols. No logo service or backend metadata was added. The landing preview is explicitly illustrative. Production charts retain dated source records; no daily market data or row histories were fabricated.

Verification: web TypeScript and ESLint pass. All 13 existing web tests pass, with the expected asset label updated to the intended sentence case. Browser checks used the isolated sample-data preview for desktop overview/holdings and mobile holdings/auth/detail. Live Clerk authentication and real import commit are outside that mock preview.

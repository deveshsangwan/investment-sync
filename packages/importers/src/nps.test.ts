import { describe, expect, it } from "vitest";
import { detectImporter, npsDetailsSchema, parseImportFile } from "./index";

describe("NPS portal CSV importer", () => {
  it("parses one aggregate holding with allocation and statement activity", () => {
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(npsCsv()),
    });

    expect(result.sourceType).toBe("nps_csv");
    expect(result.warnings).toEqual([]);
    expect(result.rows).toHaveLength(1);
    const holding = result.rows[0];
    expect(holding).toMatchObject({
      kind: "holding",
      sourceType: "nps_csv",
      sourceDate: "2026-08-08",
      accountName: "NPS",
      provider: "NPS",
      instrumentName: "NPS",
      assetClass: "nps",
      currency: "INR",
      investedAmount: 900,
      currentValue: 1000,
      pnlAmount: 100,
    });
    if (!holding || holding.kind !== "holding") {
      throw new Error("Expected one normalized NPS holding");
    }
    expect(holding.metadata).toMatchObject({
      sourceSheet: "NPS",
      xirr: 10,
    });
    const details = npsDetailsSchema.parse(holding.metadata.npsDetails);
    expect(details).toMatchObject({
      schemaVersion: 1,
      tier: "I",
      schemeChoice: "ACTIVE CHOICE",
      contributionCount: 2,
      totalContribution: 900,
      totalWithdrawal: 0,
      charges: 10,
      schemes: [
        { code: "E", currentValue: 600, units: 6, nav: 100 },
        { code: "C", currentValue: 400, units: 4, nav: 100 },
      ],
      contributionEvents: [
        {
          type: "contribution",
          date: "2026-08-01",
          employeeAmount: 100,
          employerAmount: 0,
          totalAmount: 100,
        },
      ],
    });
    expect(details.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemeCode: "E",
          date: "2026-08-01",
          description: "By Contribution",
          amount: 100,
          nav: 100,
          units: 1,
        }),
      ]),
    );
  });

  it("uses net contributions when withdrawals are present", () => {
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(
        npsCsv({ totalContribution: 900, totalWithdrawal: 100, pnl: 200 }),
      ),
    });

    expect(result.rows[0]).toMatchObject({
      kind: "holding",
      investedAmount: 800,
      currentValue: 1000,
      pnlAmount: 200,
      pnlPercent: 25,
    });
  });

  it("warns on derived mismatches without rejecting the statement", () => {
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(npsCsv({ pnl: 50, schemeCValue: 300 })),
    });

    expect(result.rows).toHaveLength(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("notional gain/loss"),
        expect.stringContaining("scheme values"),
      ]),
    );
  });

  it("accepts a statement with no contribution or activity rows", () => {
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(npsCsv({ includeActivity: false })),
    });
    const holding = result.rows[0];
    expect(holding?.kind).toBe("holding");
    if (!holding || holding.kind !== "holding") {
      throw new Error("Expected one normalized NPS holding");
    }
    expect(npsDetailsSchema.parse(holding.metadata.npsDetails)).toMatchObject({
      contributionEvents: [],
      activities: [],
    });
  });

  it("accepts a statement that omits both optional detail sections", () => {
    const content = npsCsv().replace(
      /\nContribution\/Redemption Details[\s\S]*$/,
      "",
    );
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(content),
    });
    const holding = result.rows[0];
    if (!holding || holding.kind !== "holding") {
      throw new Error("Expected one normalized NPS holding");
    }

    expect(npsDetailsSchema.parse(holding.metadata.npsDetails)).toMatchObject({
      contributionEvents: [],
      activities: [],
    });
  });

  it("warns when an optional detail section has an unrecognized header", () => {
    const content = npsCsv().replace(
      "Employer's Contribution(Rs)",
      "Employer Contribution(Rs)",
    );
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(content),
    });

    expect(result.warnings).toContain(
      "NPS Contribution Details has an unrecognized header",
    );
  });

  it("normalizes typographic apostrophes and warns on malformed data rows", () => {
    const content = npsCsv()
      .replace("Employer's Contribution(Rs)", "Employer’s Contribution(Rs)")
      .replace("01/08/2026,Contribution", "invalid,Contribution");
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(content),
    });

    expect(result.warnings).toContain(
      "NPS contribution row 1 has an invalid date and was skipped",
    );
  });

  it("preserves redemptions and reports malformed optional amounts", () => {
    const content = npsCsv()
      .replace(
        "01/08/2026,Contribution,Portal,100,0,100",
        "01/08/2026,Redemption,Portal,bad,0,100",
      )
      .replace("By Contribution,100,100,1", "By Contribution,bad,100,1");
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(content),
    });
    const holding = result.rows[0];
    if (!holding || holding.kind !== "holding") {
      throw new Error("Expected one normalized NPS holding");
    }

    expect(
      npsDetailsSchema.parse(holding.metadata.npsDetails).contributionEvents,
    ).toEqual([
      {
        type: "redemption",
        date: "2026-08-01",
        employeeAmount: 0,
        employerAmount: 0,
        totalAmount: 100,
      },
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "invalid contribution/redemption row 1 employee amount",
        ),
        expect.stringContaining("invalid transaction row 1 amount"),
      ]),
    );
  });

  it("accepts portal spacing drift and implicit contribution labels", () => {
    const content = npsCsv()
      .replace(
        "Total Contribution in your account as on August",
        "Total Contribution in your account as onAugust",
      )
      .replace("Total Withdrawal as on August", "Total Withdrawal as onAugust")
      .replace(
        "Total Notional Gain/Loss as on August",
        "Total Notional Gain/Loss as onAugust",
      )
      .replace(
        "01/08/2026,Contribution,Portal,100,0,100",
        "11-May-2026,For April 2026,Portal,100,0,100",
      );
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(content),
    });
    const holding = result.rows[0];
    if (!holding || holding.kind !== "holding") {
      throw new Error("Expected one normalized NPS holding");
    }

    expect(
      npsDetailsSchema.parse(holding.metadata.npsDetails).contributionEvents[0],
    ).toMatchObject({ type: "contribution", date: "2026-05-11" });
  });

  it("validates detail dates as real calendar dates", () => {
    expect(() =>
      npsDetailsSchema.parse({
        schemaVersion: 1,
        tier: "I",
        totalContribution: 0,
        totalWithdrawal: 0,
        schemes: [
          {
            code: "E",
            sourceName: "Scheme E",
            currentValue: 1,
            units: 1,
            nav: 1,
          },
        ],
        contributionEvents: [
          {
            type: "contribution",
            date: "2026-02-30",
            employeeAmount: 1,
            employerAmount: 0,
            totalAmount: 1,
          },
        ],
        activities: [],
      }),
    ).toThrow();
  });

  it("rejects duplicate required scheme columns", () => {
    const content = npsCsv().replace(
      "Total Units ( U ),NAV as on",
      "Total Units ( U ),Total Units (duplicate),NAV as on",
    );

    expect(() =>
      parseImportFile({ fileName: "nps.csv", content: Buffer.from(content) }),
    ).toThrow("duplicate field: total units");
  });

  it("finds statement headings beyond a fixed preamble window", () => {
    const preamble = Array.from({ length: 20 }, () => "Portal preamble").join(
      "\n",
    );
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(`${preamble}\n${npsCsv()}`),
    });
    expect(result.sourceType).toBe("nps_csv");

    expect(() =>
      parseImportFile({
        fileName: "nps.csv",
        content: Buffer.from(
          `${npsCsv()}\nNPS Transaction Statement for Tier II Account`,
        ),
      }),
    ).toThrow("Combined Tier I and Tier II");
  });

  it("rejects unsupported and ambiguous tiers", () => {
    expect(() =>
      parseImportFile({
        fileName: "nps.csv",
        content: Buffer.from(npsCsv({ tier: "II" })),
      }),
    ).toThrow("Tier II NPS statements are not supported yet");
    expect(() =>
      parseImportFile({
        fileName: "nps.csv",
        content: Buffer.from(npsCsv({ tier: "I and Tier II" })),
      }),
    ).toThrow("Combined Tier I and Tier II");
  });

  it("does not claim unrelated CSV files", () => {
    expect(
      detectImporter({
        fileName: "holdings.csv",
        content: Buffer.from("Security,Quantity,Current Value\nABC,1,100"),
      })?.sourceType,
    ).not.toBe("nps_csv");
  });

  it("does not leak subscriber details into output or errors", () => {
    const privateName = "PRIVATE SUBSCRIBER";
    const privatePran = "123456789012";
    const result = parseImportFile({
      fileName: "nps.csv",
      content: Buffer.from(npsCsv({ privateName, privatePran })),
    });
    expect(JSON.stringify(result)).not.toContain(privateName);
    expect(JSON.stringify(result)).not.toContain(privatePran);

    let errorText = "";
    try {
      parseImportFile({
        fileName: "nps.csv",
        content: Buffer.from(
          npsCsv({ privateName, privatePran }).replace("Rs 1000", "bad"),
        ),
      });
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    }
    expect(errorText).not.toContain(privateName);
    expect(errorText).not.toContain(privatePran);
  });
});

function npsCsv({
  tier = "I",
  totalContribution = 900,
  totalWithdrawal = 0,
  pnl = 100,
  schemeCValue = 400,
  includeActivity = true,
  privateName = "SANITIZED NAME",
  privatePran = "000000000000",
}: {
  tier?: string;
  totalContribution?: number;
  totalWithdrawal?: number;
  pnl?: number;
  schemeCValue?: number;
  includeActivity?: boolean;
  privateName?: string;
  privatePran?: string;
} = {}) {
  const title =
    tier === "I and Tier II"
      ? "NPS Transaction Statement for Tier I Account Tier II Account"
      : `NPS Transaction Statement for Tier ${tier} Account`;
  return `${title}

Subscriber Details

PRAN,${privatePran}
Subscriber Name,${privateName}
Statement Generation Date :August 08 2026 05:32 PM
Scheme Choice - ACTIVE CHOICE

Investment Summary

Value of your Holdings(Investments)as on August 08 2026 (in Rs),No of Contributions,Total Contribution in your account as on August 08 2026 (in Rs),Total Withdrawal as on August 08 2026 (in Rs),Total Notional Gain/Loss as on August 08 2026 (in Rs),Withdrawal/ deduction in units towards intermediary charges (in Rs),Return on Investment(XIRR),10%,
(A),,(B),(C),D=(A-B)+C,E,,,
Rs 1000,2,Rs ${totalContribution},Rs ${totalWithdrawal},Rs ${pnl},Rs 10,,,


Investment Details - Scheme Wise Summary
Particulars,Scheme wise Value of your Holdings(Investments) (in Rs) (E = U * N),Total Units ( U ),NAV as on 07-Aug-2026 ( N ),
NPS TRUST- A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME E - TIER I POP,Rs 600,6,100,
NPS TRUST- A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME C - TIER I POP,Rs ${schemeCValue},4,100,

Contribution/Redemption Details during the selected period

Date,Particulars,Uploaded By,Employee Contribution(Rs),Employer's Contribution(Rs),Total(Rs),
${includeActivity ? "01/08/2026,Contribution,Portal,100,0,100," : ""}


Transaction Details


${
  includeActivity
    ? `NPS TRUST- A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME E - TIER I POP
Date,Description,Amount (in Rs),NAV,Units
01/08/2026,By Contribution,100,100,1
08/08/2026,Closing Balance,,,6

NPS TRUST- A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME C - TIER I POP
Date,Description,Amount (in Rs),NAV,Units
08/08/2026,Closing Balance,,,4`
    : ""
}`;
}

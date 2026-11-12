// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { ManualEntryClient } from "./manual-entry-client";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(name: string) => unknown>(),
  save: vi.fn(() =>
    Promise.resolve({
      policyId: "imported-position",
      batchId: "new-batch",
    }),
  ),
}));
vi.mock("convex/react", () => ({
  useQuery: (query: Parameters<typeof getFunctionName>[0]) =>
    mocks.query(getFunctionName(query)),
  useMutation: () => mocks.save,
}));
vi.mock("@/app/convex-provider", () => ({
  ConvexSessionGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/convex-query-boundary", () => ({
  ConvexQueryBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/portfolio-ui", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
  PageHeader: () => null,
  Panel: ({ children }: { children: ReactNode }) => children,
  EmptyState: () => null,
}));
vi.mock("@/components/amounts", () => ({
  Money: () => null,
  useAmountFormatters: () => ({ formatInr: (value: number) => String(value) }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each(["committed", "failed", "parsed"])(
  "loads saved imported values and submits their locked labels when the source batch is %s",
  async (status) => {
    mocks.query.mockImplementation((name) => {
      if (name === "users:current") return { role: "owner" };

      if (name === "manualPolicies:list")
        return [
          {
            id: "imported-position",
            provider: "Manual Workbook",
            name: "Bajaj Allianz Goal Assure",
            canEditNames: false,
            values: {
              investedAmount: "160000",
              currentValue: "183751",
              sourceDate: "2026-05-15",
            },
            draftValues: null,
            entry: { id: "source-batch", status, errorMessage: null },
          },
        ];

      return null;
    });

    render(<ManualEntryClient initialPolicyId="imported-position" />);

    expect(screen.queryAllByText("Not set")).toHaveLength(0);
    expect(
      screen
        .getByRole("textbox", { name: "Amount paid" })
        .getAttribute("value"),
    ).toBe("160000");
    const currentValue = screen.getByRole("textbox", { name: "Current value" });
    await userEvent.clear(currentValue);
    await userEvent.type(currentValue, "211077");
    await userEvent.click(screen.getByRole("button", { name: "Save update" }));

    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: "imported-position",
          expectedBatchId: "source-batch",
          provider: "Manual Workbook",
          name: "Bajaj Allianz Goal Assure",
          currentValue: "211077",
        }),
      ),
    );
  },
);

it("retains unsaved manual values and their original value date", async () => {
  mocks.query.mockImplementation((name) => {
    if (name === "users:current") return { role: "owner" };

    if (name === "manualPolicies:list")
      return [
        {
          id: "manual-policy",
          provider: "Bajaj Life",
          name: "Goal Assure",
          canEditNames: true,
          values: {
            investedAmount: "160000",
            currentValue: "183751",
            sourceDate: "2026-05-15",
          },
          draftValues: {
            investedAmount: "180000",
            currentValue: "211077",
            sourceDate: "2026-05-16",
          },
          entry: { id: "draft-batch", status: "parsed", errorMessage: null },
        },
      ];

    return null;
  });

  render(<ManualEntryClient initialPolicyId="manual-policy" />);

  expect(
    screen.getByRole("textbox", { name: "Amount paid" }).getAttribute("value"),
  ).toBe("180000");
  expect(
    screen
      .getByRole("textbox", { name: "Current value" })
      .getAttribute("value"),
  ).toBe("211077");
  expect(screen.getByDisplayValue("2026-05-16")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Save update" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: "manual-policy",
        expectedBatchId: "draft-batch",
        sourceDate: "2026-05-16",
        currentValue: "211077",
      }),
    ),
  );
});

// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ManualPolicyForm } from "./manual-policy-form";

vi.mock("@/components/amounts", () => ({
  useAmountFormatters: () => ({ formatInr: (value: number) => String(value) }),
}));

afterEach(cleanup);

it.each([false, true])(
  "accepts long locked imported labels while retaining manual name limits, editable: %s",
  async (canEditNames) => {
    const values = {
      provider: "Imported provider ".repeat(10),
      name: "Imported policy ".repeat(20),
      investedAmount: "100",
      currentValue: "130",
      sourceDate: "2026-01-01",
    };
    const onSave = vi.fn(async () => {});
    render(
      <ManualPolicyForm
        values={values}
        onChange={vi.fn()}
        isUpdating
        isBusy={false}
        canEditNames={canEditNames}
        onSave={onSave}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save update" }));

    if (canEditNames) {
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
      return;
    }

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(values));
  },
);

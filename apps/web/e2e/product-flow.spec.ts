import { vestedWorkbook } from "../../../packages/importers/src/vested-fixtures";
import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@investment-sync/backend/api";
import { parserGoldenFixtures } from "../../../packages/importers/src/golden-fixtures";

test.describe.configure({ mode: "serial" });

const fixtures = parserGoldenFixtures();
function fixture(name: string) {
  const value = fixtures.find((candidate) => candidate.name === name);

  if (!value) throw new Error(`Missing fake parser fixture: ${name}`);

  return {
    name: value.file.fileName,
    mimeType: "text/csv",
    buffer: Buffer.from(
      value.file.content
        .toString("utf8")
        .replaceAll("250.00", "250.25")
        .replaceAll(",250,", ",250.25,"),
    ),
  };
}

async function signIn(page: Page, subject = "e2e_owner") {
  await page.goto("/uploads");
  await page.getByRole("button", { name: subject, exact: true }).click();
  await expect(page.getByText("Loading import permissions")).toBeHidden();
}
async function review(page: Page, file = fixture("tickertape stock")) {
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Review file", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review import" }),
  ).toBeVisible();
}
// Rendered only by the done step, never by applying, failed or history states.
function importAnotherButton(page: Page) {
  return page.getByRole("button", { name: "Import another", exact: true });
}
async function apply(page: Page) {
  await page
    .getByRole("button", { name: "Apply import", exact: true })
    .first()
    .click();
  await expect(importAnotherButton(page)).toBeVisible();
}
async function clientFor(subject: string) {
  const token = await fetch(`http://127.0.0.1:3220/token/${subject}`).then(
    (response) => response.text(),
  );
  const client = new ConvexHttpClient("http://127.0.0.1:3218");
  client.setAuth(token);
  return client;
}

test("signed identity uploads, parses, reviews, commits and sees exact multi-account dashboard totals", async ({
  page,
}) => {
  await page.goto("/uploads");
  await expect(
    page.getByText("Sign in with a local test identity"),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await signIn(page);
  await review(page);
  await expect(page.getByText("FAKECO", { exact: true }).first()).toBeVisible();
  await apply(page);
  await page
    .getByRole("button", { name: "Import another", exact: true })
    .click();
  await review(page, fixture("tickertape mutual fund"));
  await apply(page);
  await page.getByRole("link", { name: "View portfolio", exact: true }).click();

  const summary = page.getByRole("region", { name: "Portfolio summary" });
  await expect(summary).toContainText("500");
  await expect(summary).toContainText(".50");
  await expect(page.getByText("FAKECO", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Fake Equity Fund", { exact: true }),
  ).toBeVisible();

  const client = await clientFor("e2e_owner");
  const overview = await client.query(api.portfolio.overview, {});
  expect(overview.summary.currentValue).toBe(500.5);
  expect(
    overview.holdings.map((holding) => holding.accountName).sort(),
  ).toEqual(["Indian Stocks", "Mutual Funds"]);
  expect(overview.holdings.map((holding) => holding.snapshotDate)).toEqual([
    "2026-05-16",
    "2026-05-16",
  ]);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Portfolio summary" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "e2e_other", exact: true }).click();
  await expect(page.getByText("FAKECO", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Import your first portfolio file", { exact: true }),
  ).toBeVisible();
  const other = await clientFor("e2e_other");
  expect((await other.query(api.portfolio.overview, {})).holdings).toEqual([]);
});

test("duplicate file commits from independent browser sessions cannot double the portfolio", async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  try {
    await Promise.all([signIn(firstPage), signIn(secondPage)]);
    const original = fixture("tickertape stock");
    const concurrentFile = {
      ...original,
      buffer: Buffer.concat([original.buffer, Buffer.from("\n")]),
    };
    await Promise.all([
      review(firstPage, concurrentFile),
      review(secondPage, concurrentFile),
    ]);
    await Promise.all(
      [firstPage, secondPage].map((page) =>
        page
          .getByRole("button", { name: "Apply import", exact: true })
          .first()
          .click(),
      ),
    );
    await Promise.all(
      [firstPage, secondPage].map((page) =>
        expect(
          importAnotherButton(page).or(
            page.getByRole("heading", {
              name: "This import could not be applied",
            }),
          ),
        ).toBeVisible(),
      ),
    );
    const appliedCounts = await Promise.all(
      [firstPage, secondPage].map((page) => importAnotherButton(page).count()),
    );
    expect(appliedCounts.sort()).toEqual([0, 1]);

    const client = await clientFor("e2e_owner");
    expect(
      (await client.query(api.portfolio.overview, {})).summary.currentValue,
    ).toBe(500.5);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("invalid parser input fails, retries the retained source, and leaves the portfolio intact", async ({
  page,
}) => {
  const retryRequests = new Set<number>();
  let retryAccepted = false;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const message: unknown = JSON.parse(String(payload));
      if (
        message &&
        typeof message === "object" &&
        "udfPath" in message &&
        message.udfPath === "imports:retryParse" &&
        "requestId" in message &&
        typeof message.requestId === "number"
      ) {
        retryRequests.add(message.requestId);
      }
    });
    socket.on("framereceived", ({ payload }) => {
      const message: unknown = JSON.parse(String(payload));
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "MutationResponse" &&
        "requestId" in message &&
        typeof message.requestId === "number" &&
        retryRequests.has(message.requestId) &&
        "success" in message &&
        message.success === true
      ) {
        retryAccepted = true;
      }
    });
  });
  await signIn(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "fake-invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("invalid,headers\nnot,a,portfolio"),
  });
  await page.getByRole("button", { name: "Review file", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This file could not be prepared" }),
  ).toBeVisible();
  const client = await clientFor("e2e_owner");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This file could not be prepared" }),
  ).toBeVisible();

  await expect.poll(() => retryAccepted).toBe(true);
  await expect
    .poll(async () => {
      const history = await client.query(api.imports.list, {
        paginationOpts: { cursor: null, numItems: 20 },
      });
      const failed = history.page.find(
        (batch) => batch.fileName === "fake-invalid.csv",
      );

      return { status: failed?.status, fileAvailable: failed?.fileAvailable };
    })
    .toEqual({ status: "failed", fileAvailable: true });
  expect(
    (await client.query(api.portfolio.overview, {})).summary.currentValue,
  ).toBe(500.5);
});

test("viewer sees history but upload and commit are rejected by the actual backend", async ({
  page,
}) => {
  await signIn(page, "e2e_viewer");
  await expect(
    page.getByText("Only household owners can import files"),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review file", exact: true }),
  ).toHaveCount(0);

  const client = await clientFor("e2e_viewer");
  await expect(
    client.mutation(api.imports.createUpload, {
      fileName: "fake.csv",
      sizeBytes: 1,
    }),
  ).rejects.toThrow();
  const history = await client.query(api.imports.list, {
    paginationOpts: { cursor: null, numItems: 20 },
  });
  const batch = history.page.find((item) => item.status === "parsed");
  if (!batch)
    throw new Error("Expected duplicate parsed batch from previous scenario");
  await expect(
    client.mutation(api.imports.commit, { batchId: batch.id }),
  ).rejects.toThrow();
});

test("storage transport failure is visible and a second real upload recovers", async ({
  page,
}) => {
  await signIn(page, "e2e_other");
  await page.route(
    "http://127.0.0.1:3218/api/storage/upload*",
    (route) => route.fulfill({ status: 503, body: "Temporary test outage" }),
    { times: 1 },
  );
  await page
    .locator('input[type="file"]')
    .setInputFiles(fixture("tickertape stock"));
  await page.getByRole("button", { name: "Review file", exact: true }).click();
  await expect(
    page.getByText("Upload failed. Please try again."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review file", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review import" }),
  ).toBeVisible();
});

test("owner manages archived accounts and email-bound invitations while shared viewers stay isolated", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  const account = page
    .getByRole("listitem")
    .filter({ hasText: "Indian Stocks" });
  await account.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByLabel("Account name", { exact: true })
    .fill("Shared stock account");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  const renamed = page
    .getByRole("listitem")
    .filter({ hasText: "Shared stock account" });
  await expect(
    renamed.getByRole("button", { name: "Archive", exact: true }),
  ).toBeVisible();
  await renamed.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    renamed.getByRole("button", { name: "Unarchive", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Portfolio summary" }),
  ).toContainText("250");
  await expect(page.getByText("FAKECO", { exact: true })).toHaveCount(0);
  const owner = await clientFor("e2e_owner");
  expect(
    (await owner.query(api.portfolio.overview, {})).summary.currentValue,
  ).toBe(250.25);

  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  await renamed.getByRole("button", { name: "Unarchive", exact: true }).click();
  await expect(
    renamed.getByRole("button", { name: "Archive", exact: true }),
  ).toBeVisible();
  expect(
    (await owner.query(api.portfolio.overview, {})).summary.currentValue,
  ).toBe(500.5);
  expect(
    (await owner.query(api.portfolio.positions, {})).current.find(
      (holding) => holding.symbol === "FAKECO",
    )?.accountName,
  ).toBe("Shared stock account");

  await page
    .getByLabel("Invitee email", { exact: true })
    .fill("e2e_other@example.invalid");
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  await expect(
    page.getByLabel("Invitation link", { exact: true }),
  ).toBeVisible();
  const revokedLink = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  await page
    .getByRole("listitem")
    .filter({ hasText: "e2e_other@example.invalid" })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await expect(
    page.getByText("No pending invitations.", { exact: true }),
  ).toBeVisible();
  const other = await clientFor("e2e_other");
  const originalHousehold = await other.query(api.users.current, {});
  const revokedToken = new URLSearchParams(
    new URL(revokedLink).hash.slice(1),
  ).get("invite");
  if (!revokedToken) throw new Error("Missing generated test token");
  await expect(
    other.mutation(api.households.acceptInvite, { token: revokedToken }),
  ).rejects.toThrow();
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  await expect(
    page.getByLabel("Invitation link", { exact: true }),
  ).toBeVisible();
  const link = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("invite");
  if (!token) throw new Error("Missing generated test token");

  const context = await browser.newContext();
  const sharedPage = await context.newPage();
  try {
    await sharedPage.goto(link);
    await sharedPage
      .getByRole("button", { name: "e2e_other", exact: true })
      .click();
    await sharedPage
      .getByRole("button", { name: "Accept invitation as viewer", exact: true })
      .click();
    await expect(
      sharedPage.getByRole("heading", { name: "Accounts", exact: true }),
    ).toBeVisible();
    await expect(
      sharedPage.getByText("Shared stock account", { exact: true }),
    ).toBeVisible();
    await expect(
      sharedPage.getByRole("button", { name: "Rename", exact: true }),
    ).toHaveCount(0);
    await expect(
      sharedPage.getByRole("button", {
        name: "Create invitation link",
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await other.query(api.users.current, {})).role).toBe("viewer");
    const [sharedAccount] = await other.query(api.accounts.list, {});
    if (!sharedAccount) throw new Error("Missing shared account");
    await expect(
      other.mutation(api.accounts.update, {
        accountKey: sharedAccount.id,
        isArchived: true,
      }),
    ).rejects.toThrow();
    await expect(
      other.mutation(api.households.acceptInvite, { token }),
    ).rejects.toThrow();

    await sharedPage
      .getByRole("button", { name: /My Portfolio \(owner\)/ })
      .click();
    await expect(
      sharedPage.getByText("No portfolio accounts yet", { exact: true }),
    ).toBeVisible();
    expect((await other.query(api.users.current, {})).householdId).toBe(
      originalHousehold.householdId,
    );
    expect((await other.query(api.portfolio.overview, {})).holdings).toEqual(
      [],
    );
    await sharedPage
      .getByRole("button", { name: /My Portfolio \(viewer\)/ })
      .click();
    await expect(
      sharedPage.getByText("Shared stock account", { exact: true }),
    ).toBeVisible();

    const member = page
      .getByRole("listitem")
      .filter({ hasText: "e2e_other@example.invalid" });
    await member.getByRole("button", { name: "Remove", exact: true }).click();
    await member
      .getByRole("button", { name: "Confirm removal", exact: true })
      .click();
    await expect(
      sharedPage.getByText("No portfolio accounts yet", { exact: true }),
    ).toBeVisible();
    await expect(
      other.mutation(api.households.acceptInvite, { token }),
    ).rejects.toThrow();

    const nextOwner = page
      .getByRole("listitem")
      .filter({ hasText: "e2e_viewer@example.invalid" });
    await nextOwner
      .getByRole("button", { name: "Transfer ownership", exact: true })
      .click();
    await expect(
      nextOwner.getByRole("button", { name: "Confirm transfer", exact: true }),
    ).toBeDisabled();
    await nextOwner
      .getByLabel("Confirmation", { exact: true })
      .fill("TRANSFER");
    await nextOwner
      .getByRole("button", { name: "Confirm transfer", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Create invitation link", exact: true }),
    ).toHaveCount(0);
    const successor = await clientFor("e2e_viewer");
    expect((await successor.query(api.users.current, {})).role).toBe("owner");
    expect(
      (await successor.query(api.households.auditEvents, {})).map(
        (event) => event.action,
      ),
    ).toEqual(
      expect.arrayContaining([
        "invite.created",
        "invite.revoked",
        "invite.accepted",
        "member.removed",
        "ownership.transferred",
      ]),
    );
  } finally {
    await context.close();
  }
});

test("reported partial sale lots render acquisition dates and native amounts on the production holding detail", async ({
  page,
}) => {
  const workbook = vestedWorkbook({
    holdings: [["FAKE", "8", "80", "96", "16"]],
    sales: [
      [
        "FAKE",
        "2025-02-15",
        "2024-01-01",
        "1.5",
        "30",
        "15",
        "15",
        "fake-execution",
        "fake-lot-1",
      ],
      [
        "FAKE",
        "2025-02-15",
        "2024-02-01",
        "0.5",
        "10",
        "7",
        "3",
        "fake-execution",
        "fake-lot-2",
      ],
    ],
    summary: [["FAKE", "2", "40", "22", "18"]],
  });
  await signIn(page, "e2e_sales");
  await review(page, {
    name: workbook.fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(workbook.content),
  });
  await apply(page);
  await page.getByRole("link", { name: "View portfolio", exact: true }).click();
  await page
    .locator('a[href^="/dashboard/holdings/"]')
    .filter({ hasText: "FAKE" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Realized sales", exact: true }),
  ).toBeVisible();
  const firstLot = page.getByRole("row").filter({ hasText: "fake-lot-1" });
  await expect(firstLot).toContainText("15 Feb 2025");
  await expect(firstLot).toContainText("01 Jan 2024");
  await expect(firstLot).toContainText("$30");
  await expect(firstLot).toContainText("+$15");
  await expect(
    page.getByRole("row").filter({ hasText: "fake-lot-2" }),
  ).toContainText("01 Feb 2024");
  await expect(
    page.getByText("Not in latest snapshot", { exact: true }),
  ).toHaveCount(0);

  const client = await clientFor("e2e_sales");
  const positions = await client.query(api.portfolio.positions, {});
  expect(positions.current).toHaveLength(1);
  expect(positions.exited).toEqual([]);
  const [position] = positions.current;
  if (!position) throw new Error("Missing partial-sale position");
  const detail = await client.query(api.portfolio.holdingDetail, {
    positionKey: position.id,
  });
  expect(detail?.holding).toMatchObject({
    isCurrent: true,
    quantity: "8",
    currentValue: "96",
  });
  expect(
    detail?.sales.map((sale) => ({
      proceeds: sale.proceeds,
      costBasis: sale.costBasis,
      realizedPnl: sale.realizedPnl,
    })),
  ).toEqual([
    { proceeds: "30", costBasis: "15", realizedPnl: "15" },
    { proceeds: "10", costBasis: "7", realizedPnl: "3" },
  ]);
});

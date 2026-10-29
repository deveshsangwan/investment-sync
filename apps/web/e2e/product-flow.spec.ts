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
    page.getByRole("heading", { name: "Review detected data" }),
  ).toBeVisible();
}
async function apply(page: Page) {
  await page
    .getByRole("button", { name: "Apply import", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Import applied", exact: true }),
  ).toBeVisible();
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
          page.getByRole("heading", {
            name: /^(Import applied|This import could not be applied)$/,
          }),
        ).toBeVisible(),
      ),
    );
    const appliedCounts = await Promise.all(
      [firstPage, secondPage].map((page) =>
        page
          .getByRole("heading", { name: "Import applied", exact: true })
          .count(),
      ),
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
  const history = await client.query(api.imports.list, {
    paginationOpts: { cursor: null, numItems: 20 },
  });
  const failed = history.page.find(
    (batch) => batch.fileName === "fake-invalid.csv",
  );
  expect(failed).toMatchObject({ status: "failed", fileAvailable: true });
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
    page.getByRole("heading", { name: "Review detected data" }),
  ).toBeVisible();
});

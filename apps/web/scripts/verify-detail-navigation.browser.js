// Run with agent-browser eval --stdin in an authenticated production-build
// session on /dashboard. Requires US stock and NPS positions in development.
window.verifyDetailNavigation = async ({ dwellMs = 0 } = {}) => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const loadingSelector = '[aria-label="Loading portfolio data"]';
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (condition()) return;
      await pause(50);
    }

    throw new Error("Navigation did not settle");
  };
  const navigate = async (path) => {
    const link = [...document.querySelectorAll("a")].find(
      (element) => element.getAttribute("href") === path,
    );
    if (!link) throw new Error("Required navigation link is missing");

    link.click();
    await waitFor(() => location.pathname === path);
    await pause(600);
    await waitFor(() => !document.querySelector(loadingSelector));
  };

  await waitFor(() =>
    document.querySelector('a[href^="/dashboard/holdings/"]'),
  );
  const holdingPath = document
    .querySelector('a[href^="/dashboard/holdings/"]')
    .getAttribute("href");
  const targets = [
    { page: "US stocks", path: "/dashboard/asset-class/us_stock" },
    { page: "NPS", path: "/dashboard/asset-class/nps" },
    { page: "Holding", path: holdingPath },
  ];
  const receipts = [];

  for (const { page, path } of targets) {
    await navigate(path);
    const expectedHeading = document.querySelector("h1")?.textContent;
    if (!expectedHeading) throw new Error("Detail heading is missing");

    // A long visit must not consume the retention period that starts on leave.
    const dwellStartedAt = Date.now();
    if (page === "US stocks") await pause(dwellMs);
    const elapsedDwellMs = Date.now() - dwellStartedAt;
    await navigate("/dashboard");

    let loadingSeen = false;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches(loadingSelector) ||
              node.querySelector(loadingSelector))
          ) {
            loadingSeen = true;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    try {
      await navigate(path);
    } finally {
      observer.disconnect();
    }

    const correctHeading =
      document.querySelector("h1")?.textContent === expectedHeading;
    receipts.push({ page, loadingSeen, correctHeading, elapsedDwellMs });
    await navigate("/dashboard");
  }

  if (
    receipts.some(
      ({ loadingSeen, correctHeading }) => loadingSeen || !correctHeading,
    )
  ) {
    throw new Error(JSON.stringify(receipts));
  }

  return receipts;
};

window.verifyDetailNavigation();

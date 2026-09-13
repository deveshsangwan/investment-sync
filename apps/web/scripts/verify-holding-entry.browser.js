// Run with agent-browser eval --stdin after opening /holdings in an
// authenticated production-build session. A fresh page load exercises the
// ancestor /dashboard fallback before the holding route has been visited.
(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (condition()) return;
      await pause(50);
    }

    throw new Error("Holding navigation did not settle");
  };

  await waitFor(() =>
    document.querySelector('a[href^="/dashboard/holdings/"]'),
  );
  let wrongOverviewSeen = false;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;

        for (const heading of [node, ...node.querySelectorAll("h1")]) {
          if (heading.matches("h1") && heading.textContent === "Portfolio") {
            wrongOverviewSeen = true;
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  try {
    document.querySelector('a[href^="/dashboard/holdings/"]').click();
    await waitFor(() => location.pathname.startsWith("/dashboard/holdings/"));
    await waitFor(() => {
      const heading = document.querySelector("h1")?.textContent;
      return (
        heading &&
        !["Portfolio", "Holdings", "Holding"].includes(heading) &&
        !document.querySelector('[aria-label="Loading portfolio data"]')
      );
    });
    await pause(300);
  } finally {
    observer.disconnect();
  }

  const receipt = { wrongOverviewSeen, holdingLoaded: true };
  if (wrongOverviewSeen) throw new Error(JSON.stringify(receipt));

  return receipt;
})();

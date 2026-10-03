// Run with agent-browser eval --stdin in an authenticated development session
// on /holdings with enough positions to scroll. Re-run the installed function
// with { back: "browser" } or { dwellMs: 122000 } to check browser Back or expiry.
window.verifyHoldingsScroll = async ({
  back = "app",
  dwellMs = 0,
  position = "middle",
} = {}) => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (condition()) return;
      await pause(50);
    }

    throw new Error("Holdings navigation did not settle");
  };
  const holdingSelector = 'a[href^="/dashboard/holdings/"]';
  await waitFor(
    () =>
      location.pathname === "/holdings" &&
      document.querySelector(holdingSelector),
  );
  const links = [...document.querySelectorAll(holdingSelector)].filter(
    (link) => link.getBoundingClientRect().height > 0,
  );
  const link =
    links[
      position === "end" ? links.length - 1 : Math.floor(links.length * 0.65)
    ];
  if (!link) throw new Error("No visible holding link");

  link.scrollIntoView({ block: "center", behavior: "instant" });
  const before = window.scrollY;
  if (before < 100)
    throw new Error("List is too short to test scroll restoration");

  const search = document.querySelector('input[type="search"]')?.value;
  const readSort = () => {
    const label = [...document.querySelectorAll("label")].find(
      (element) => element.textContent === "Sort holdings",
    );
    if (!label?.control) throw new Error("Sort control is missing");

    return label.control.textContent;
  };
  const sort = readSort();
  link.click();
  await waitFor(
    () =>
      location.pathname.startsWith("/dashboard/holdings/") &&
      document.querySelector('main a[href="/holdings"]'),
  );
  await pause(dwellMs);

  if (back === "browser") {
    history.back();
  } else {
    document.querySelector('main a[href="/holdings"]').click();
  }

  await waitFor(
    () =>
      location.pathname === "/holdings" &&
      document.querySelector(holdingSelector),
  );
  await pause(800);
  const receipt = {
    back,
    position,
    before,
    after: window.scrollY,
    searchPreserved:
      document.querySelector('input[type="search"]')?.value === search,
    sortPreserved: readSort() === sort,
  };
  if (
    Math.abs(receipt.before - receipt.after) > 2 ||
    !receipt.searchPreserved ||
    !receipt.sortPreserved
  ) {
    throw new Error(JSON.stringify(receipt));
  }

  return receipt;
};

window.verifyHoldingsScroll();

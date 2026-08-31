// Paste into DevTools on a PR's Files Changed tab, scrolled down so the toolbar is stuck.
//
// findStickyActionRow in src/launcher.ts places the launcher by shape rather than by class
// name, because that toolbar is client-rendered and there is no fixture to check a guess
// against. When it puts the icon somewhere wrong — or nowhere, and the floating fallback
// appears — this reports which of its conditions each candidate row failed, which is the one
// thing the test suite cannot tell us.
(() => {
  const INTERACTIVE = 'button, [role="button"], a[aria-label]';
  const FILE_LEVEL = [
    '[role="treeitem"]',
    '[class*="TreeView"]',
    '[class*="DiffFileHeader"]',
    '[class*="diff-file-header"]',
    '[class*="diffTargetable"]',
    ".file-header",
  ].join(", ");
  const PAGE_CONTENT = "main, [role='main']";
  const GROUPING_DEPTH = 3;

  const stuck = (el) => ["sticky", "fixed"].includes(getComputedStyle(el).position);
  const stickyAncestor = (el) => {
    for (let s = el, i = 0; s && i < 8; s = s.parentElement, i++) if (stuck(s)) return s;
    return null;
  };

  const all = Array.from(document.querySelectorAll(INTERACTIVE));
  const controls = all.filter(
    (el) => el.id !== "gh-breakdown-launcher" && !el.closest(FILE_LEVEL) && el.closest(PAGE_CONTENT)
  );

  const beneath = new Map();
  for (const control of controls) {
    let scope = control.parentElement;
    for (let i = 0; i < GROUPING_DEPTH && scope; i++) {
      if (!beneath.has(scope)) beneath.set(scope, new Set());
      beneath.get(scope).add(control);
      scope = scope.parentElement;
    }
  }

  const rows = Array.from(beneath)
    .filter(([, set]) => set.size >= 2)
    .map(([el, set]) => ({
      el,
      controls: set.size,
      top: Math.round(el.getBoundingClientRect().top),
      sticky: !!stickyAncestor(el),
      labels: Array.from(set)
        .map((c) => c.getAttribute("aria-label") || c.textContent.trim().slice(0, 20))
        .filter(Boolean)
        .join(" | "),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 90),
    }))
    .sort((a, b) => a.top - b.top);

  console.log(
    `${all.length} controls on the page, ${controls.length} after excluding file headers, the` +
      ` file tree and anything outside <main>.`
  );
  console.log(`${rows.length} containers hold 2+ of them; ${rows.filter((r) => r.sticky).length} are sticky.`);
  console.table(rows.map(({ el, ...rest }) => rest));

  const chosen = rows.filter((r) => r.sticky)[0];
  console.log("WOULD PLACE IN:", chosen ? chosen.el : "nothing — the floating fallback appears");
  if (chosen) console.log("  labels:", chosen.labels);

  console.log(
    "\nIf the row you want is listed but not chosen, copy its `cls` and `labels`.\n" +
      "If it is missing entirely, right-click the toolbar > Inspect, then run:\n" +
      "  copy($0.outerHTML)"
  );
})();

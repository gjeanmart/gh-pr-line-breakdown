// Locates GitHub's native "+N −N ████" diffstat element — the element the hover widget
// anchors itself to. Kept DOM-only (no chrome APIs, no widget state) so it can be unit
// tested against captured GitHub markup — see tests/anchor.test.ts.
//
// GitHub renders the diffstat through its Primer React DiffStats component, on PR headers,
// commit headers and once per file:
//
//   <div class="d-flex flex-items-center gap-1">            ← the chip we anchor to
//     <span class="f6 fgColor-success text-bold">+18</span>
//     <span class="f6 fgColor-danger text-bold">-1</span>
//     <span class="sr-only">Lines changed: 18 additions & 1 deletion</span>
//     <div class="d-flex">                                  ← DiffSquares
//       <div data-testid="addition diffstat"></div>          ← 5 squares
//     </div>
//   </div>
//
// None of those elements carries a stable CSS-module class — GitHub dropped the
// DiffStates-module__diffStatesWrap wrapper this used to match on — so detection hooks the
// two contracts that survived: the data-testid="<kind> diffstat" squares and the sr-only
// "Lines changed:" label. The chip is the ancestor holding the squares and the +N span.

const DIFFSTAT_SQUARE = '[data-testid$="diffstat"]';
const LINES_CHANGED_LABEL = "Lines changed:";
const GREEN_TEXT = ".fgColor-success, .color-fg-success";

// Regions carrying the page *total* diffstat, most specific first. Searching these before
// the whole document keeps us off a per-file diffstat, which is the same component
// rendered once per file.
const HEADER_SCOPES = [
  '[class*="rightContentWrapper"]', // PR header — float-right diffstat slot
  '[data-component="PH_Navigation"]', // PR header navigation row (wraps that slot)
  '[class*="StickyPullRequestHeader"]', // condensed header shown while scrolling
  '[class*="commitFilesChangedContainer"]', // commit header — "N files changed" + diffstat
  '[class*="ilesChangedHeading"]', // files-changed summary bar
];

// Per-file and file-tree diffstats — never the page total.
const FILE_LEVEL_SCOPES = [
  '[role="treeitem"]',
  '[class*="TreeView"]',
  '[class*="DiffFileHeader"]',
  '[class*="diff-file-header"]',
  '[class*="diffTargetable"]',
  ".file-header",
].join(", ");

// GitHub renders duplicate header slots for narrow viewports and hides the inactive one
// (`display: none !important` under a container query), so an invisible clone would
// otherwise win the query. This walks computed styles rather than measuring layout boxes:
// `getClientRects()` would be more precise in a browser but always returns nothing under
// jsdom, which has no layout engine — that would make the whole module untestable.
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  let node: Element | null = el;
  while (node) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    node = node.parentElement;
  }
  return true;
}

// The chip holds the +N/-N spans and the sr-only label as direct children; the squares sit
// one level deeper, inside their own wrapper.
function isDiffstatChip(el: Element): boolean {
  return Array.from(el.children).some(
    (child) => child.matches("span.sr-only") || child.matches(GREEN_TEXT)
  );
}

// Climb from a diffstat square to the chip that wraps it.
function chipFromSquare(square: Element): Element {
  let el: Element = square;
  for (let i = 0; i < 3; i++) {
    const parent = el.parentElement;
    if (!parent) break;
    if (isDiffstatChip(parent)) return parent;
    el = parent;
  }
  return el;
}

// `skipFileLevel` is checked before visibility: it is a cheap selector match, and on a
// large Files Changed tab it discards hundreds of per-file squares before we resolve any
// computed styles.
function findDiffstatChip(scope: ParentNode, skipFileLevel: boolean): Element | null {
  for (const square of Array.from(scope.querySelectorAll(DIFFSTAT_SQUARE))) {
    if (skipFileLevel && square.closest(FILE_LEVEL_SCOPES)) continue;
    if (!isVisible(square)) continue;
    return chipFromSquare(square);
  }

  // hideSquares variant: no squares rendered, only the +N/-N text and the sr-only label
  for (const label of Array.from(scope.querySelectorAll("span.sr-only"))) {
    if (!label.textContent?.trim().startsWith(LINES_CHANGED_LABEL)) continue;
    if (skipFileLevel && label.closest(FILE_LEVEL_SCOPES)) continue;
    const chip = label.parentElement;
    if (chip && isVisible(chip)) return chip;
  }

  return null;
}

export function findDiffstatAnchor(): Element | null {
  // Legacy Primer wrapper — still present on older GitHub Enterprise builds
  const legacy = Array.from(document.querySelectorAll('[class*="diffStatesWrap"]')).find(isVisible);
  if (legacy) return legacy;

  // Modern diffstat chip, searched in the header regions that carry the page total
  for (const scopeSel of HEADER_SCOPES) {
    for (const scope of Array.from(document.querySelectorAll(scopeSel))) {
      if (!isVisible(scope)) continue;
      const chip = findDiffstatChip(scope, false);
      if (chip) return chip;
    }
  }

  // Anywhere on the page, skipping per-file and file-tree diffstats
  const anyChip = findDiffstatChip(document, true);
  if (anyChip) return anyChip;

  // Last resort: walk up from the PR tab navigation looking for the diffstat sibling.
  // GitHub dropped role="tablist" from that nav, hence the extra selectors.
  const tabNav = document.querySelector(
    '[role="tablist"], nav[aria-label="Pull request navigation tabs"], [class*="TabNav"]'
  );
  if (!tabNav) return null;

  let el: Element | null = tabNav;
  for (let i = 0; i < 5; i++) {
    el = el?.parentElement ?? null;
    if (!el) break;
    const parent: Element | null = el.parentElement;
    if (!parent) break;
    for (const child of Array.from(parent.children)) {
      if (child !== el && isVisible(child) && child.querySelector(GREEN_TEXT)) {
        return child;
      }
    }
  }

  return null;
}

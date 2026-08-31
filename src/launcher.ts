// A second way into the breakdown, for when the diffstat has scrolled away.
//
// The diffstat lives in the page header, so it is gone the moment you start reading the diff —
// which is exactly when you want to know what you are looking at. GitHub keeps a sticky header
// with a row of icon buttons at that point, and our button belongs in it.
//
// The placement is deliberately not a class-name guess. Every selector guess in this project
// has eventually broken (the anchor in v0.1.6, the badge twice since), so this looks for the
// action row *behaviourally*: an element that is sticky or inside something sticky, and that
// holds several icon buttons. If it cannot find one it does not fail — it falls back to a
// floating button of our own, positioned in the same corner. The reader always gets a way in.

const LAUNCHER_ID = "gh-breakdown-launcher";
const HOSTED_CLASS = "gh-breakdown-launcher--hosted";
const FLOATING_CLASS = "gh-breakdown-launcher--floating";

const ICON =
  `<svg width="16" height="16" viewBox="0 0 128 128" aria-hidden="true">` +
  `<rect x="16" y="20" width="88" height="16" rx="4" fill="currentColor" opacity=".95"/>` +
  `<rect x="16" y="44" width="72" height="16" rx="4" fill="currentColor" opacity=".75"/>` +
  `<rect x="16" y="68" width="52" height="16" rx="4" fill="currentColor" opacity=".55"/>` +
  `<rect x="16" y="92" width="32" height="16" rx="4" fill="currentColor" opacity=".35"/></svg>`;

// Rows that are emphatically not the one we want.
//
// Per-file diff headers are sticky too, and they carry their own cluster of icon buttons
// (Viewed, comment, the overflow menu) — the first version of this landed our icon there, at
// the right-hand end of the first file in the diff.
const FILE_LEVEL = [
  '[role="treeitem"]',
  '[class*="TreeView"]',
  '[class*="DiffFileHeader"]',
  '[class*="diff-file-header"]',
  '[class*="diffTargetable"]',
  ".file-header",
].join(", ");

// GitHub's global navigation is sticky and full of aria-labelled buttons — search, the plus
// menu, issues, pull requests, the inbox, the avatar. It is also the topmost sticky thing on
// the page, so anything that simply took the highest candidate would land there. It sits
// outside <main>; the PR's own toolbar sits inside it, which is the cheapest way to tell them
// apart without naming a class.
const PAGE_CONTENT = "main, [role='main']";

function isStuck(el: Element): boolean {
  const position = getComputedStyle(el).position;
  return position === "sticky" || position === "fixed";
}

function hasStickyAncestor(el: HTMLElement): boolean {
  let scope: HTMLElement | null = el;
  for (let i = 0; i < 8 && scope; i++) {
    if (isStuck(scope)) return true;
    scope = scope.parentElement;
  }
  return false;
}

// What counts as a control. Not `button[aria-label]`: GitHub's toolbar mixes plain buttons,
// anchors carrying the accessible name, and elements given a button role by Primer, and the
// narrower selector found none of them on a real Files-changed page.
const INTERACTIVE = 'button, [role="button"], a[aria-label]';

// How far up from a control to look for the container it shares with its neighbours. Primer
// wraps IconButtons in their own elements, so the buttons in one visual row frequently do not
// share a *parent* — which is why counting direct children found nothing to place next to.
const GROUPING_DEPTH = 3;

/**
 * The row of icon buttons in GitHub's sticky pull-request toolbar, found by what it *is*
 * rather than by what it is called: two or more controls sharing a small container, inside the
 * page content, not part of a file header, and inside something sticky.
 *
 * Of the containers that qualify, the highest on the page wins, and the deepest of those — the
 * tight row rather than a wrapper that happens to contain it.
 */
function findStickyActionRow(): HTMLElement | null {
  const controls = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE)).filter(
    (el) => el.id !== LAUNCHER_ID && !el.closest(FILE_LEVEL) && el.closest(PAGE_CONTENT)
  );

  // Which controls sit beneath each candidate container, counting each control once however
  // many levels of wrapper stand between them.
  const beneath = new Map<HTMLElement, Set<HTMLElement>>();
  for (const control of controls) {
    let scope = control.parentElement;
    for (let i = 0; i < GROUPING_DEPTH && scope; i++) {
      let seen = beneath.get(scope);
      if (!seen) beneath.set(scope, (seen = new Set()));
      seen.add(control);
      scope = scope.parentElement;
    }
  }

  const candidates = Array.from(beneath)
    .filter(([container, controlsBeneath]) => controlsBeneath.size >= 2 && hasStickyAncestor(container))
    .map(([container]) => container);

  if (candidates.length === 0) return null;

  return candidates.reduce((best, container) => {
    const top = container.getBoundingClientRect().top;
    const bestTop = best.getBoundingClientRect().top;
    if (top !== bestTop) return top < bestTop ? container : best;
    return depth(container) > depth(best) ? container : best;
  });
}

function depth(el: HTMLElement): number {
  let levels = 0;
  for (let scope = el.parentElement; scope; scope = scope.parentElement) levels++;
  return levels;
}

/**
 * Put the launcher where it belongs and hand it back. The caller attaches the behaviour —
 * widget.attachAnchor gives it the same hover, focus and keyboard handling as the diffstat,
 * so there is one popup with two ways in rather than two implementations.
 */
export function ensureLauncher(): HTMLElement {
  const existing = document.getElementById(LAUNCHER_ID);

  // The cheap exit, and the reason the search below is affordable: once the launcher is in the
  // toolbar there is nothing to look for. findStickyActionRow reads every aria-labelled button
  // on the page, and on a large PR that is one per file header, several times over — a sweep
  // the content script would otherwise pay for on every settled batch of mutations. If GitHub
  // replaces the toolbar our button goes with it, getElementById comes back null, and the next
  // pass places a new one.
  if (existing?.classList.contains(HOSTED_CLASS) && existing.isConnected) return existing;

  const row = findStickyActionRow();
  if (existing && !row) return existing;

  const button = existing ?? createLauncher();

  if (row) {
    button.classList.add(HOSTED_CLASS);
    button.classList.remove(FLOATING_CLASS);
    row.appendChild(button);
  } else {
    button.classList.add(FLOATING_CLASS);
    button.classList.remove(HOSTED_CLASS);
    document.body.appendChild(button);
  }

  return button;
}

function createLauncher(): HTMLElement {
  const button = document.createElement("button");
  button.id = LAUNCHER_ID;
  button.type = "button";
  button.innerHTML = ICON;
  button.setAttribute("aria-label", "Line breakdown");
  button.setAttribute("aria-expanded", "false");
  button.title = "Line breakdown";
  return button;
}

export function removeLauncher(): void {
  document.getElementById(LAUNCHER_ID)?.remove();
}

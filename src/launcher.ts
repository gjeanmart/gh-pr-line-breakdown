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

function isStuck(el: Element): boolean {
  const position = getComputedStyle(el).position;
  return position === "sticky" || position === "fixed";
}

/**
 * The row of icon buttons in GitHub's sticky header, found by what it *is* rather than by what
 * it is called: a cluster of at least three icon-only buttons, inside something sticky.
 */
function findStickyActionRow(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>("button[aria-label]"));

  // Group buttons by their parent, so a "row" is simply a parent with several of them
  const rows = new Map<HTMLElement, number>();
  for (const button of buttons) {
    const parent = button.parentElement;
    if (!parent) continue;
    rows.set(parent, (rows.get(parent) ?? 0) + 1);
  }

  for (const [row, count] of rows) {
    if (count < 3) continue;
    // Walk up a little: the buttons' parent is usually inside the sticky element, not it
    let scope: HTMLElement | null = row;
    for (let i = 0; i < 5 && scope; i++) {
      if (isStuck(scope)) return row;
      scope = scope.parentElement;
    }
  }

  return null;
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

// Collapsing a file for the category filter (the eye icon in the widget).
//
// We drive GitHub's OWN collapse control instead of hiding DOM ourselves. Hiding the diff
// body by hand left the file header without its bottom border — GitHub styles a collapsed
// file differently from "a file whose body happens to be display:none" — and the hand-rolled
// DOM walk never worked on commit pages, whose file sections are nested differently.
//
// The control is the chevron IconButton GitHub renders in every file header, on PR and
// commit pages alike (DiffFileHeader):
//
//   <button aria-label="Collapse file">   <svg class="octicon octicon-chevron-down">
//   <button aria-label="Expand file">     <svg class="octicon octicon-chevron-right">
//
// The icon class is checked before the label because it is language independent, and
// because Primer sometimes moves the accessible name into an aria-labelledby tooltip.

const COLLAPSE_LABEL = "Collapse file";
const EXPAND_LABEL = "Expand file";

type CollapseToggle = { button: HTMLElement; collapsed: boolean };

// How far to climb looking for the control. The element badges.ts hands us is not reliably
// the whole header row: findHeaderContainer stops at the first ancestor whose class matches
// DiffFileHeader-module__*, which is usually the inner file-path section — and the chevron
// lives in a *sibling* div of that section. So the search starts where it was told and climbs
// until it finds exactly one control: zero means keep climbing, more than one means we have
// climbed into a container holding several files and should give up rather than collapse the
// wrong one.
const MAX_CLIMB = 4;

function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  const id = el.getAttribute("aria-labelledby");
  if (!id) return "";
  return document.getElementById(id)?.textContent?.trim() ?? "";
}

function isToggle(button: Element): boolean {
  if (button.querySelector("svg.octicon-chevron-down, svg.octicon-chevron-right")) return true;
  const name = accessibleName(button);
  return name === COLLAPSE_LABEL || name === EXPAND_LABEL;
}

function describeToggle(button: HTMLElement): CollapseToggle {
  if (button.querySelector("svg.octicon-chevron-right")) return { button, collapsed: true };
  if (button.querySelector("svg.octicon-chevron-down")) return { button, collapsed: false };
  return { button, collapsed: accessibleName(button) === EXPAND_LABEL };
}

/** Why the search ended where it did — for the debug log, which is the only caller. */
export type ToggleSearch = { toggle: CollapseToggle | null; reason: string; levels: number };

/**
 * Which of several candidates is the file's own collapse control.
 *
 * Needed because the element we are handed is not always the header row. When a file has
 * hidden context lines, badges.ts resolves it from the "Expand all lines" button — which is
 * in the *diff body* — so findHeaderContainer walks up to the whole file section, and
 * searching that subtree turns up the header chevron alongside whatever chevron-bearing
 * controls the body contains. Giving up there is what left every expanded file in a hidden
 * category still open, with the collapsed ones working fine and no pattern the reader could
 * see.
 *
 * GitHub names the one we want, so that is tried first. Failing that, document order: a file's
 * header precedes its body, so the file's own control cannot be the second one found.
 */
function pickToggle(found: HTMLElement[]): HTMLElement | null {
  if (found.length <= 1) return found[0] ?? null;

  const named = found.filter((button) => {
    const name = accessibleName(button);
    return name === COLLAPSE_LABEL || name === EXPAND_LABEL;
  });
  if (named.length === 1) return named[0];

  return found[0];
}

function describeCandidates(found: HTMLElement[]): string {
  return found.map((button) => accessibleName(button) || "(unnamed)").join(", ");
}

export function searchCollapseToggle(header: HTMLElement): ToggleSearch {
  let scope: Element | null = header;
  for (let i = 0; i <= MAX_CLIMB && scope; i++) {
    const found = Array.from(scope.querySelectorAll<HTMLElement>("button")).filter(isToggle);

    if (found.length === 1) return { toggle: describeToggle(found[0]), reason: "found", levels: i };

    if (found.length > 1) {
      // Only the scope we were handed is known to belong to a single file — findHeaderContainer
      // picks the smallest ancestor with exactly one "Viewed" button. Once we have climbed,
      // several controls really can mean several files, and collapsing the wrong one is worse
      // than collapsing none.
      if (i > 0) {
        return {
          toggle: null,
          reason: `ambiguous after climbing — ${found.length} controls (${describeCandidates(found)})`,
          levels: i,
        };
      }

      const picked = pickToggle(found);
      return {
        toggle: picked ? describeToggle(picked) : null,
        reason: `picked from ${found.length} controls (${describeCandidates(found)})`,
        levels: i,
      };
    }

    scope = scope.parentElement;
  }
  return { toggle: null, reason: `no control within ${MAX_CLIMB} levels`, levels: MAX_CLIMB };
}

function findCollapseToggle(header: HTMLElement): CollapseToggle | null {
  return searchCollapseToggle(header).toggle;
}

/**
 * Collapse one file. Returns true only if this call actually collapsed it, so the caller
 * can tell "we collapsed this" from "the user (or GitHub) had already collapsed it" and
 * avoid expanding files it never touched.
 */
export function collapseFile(header: HTMLElement): boolean {
  const toggle = findCollapseToggle(header);
  if (!toggle || toggle.collapsed) return false;
  toggle.button.click();
  return true;
}

/** Expand one file, if it is currently collapsed. */
/**
 * Returns true only when it actually clicked — mirroring collapseFile, and for the same
 * reason: the caller records which files it collapsed, and a silent no-op here used to clear
 * that record anyway. A stale header (rule 4 in file_headers.ts) makes this find nothing.
 */
export function expandFile(header: HTMLElement): boolean {
  const toggle = findCollapseToggle(header);
  if (!toggle?.collapsed) return false;
  toggle.button.click();
  return true;
}

/** Whether a file header exposes a collapse control at all. */
export function isCollapsible(header: HTMLElement): boolean {
  return findCollapseToggle(header) !== null;
}

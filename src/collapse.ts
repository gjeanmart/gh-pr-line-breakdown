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

function findCollapseToggle(header: HTMLElement): CollapseToggle | null {
  let scope: Element | null = header;
  for (let i = 0; i <= MAX_CLIMB && scope; i++) {
    const found = Array.from(scope.querySelectorAll<HTMLElement>("button")).filter(isToggle);
    if (found.length === 1) return describeToggle(found[0]);
    if (found.length > 1) return null;
    scope = scope.parentElement;
  }
  return null;
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
export function expandFile(header: HTMLElement): void {
  const toggle = findCollapseToggle(header);
  if (toggle?.collapsed) toggle.button.click();
}

/** Whether a file header exposes a collapse control at all. */
export function isCollapsible(header: HTMLElement): boolean {
  return findCollapseToggle(header) !== null;
}
